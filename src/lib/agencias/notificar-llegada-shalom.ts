import "server-only";
import { db } from "@/db";
import { activities, contacts, conversations, deals, messages, pipelineStages, pipelines } from "@/db/schema";
import { pedidosOrdenes } from "../../../modules/pedidos/tabla";
import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { consultarEstadoShalom } from "./shalom-rastreo";
import { deliverMessage } from "@/lib/channels/deliver";
import { aplicarEtiquetaAContacto } from "../agent/etiquetado";
import { setDealStage } from "@/lib/deals/stage";

export interface OpcionesNotificarLlegada {
  forzarReenvio?: boolean;
  contactIdEspecifico?: string;
}

export interface ResultadoNotificacionLlegada {
  totalVerificados: number;
  enDestinoListos: number;
  yaEntregados: number;
  notificacionesEnviadas: number;
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

function esHorarioSeguroMensajes(): boolean {
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
    const decimal = hora + minuto / 60;
    return decimal >= 8.5 && decimal <= 19.5;
  } catch {
    return true;
  }
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
      dealId: pedidosOrdenes.dealId,
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
    .where(
      and(
        isNotNull(pedidosOrdenes.numeroGuia),
        isNotNull(pedidosOrdenes.codigoRastreo)
      )
    );

  const candidatos = await query;
  const filtrados = opts?.contactIdEspecifico
    ? candidatos.filter((c) => c.contactId === opts.contactIdEspecifico)
    : candidatos;

  let enDestinoListos = 0;
  let yaEntregados = 0;
  let notificacionesEnviadas = 0;
  const detalles: ResultadoNotificacionLlegada["detalles"] = [];

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

  for (const c of filtrados) {
    if (!c.numeroGuia || !c.codigoRastreo) continue;

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
      if (c.dealId && stageEntregadoId) {
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

      const tags = (c.contactTags || []).map((t) => t.toLowerCase().trim());
      const yaNotificado = tags.includes("en agencia shalom") || tags.includes("aviso_llegada_enviado");

      // Si ya fue notificado y no se fuerza reenvío, verificar si han pasado más de 20 horas desde el último mensaje
      // para enviar recordatorio preventivo anti-devolución de Shalom.
      let esRecordatorio = false;
      if (yaNotificado) {
        if (!forzar) {
          // Consultar último mensaje en la conversación para no saturar si ya se habló hace poco (< 20 horas)
          const [ultimoMsg] = await db
            .select({ createdAt: messages.createdAt, direction: messages.direction })
            .from(messages)
            .where(eq(messages.conversationId, c.convId || ""))
            .orderBy(desc(messages.createdAt))
            .limit(1);

          const horasDesdeUltimo = ultimoMsg?.createdAt
            ? (Date.now() - new Date(ultimoMsg.createdAt).getTime()) / (1000 * 60 * 60)
            : 999;

          if (horasDesdeUltimo < 20) {
            detalles.push({
              numeroOrden: c.numeroOrden,
              cliente: c.contactName,
              phone: c.contactPhone,
              guia: c.numeroGuia,
              agencia: agenciaNombre,
              saldo: saldoSoles,
              estadoLive: "En destino (ya avisado recientemente)",
              notificado: false,
              motivoNoNotificado: `Avisado hace ${horasDesdeUltimo.toFixed(1)}h. Se recordará automáticamente si supera 20h.`,
            });
            continue;
          }
        }
        esRecordatorio = true;
      }

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

      // Redactar mensaje: Primer aviso o Recordatorio Preventivo Anti-Devolución
      const mensajeAviso = esRecordatorio
        ? `¡Hola, ${nombreLimpio}! Te saludamos de Aliv Perú 🌿📦.

Te recordamos con mucho aprecio que tu pedido sigue listo en ventanilla de la *Agencia Shalom ${agenciaNombre}* 🏢.

• *N° de Orden Shalom:* ${c.numeroGuia}
• *Código:* ${c.codigoRastreo}

⏰ *Importante:* Recuerda que la agencia mantiene los paquetes por tiempo limitado antes de programar su devolución a almacén central.

Para enviarte tu *clave secreta de recojo* y puedas retirarlo hoy mismo con tu DNI físico en ventanilla, confírmanos por aquí el abono del saldo restante de *S/ ${saldoSoles.toFixed(2)}* a nuestro Yape / Plin (*951365418* - Gerardo Huaynalaya).

¿Nos confirmas si te acercas hoy a retirarlo? Quedamos a tu completa disposición. 🙌`
        : `¡Hola, ${nombreLimpio}! 👋 Te saludamos de Aliv Perú 🌿🚚.

¡Buenas noticias! Te confirmamos que tu paquete ya llegó y se encuentra listo para retirar en la *Agencia Shalom ${agenciaNombre}* 📦✨.

• *N° de Orden Shalom:* ${c.numeroGuia}
• *Código:* ${c.codigoRastreo}

Para enviarte tu *clave secreta de recojo* y puedas retirarlo hoy mismo con tu DNI físico en ventanilla, confírmanos por aquí el abono del saldo restante de *S/ ${saldoSoles.toFixed(2)}* a nuestro Yape / Plin (*951365418* - Gerardo Huaynalaya).

¿Nos compartes tu constancia por aquí para liberarte tu clave secreta de inmediato? 🔑🙌`;

      const entrega = await deliverMessage(
        c.convId,
        {
          text: mensajeAviso,
          template: {
            name: "aliv_pedido_en_agencia",
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
              ? `[SHALOM RECORDATORIO] Recordatorio preventivo de recojo enviado: paquete en espera en ${agenciaNombre}. Saldo: S/ ${saldoSoles.toFixed(2)}.`
              : `[SHALOM LLEGADA] Notificación automática enviada: paquete listo para recojo en ${agenciaNombre}. Saldo: S/ ${saldoSoles.toFixed(2)}.`,
            contactId: c.contactId,
            dealId: c.dealId,
          });
        } catch (actErr) {
          console.warn("[notificar-llegada] Error registrando actividad:", actErr);
        }

        detalles.push({
          numeroOrden: c.numeroOrden,
          cliente: c.contactName,
          phone: c.contactPhone,
          guia: c.numeroGuia,
          agencia: agenciaNombre,
          saldo: saldoSoles,
          estadoLive: esRecordatorio ? "En destino (Recordatorio enviado)" : "En destino (Aviso enviado exitosamente)",
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
    detalles,
  };
}
