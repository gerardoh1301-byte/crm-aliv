import "server-only";
import { db } from "@/db";
import {
  activities,
  contacts,
  conversations,
  deals,
  messages,
  notifications,
  pipelineStages,
  pipelines,
  teamMembers,
} from "@/db/schema";
import { pedidosOrdenes } from "../../../modules/pedidos/tabla";
import { and, desc, eq, gt, isNotNull, sql } from "drizzle-orm";
import { consultarEstadoShalom, debeAvisarEnvioConfirmado, MARCA_ENVIO_CONFIRMADO } from "./shalom-rastreo";
import { deliverMessage } from "@/lib/channels/deliver";
import { aplicarEtiquetaAContacto } from "../agent/etiquetado";
import { setDealStage } from "@/lib/deals/stage";
import { notifyMember } from "@/lib/notifications";
import { decidirToqueAgencia, mensajeToqueAgencia, PREFIJO_LLAMADA_AGENCIA } from "./cadencia-agencia";

export interface OpcionesNotificarLlegada {
  forzarReenvio?: boolean;
  contactIdEspecifico?: string;
}

export interface ResultadoNotificacionLlegada {
  totalVerificados: number;
  enDestinoListos: number;
  yaEntregados: number;
  notificacionesEnviadas: number;
  alertasCrmEnviadas: number;
  excluidos: number;
  detalles: Array<{
    numeroOrden: string;
    cliente: string;
    phone: string | null;
    guia: string;
    agencia: string;
    saldo: number;
    estadoLive: string;
    notificado: boolean;
    motivoNoNotificado?: string;
  }>;
}

/**
 * Casos excepcionales manejados de forma personal que deben quedar
 * completamente al margen del rastreo/notificación/alerta automática Shalom.
 *
 * P2: Se controla únicamente por marca persistente en notas del pedido
 * (`[SHALOM_AUTO_EXCLUIDO]`) o etiqueta del contacto (`shalom manual`,
 * `sin auto shalom`, `shalom excluido`), sin teléfonos ni órdenes hardcodeadas.
 */
function esPedidoExcluidoShalom(
  notas: string | null | undefined,
  contactTags?: string[] | null
): boolean {
  if ((notas || "").toUpperCase().includes("[SHALOM_AUTO_EXCLUIDO]")) {
    return true;
  }
  const tags = (contactTags ?? []).map((t) => t.toLowerCase().trim());
  return tags.some(
    (t) =>
      t === "shalom manual" ||
      t === "sin auto shalom" ||
      t === "shalom excluido"
  );
}

function horaDecimalLima(): number {
  try {
    const formateador = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Lima",
      hour: "numeric",
      minute: "numeric",
      hour12: false,
    });
    const partes = formateador.formatToParts(new Date());
    const hora = parseInt(partes.find((p) => p.type === "hour")?.value ?? "0", 10);
    const minuto = parseInt(partes.find((p) => p.type === "minute")?.value ?? "0", 10);
    return hora + minuto / 60;
  } catch {
    return 12;
  }
}

function esHorarioSeguroMensajes(): boolean {
  const decimal = horaDecimalLima();
  return decimal >= 8.5 && decimal <= 19.5;
}

function esHorarioAlertaSupervisores(): boolean {
  const decimal = horaDecimalLima();
  return decimal >= 8 && decimal < 22;
}

function calcularHorasEnAgencia(fechaLlegadaDestino?: string): number | null {
  if (!fechaLlegadaDestino) return null;
  // Formato típico Shalom: "2026-11-17 10:12:02" (hora Perú -05:00)
  const iso = fechaLlegadaDestino.includes("T")
    ? fechaLlegadaDestino
    : `${fechaLlegadaDestino.trim().replace(" ", "T")}-05:00`;
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return null;
  return Math.max(0, (Date.now() - ts) / (1000 * 60 * 60));
}

/**
 * Escanea los pedidos en camino con guía Shalom, verifica su estado en tiempo real
 * con los servidores de Shalom, y si el paquete ya llegó a la agencia de destino,
 * envía un mensaje automático al cliente recordándole que ya puede recogerlo
 * y solicitándole el saldo para enviarle su clave secreta de recojo.
 */
export async function verificarYNotificarLlegadasShalom(
  opts?: OpcionesNotificarLlegada
): Promise<ResultadoNotificacionLlegada> {
  const forzar = opts?.forzarReenvio ?? false;

  // 1. Obtener pedidos con guía y código registrados que no hayan sido cancelados
  const query = db
    .select({
      pedidoId: pedidosOrdenes.id,
      numeroOrden: pedidosOrdenes.numeroOrden,
      numeroGuia: pedidosOrdenes.numeroGuia,
      codigoRastreo: pedidosOrdenes.codigoRastreo,
      claveRecojo: pedidosOrdenes.claveRecojo,
      total: pedidosOrdenes.total,
      ciudad: pedidosOrdenes.ciudad,
      estadoPedido: pedidosOrdenes.estado,
      notasPedido: pedidosOrdenes.notas,
      dealId: pedidosOrdenes.dealId,
      stageKey: pipelineStages.key,
      contactId: contacts.id,
      contactName: contacts.name,
      contactPhone: contacts.phone,
      contactTags: contacts.tags,
      convId: conversations.id,
      convChannel: conversations.channel,
    })
    .from(pedidosOrdenes)
    .innerJoin(contacts, eq(pedidosOrdenes.contactId, contacts.id))
    .leftJoin(conversations, eq(conversations.contactId, contacts.id))
    .leftJoin(deals, eq(deals.id, pedidosOrdenes.dealId))
    .leftJoin(pipelineStages, eq(pipelineStages.id, deals.stageId))
    .where(
      and(
        isNotNull(pedidosOrdenes.numeroGuia),
        isNotNull(pedidosOrdenes.codigoRastreo)
      )
    );

  const candidatosRaw = await query;
  // A7: Deduplicar por pedidoId (si un contacto tiene 2 conversaciones, elegir preferiblemente WhatsApp y no enviar 2 veces al mismo pedido)
  const porPedido = new Map<string, (typeof candidatosRaw)[number]>();
  for (const row of candidatosRaw) {
    const prev = porPedido.get(row.pedidoId);
    if (!prev || (row.convChannel === "whatsapp" && prev.convChannel !== "whatsapp")) {
      porPedido.set(row.pedidoId, row);
    }
  }
  const candidatos = Array.from(porPedido.values());
  const filtrados = opts?.contactIdEspecifico
    ? candidatos.filter((c) => c.contactId === opts.contactIdEspecifico)
    : candidatos;

  let enDestinoListos = 0;
  let yaEntregados = 0;
  let notificacionesEnviadas = 0;
  let alertasCrmEnviadas = 0;
  let excluidos = 0;
  const detalles: ResultadoNotificacionLlegada["detalles"] = [];

  const admins = await db
    .select({ id: teamMembers.id })
    .from(teamMembers)
    .where(and(eq(teamMembers.role, "admin"), eq(teamMembers.active, true)));

  // Obtener stage de 'entregado' para mover si ya fue recogido
  const [pipeline] = await db
    .select({ id: pipelines.id })
    .from(pipelines)
    .where(eq(pipelines.isDefault, true))
    .limit(1);

  let stageEntregadoId: string | null = null;
  if (pipeline) {
    const [stageEntregado] = await db
      .select({ id: pipelineStages.id })
      .from(pipelineStages)
      .where(and(eq(pipelineStages.pipelineId, pipeline.id), eq(pipelineStages.key, "entregado")))
      .limit(1);
    stageEntregadoId = stageEntregado?.id || null;
  }

  const ESTADOS_CANCELADOS = new Set(["cancelado", "rechazado", "cancelado_rechazado", "anulado"]);

  for (const c of filtrados) {
    if (!c.numeroGuia || !c.codigoRastreo) continue;

    // Casos excepcionales manejados personalmente (controlados por nota [SHALOM_AUTO_EXCLUIDO] o etiqueta)
    if (esPedidoExcluidoShalom(c.notasPedido, c.contactTags)) {
      excluidos++;
      detalles.push({
        numeroOrden: c.numeroOrden,
        cliente: c.contactName,
        phone: c.contactPhone,
        guia: c.numeroGuia,
        agencia: c.ciudad || "-",
        saldo: 0,
        estadoLive: "Excluido (gestión personal)",
        notificado: false,
        motivoNoNotificado: "Pedido excluido del seguimiento automático por manejo personal",
      });
      continue;
    }

    // Omitir cancelados/rechazados o ya marcados como entregados tanto en pedido como en Pipeline
    if (
      ESTADOS_CANCELADOS.has((c.estadoPedido || "").toLowerCase()) ||
      ESTADOS_CANCELADOS.has((c.stageKey || "").toLowerCase())
    ) {
      continue;
    }
    if (c.estadoPedido === "entregado" && (!c.dealId || c.stageKey === "entregado")) {
      yaEntregados++;
      continue;
    }

    const rastro = await consultarEstadoShalom(c.numeroGuia, c.codigoRastreo);
    if (!rastro.ok) {
      detalles.push({
        numeroOrden: c.numeroOrden,
        cliente: c.contactName,
        phone: c.contactPhone,
        guia: c.numeroGuia,
        agencia: c.ciudad || "-",
        saldo: 0,
        estadoLive: rastro.mensaje || "Error al consultar",
        notificado: false,
        motivoNoNotificado: rastro.mensaje,
      });
      continue;
    }

    const totalNum = Number(c.total) || 199;
    const saldoSoles = Math.max(0, totalNum - 20);
    const nombreLimpio = (c.contactName || "Cliente").split(" ")[0].trim();
    const agenciaNombre = rastro.agenciaDestino || c.ciudad || "Provincia";

    // CASO -1: Shalom redirigió el paquete a otra agencia. La guía vieja figura "entregada"
    // a un cliente llamado "CAMBIO DE DESTINO", pero el paquete NO se entregó: hay una guía
    // nueva. No se marca entregado, no se le escribe al cliente y se avisa a Gerardo una vez
    // para que registre la guía nueva (con la orden «guia» por WhatsApp o desde el CRM).
    if (rastro.cambioDeDestino) {
      const marcaCambio = `[CAMBIO_DESTINO_AVISADO guia=${c.numeroGuia}]`;
      if (!(c.notasPedido || "").includes(marcaCambio) && esHorarioAlertaSupervisores()) {
        try {
          const { notificarSupervisoresCritico } = await import("@/lib/alerts/supervisor-alerts");
          const res = await notificarSupervisoresCritico({
            tipo: "shalom_cambio_destino",
            titulo: `Cambio de destino ${c.numeroOrden}`,
            detalle:
              `La guía ${c.numeroGuia} de ${c.numeroOrden} se cerró por CAMBIO DE DESTINO en Shalom (antes iba a ${agenciaNombre}). ` +
              `Registra la guía nueva escribiendo: guia ${c.numeroOrden.replace(/^#/, "")} <número> <código>.`,
            clienteNombre: c.contactName,
            clienteTelefono: c.contactPhone,
            contactId: c.contactId,
            conversationId: c.convId,
          });
          if (res.notificados > 0) {
            c.notasPedido = c.notasPedido ? `${c.notasPedido}\n${marcaCambio}` : marcaCambio;
            await db
              .update(pedidosOrdenes)
              .set({ notas: c.notasPedido, updatedAt: new Date() })
              .where(eq(pedidosOrdenes.id, c.pedidoId));
          }
        } catch (errCambio) {
          console.warn("[notificar-llegada] Error avisando cambio de destino:", errCambio);
        }
      }
      detalles.push({
        numeroOrden: c.numeroOrden,
        cliente: c.contactName,
        phone: c.contactPhone,
        guia: c.numeroGuia,
        agencia: agenciaNombre,
        saldo: saldoSoles,
        estadoLive: "Cambio de destino en Shalom (guía nueva pendiente de registrar)",
        notificado: false,
        motivoNoNotificado: "Shalom cerró la guía por cambio de destino",
      });
      continue;
    }

    // CASO 0: el almacén dejó el paquete en la agencia de origen y Shalom lo confirmó.
    // Desde ese momento el envío se puede pagar en Págalo: aviso SOLO a Gerardo, una vez.
    if (debeAvisarEnvioConfirmado(rastro, c.notasPedido) && esHorarioAlertaSupervisores()) {
      try {
        const { notificarSupervisoresCritico } = await import("@/lib/alerts/supervisor-alerts");
        const detalle =
          `${c.numeroOrden} confirmado por Shalom${rastro.agenciaOrigen ? ` en ${rastro.agenciaOrigen}` : ""}` +
          `${rastro.fechaConfirmacion ? ` (${rastro.fechaConfirmacion})` : ""}. ` +
          `Orden ${c.numeroGuia} · Código ${c.codigoRastreo} · destino ${rastro.agenciaDestino || c.ciudad || "-"}` +
          `${rastro.montoFlete ? ` · flete S/ ${rastro.montoFlete}` : ""}${rastro.tipoPago ? ` (${rastro.tipoPago})` : ""}. ` +
          `Ya puedes pagar el envío en Págalo.`;
        const res = await notificarSupervisoresCritico({
          tipo: "shalom_envio_confirmado",
          titulo: `Envío confirmado ${c.numeroOrden}`,
          detalle,
          clienteNombre: c.contactName,
          clienteTelefono: c.contactPhone,
          contactId: c.contactId,
          conversationId: c.convId,
        });
        if (res.notificados > 0) {
          const marca = `${MARCA_ENVIO_CONFIRMADO}:${new Date().toISOString().slice(0, 16)} guia=${c.numeroGuia}]`;
          c.notasPedido = c.notasPedido ? `${c.notasPedido}
${marca}` : marca;
          await db
            .update(pedidosOrdenes)
            .set({ notas: c.notasPedido, updatedAt: new Date() })
            .where(eq(pedidosOrdenes.id, c.pedidoId));
          await db.insert(activities).values({
            type: "note",
            description: `[SHALOM ENVIO CONFIRMADO] Aviso a Gerardo para pagar el envío: ${detalle}`,
            contactId: c.contactId,
            dealId: c.dealId,
          });
        }
      } catch (errConf) {
        console.warn("[notificar-llegada] Error avisando envío confirmado:", errConf);
      }
    }

    // CASO 1: Paquete ya entregado en Shalom
    if (rastro.yaEntregado) {
      yaEntregados++;

      // Si aún no estaba en 'entregado' en el CRM, actualizar
      if (c.estadoPedido !== "entregado") {
        await db
          .update(pedidosOrdenes)
          .set({ estado: "entregado", updatedAt: new Date() })
          .where(eq(pedidosOrdenes.id, c.pedidoId));
      }
      if (c.dealId && stageEntregadoId && c.stageKey !== "entregado") {
        await setDealStage({ dealId: c.dealId, stageId: stageEntregadoId });
      }

      detalles.push({
        numeroOrden: c.numeroOrden,
        cliente: c.contactName,
        phone: c.contactPhone,
        guia: c.numeroGuia,
        agencia: agenciaNombre,
        saldo: saldoSoles,
        estadoLive: "Entregado a cliente",
        notificado: false,
        motivoNoNotificado: "Paquete ya fue recogido en Shalom",
      });
      continue;
    }

    // CASO 2: Paquete en destino listo para recojo
    if (rastro.enDestinoListoParaRecojo) {
      enDestinoListos++;

      const horasEnAgencia = calcularHorasEnAgencia(rastro.fechaLlegadaDestino);
      const horasTxt =
        horasEnAgencia !== null ? ` (${Math.round(horasEnAgencia)}h en agencia)` : "";

      // Alerta automática en la campanita del CRM (y Web Push) para admins cuando el pedido
      // está en agencia Shalom y aún NO ha sido marcado como entregado en Pipeline.
      // Deduplicado: máximo 1 alerta cada 20 horas por contacto.
      if (c.stageKey !== "entregado" && admins.length > 0) {
        try {
          const [alertaReciente] = await db
            .select({ id: notifications.id })
            .from(notifications)
            .where(
              and(
                eq(notifications.kind, "shalom_en_agencia"),
                eq(notifications.contactId, c.contactId),
                gt(notifications.createdAt, sql`now() - interval '20 hours'`)
              )
            )
            .limit(1);

          if (!alertaReciente) {
            for (const admin of admins) {
              await notifyMember({
                memberId: admin.id,
                kind: "shalom_en_agencia",
                title: `📦 En agencia Shalom sin entregar: ${c.contactName}`,
                body: `Orden #${c.numeroOrden} (Guía ${c.numeroGuia}) en Shalom ${agenciaNombre}${horasTxt}. Aún en etapa "${c.stageKey || "en_reparto"}". Saldo: S/ ${saldoSoles.toFixed(2)}.`,
                url: c.convId ? `/conversations/${c.convId}` : "/pipeline",
                contactId: c.contactId,
                tag: `shalom-agencia-${c.pedidoId}`,
              }).catch((err) => console.warn("[notificar-llegada] Error campanita CRM:", err));
            }
            alertasCrmEnviadas++;
          }
        } catch (errNotif) {
          console.warn("[notificar-llegada] Error verificando alerta CRM:", errNotif);
        }
      }

      // Alerta crítica por WhatsApp a supervisores si lleva >=24h en agencia sin retirar
      // (independiente de la ventana 08:30-19:30 del cliente, respetando 08:00-22:00 para supervisores).
      if (
        c.stageKey !== "entregado" &&
        horasEnAgencia !== null &&
        horasEnAgencia >= 24 &&
        esHorarioAlertaSupervisores()
      ) {
        try {
          const [supReciente] = await db
            .select({ id: activities.id })
            .from(activities)
            .where(
              and(
                eq(activities.contactId, c.contactId),
                sql`${activities.description} LIKE '[SHALOM ALERTA SUPERVISOR]%'`,
                gt(activities.createdAt, sql`now() - interval '20 hours'`)
              )
            )
            .limit(1);

          if (!supReciente) {
            const { notificarSupervisoresCritico } = await import("@/lib/alerts/supervisor-alerts");
            const resSup = await notificarSupervisoresCritico({
              tipo: "shalom_24h_retraso",
              titulo: `Paquete >24h en Shalom: ${c.contactName}`,
              detalle: `El pedido #${c.numeroOrden} (Guía Shalom: ${c.numeroGuia}) lleva ${Math.round(horasEnAgencia)} horas en espera en la agencia Shalom ${agenciaNombre} y aún no figura como entregado en Pipeline. Saldo pendiente: S/ ${saldoSoles.toFixed(2)}.`,
              clienteNombre: c.contactName,
              clienteTelefono: c.contactPhone,
              contactId: c.contactId,
              conversationId: c.convId,
            });
            if (resSup.notificados > 0) {
              await db.insert(activities).values({
                type: "note",
                description: `[SHALOM ALERTA SUPERVISOR] Alerta enviada a ${resSup.notificados} supervisores: pedido #${c.numeroOrden} lleva ${Math.round(horasEnAgencia)}h en ${agenciaNombre}.`,
                contactId: c.contactId,
                dealId: c.dealId,
              });
            }
          }
        } catch (errSup) {
          console.warn("[notificar-llegada] Error alertando a supervisores por Shalom >24h:", errSup);
        }
      }

      const tags = (c.contactTags || []).map((t) => t.toLowerCase().trim());
      const notasPed = (c.notasPedido || "").toLowerCase();
      // Si el saldo ya se cobró (p. ej. registrado desde el WhatsApp del supervisor), no
      // se le vuelve a pedir el pago al cliente.
      if (notasPed.includes("[saldo_cobrado:")) {
        detalles.push({
          numeroOrden: c.numeroOrden,
          cliente: c.contactName,
          phone: c.contactPhone,
          guia: c.numeroGuia,
          agencia: agenciaNombre,
          saldo: 0,
          estadoLive: "En destino (saldo ya cobrado)",
          notificado: false,
          motivoNoNotificado: "Saldo ya cobrado: no se le pide el pago otra vez",
        });
        continue;
      }
      const yaNotificadoEnPedido = notasPed.includes("[aviso_llegada_enviado");
      const avisadoPorEtiqueta = tags.includes("en agencia shalom") || tags.includes("aviso_llegada_enviado");

      // Cadencia (22/11): llegada -> toque de la tarde (+4 h, mismo día) -> diario -> riesgo (día 4+).
      const [ultimoMsg] = await db
        .select({ createdAt: messages.createdAt })
        .from(messages)
        .where(eq(messages.conversationId, c.convId || ""))
        .orderBy(desc(messages.createdAt))
        .limit(1);
      const [ultimoIn] = await db
        .select({ createdAt: messages.createdAt })
        .from(messages)
        .where(and(eq(messages.conversationId, c.convId || ""), eq(messages.direction, "in")))
        .orderBy(desc(messages.createdAt))
        .limit(1);
      const decisionCadencia = decidirToqueAgencia({
        ahora: new Date(),
        notasPedido: c.notasPedido,
        horasEnAgencia,
        ultimoEntranteEn: ultimoIn?.createdAt ?? null,
        ultimoMensajeEn: ultimoMsg?.createdAt ?? null,
        forzar,
        avisadoSinMarca: !yaNotificadoEnPedido && avisadoPorEtiqueta,
      });
      if (decisionCadencia.accion === "esperar") {
        detalles.push({
          numeroOrden: c.numeroOrden,
          cliente: c.contactName,
          phone: c.contactPhone,
          guia: c.numeroGuia,
          agencia: agenciaNombre,
          saldo: saldoSoles,
          estadoLive: "En destino (ya avisado recientemente)",
          notificado: false,
          motivoNoNotificado: `Sin aviso por ahora: ${decisionCadencia.motivo}.`,
        });
        continue;
      }
      const toque = decisionCadencia.toque;
      const esRecordatorio = toque !== "llegada";

      if (!c.convId) {
        detalles.push({
          numeroOrden: c.numeroOrden,
          cliente: c.contactName,
          phone: c.contactPhone,
          guia: c.numeroGuia,
          agencia: agenciaNombre,
          saldo: saldoSoles,
          estadoLive: "En destino",
          notificado: false,
          motivoNoNotificado: "No se encontró conversación activa para enviar WhatsApp",
        });
        continue;
      }

      // Si estamos fuera de horario comercial seguro y no se fuerza manualmente, diferir el mensaje
      if (!forzar && !esHorarioSeguroMensajes()) {
        detalles.push({
          numeroOrden: c.numeroOrden,
          cliente: c.contactName,
          phone: c.contactPhone,
          guia: c.numeroGuia,
          agencia: agenciaNombre,
          saldo: saldoSoles,
          estadoLive: "En destino (esperando horario comercial)",
          notificado: false,
          motivoNoNotificado: "Fuera de horario seguro (08:30 a 19:30). Se enviará en la mañana.",
        });
        continue;
      }

      // Redactar mensaje según el toque de la cadencia
      const mensajeAviso = mensajeToqueAgencia(toque, decisionCadencia.diasEnAgencia, {
        nombre: nombreLimpio,
        agencia: agenciaNombre,
        guia: c.numeroGuia,
        codigo: c.codigoRastreo,
        saldo: saldoSoles,
        medioPago: "Yape / Plin (*951365418* - Gerardo Huaynalaya)",
      });

      const entrega = await deliverMessage(
        c.convId,
        {
          text: mensajeAviso,
          template: {
            name: "aliv_aviso_agencia_shalom",
            language: "es",
            params: [
              nombreLimpio,
              agenciaNombre,
              c.numeroGuia,
              c.codigoRastreo || "SHALOM",
              saldoSoles.toFixed(2),
            ],
            previewText: mensajeAviso,
          },
        },
        "agent"
      );

      if (entrega.ok) {
        notificacionesEnviadas++;

        // A7: Guardar marca persistente «aviso de llegada enviado» directamente en el pedido
        const marcaAviso = `[AVISO_LLEGADA_ENVIADO:${new Date().toISOString().slice(0, 16)} guia=${c.numeroGuia}]`;
        const nuevasNotas = c.notasPedido
          ? `${c.notasPedido}\n${marcaAviso}`
          : marcaAviso;
        await db
          .update(pedidosOrdenes)
          .set({ notas: nuevasNotas, updatedAt: new Date() })
          .where(eq(pedidosOrdenes.id, c.pedidoId));

        // Aplicar etiquetas para trazabilidad y evitar spam
        await aplicarEtiquetaAContacto({
          contactId: c.contactId,
          etiqueta: "en agencia shalom",
          accion: "agregar",
          motivo: esRecordatorio
            ? "Recordatorio preventivo anti-devolución enviado"
            : "Paquete verificado en destino en Shalom listo para recojo",
        });

        // Registrar actividad en la ficha del contacto
        try {
          await db.insert(activities).values({
            type: "note",
            description: esRecordatorio
              ? `[SHALOM RECORDATORIO] Toque «${toque}» (día ${decisionCadencia.diasEnAgencia} en agencia) enviado: paquete en espera en ${agenciaNombre}. Saldo: S/ ${saldoSoles.toFixed(2)}.`
              : `[SHALOM LLEGADA] Notificación automática enviada: paquete listo para recojo en ${agenciaNombre}. Saldo: S/ ${saldoSoles.toFixed(2)}.`,
            contactId: c.contactId,
            dealId: c.dealId,
          });
        } catch (actErr) {
          console.warn("[notificar-llegada] Error registrando actividad:", actErr);
        }

        // Día 4 o más: tarea de llamada para una persona (una por día como máximo).
        if (toque === "riesgo") {
          try {
            await db.insert(activities).values({
              type: "call",
              description: `${PREFIJO_LLAMADA_AGENCIA} Llamar a ${c.contactName}: pedido #${c.numeroOrden} lleva ${decisionCadencia.diasEnAgencia} días en Shalom ${agenciaNombre} (guía ${c.numeroGuia}). Saldo pendiente: S/ ${saldoSoles.toFixed(2)}.`,
              contactId: c.contactId,
              dealId: c.dealId,
              scheduledAt: new Date(),
            });
          } catch (errCall) {
            console.warn("[notificar-llegada] Error creando tarea de llamada:", errCall);
          }
        }

        // Si lleva más de 24 horas en agencia sin retirar, alertar de inmediato a los supervisores (deduplicado 20h)
        if ((toque === "diario" || toque === "riesgo") && esHorarioAlertaSupervisores()) {
          try {
            const [supReciente] = await db
              .select({ id: activities.id })
              .from(activities)
              .where(
                and(
                  eq(activities.contactId, c.contactId),
                  sql`${activities.description} LIKE '[SHALOM ALERTA SUPERVISOR]%'`,
                  gt(activities.createdAt, sql`now() - interval '20 hours'`)
                )
              )
              .limit(1);

            if (!supReciente) {
              const { notificarSupervisoresCritico } = await import("@/lib/alerts/supervisor-alerts");
              const resSup = await notificarSupervisoresCritico({
                tipo: "shalom_24h_retraso",
                titulo: `Paquete >24h en Shalom: ${c.contactName}`,
                detalle: `El pedido #${c.numeroOrden} (Guía Shalom: ${c.numeroGuia}) lleva más de 24 horas en espera en la agencia Shalom ${agenciaNombre} sin ser recogido. Saldo pendiente: S/ ${saldoSoles.toFixed(2)}.`,
                clienteNombre: c.contactName,
                clienteTelefono: c.contactPhone,
                contactId: c.contactId,
                conversationId: c.convId,
              });
              if (resSup.notificados > 0) {
                await db.insert(activities).values({
                  type: "note",
                  description: `[SHALOM ALERTA SUPERVISOR] Alerta enviada a ${resSup.notificados} supervisores por recordatorio Shalom en ${agenciaNombre}.`,
                  contactId: c.contactId,
                  dealId: c.dealId,
                });
              }
            }
          } catch (errSup) {
            console.warn("[notificar-llegada] Error alertando a supervisores por Shalom >24h:", errSup);
          }
        }

        detalles.push({
          numeroOrden: c.numeroOrden,
          cliente: c.contactName,
          phone: c.contactPhone,
          guia: c.numeroGuia,
          agencia: agenciaNombre,
          saldo: saldoSoles,
          estadoLive: esRecordatorio ? `En destino (toque ${toque} enviado)` : "En destino (Aviso enviado exitosamente)",
          notificado: true,
        });
      } else {
        detalles.push({
          numeroOrden: c.numeroOrden,
          cliente: c.contactName,
          phone: c.contactPhone,
          guia: c.numeroGuia,
          agencia: agenciaNombre,
          saldo: saldoSoles,
          estadoLive: "En destino (Fallo de envío)",
          notificado: false,
          motivoNoNotificado: `Fallo deliverMessage: ${entrega.error}`,
        });
      }
    } else {
      // En tránsito
      detalles.push({
        numeroOrden: c.numeroOrden,
        cliente: c.contactName,
        phone: c.contactPhone,
        guia: c.numeroGuia,
        agencia: agenciaNombre,
        saldo: saldoSoles,
        estadoLive: "En tránsito",
        notificado: false,
        motivoNoNotificado: "Aún no ha llegado a la agencia de destino",
      });
    }
  }

  return {
    totalVerificados: filtrados.length,
    enDestinoListos,
    yaEntregados,
    notificacionesEnviadas,
    alertasCrmEnviadas,
    excluidos,
    detalles,
  };
}
