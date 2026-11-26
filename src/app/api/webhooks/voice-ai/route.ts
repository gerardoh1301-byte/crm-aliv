import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import { db } from "@/db";
import { activities, contacts, conversations, crmSettings, webhookEvents } from "@/db/schema";
import { and, desc, eq, or } from "drizzle-orm";
import { pedidosOrdenes } from "../../../../../modules/pedidos/tabla";
import { sincronizarEtapaPipeline } from "../../../../../modules/pedidos/servidor";
import { analizarPayloadPostLlamada } from "@/lib/voice/procesar-post-llamada-reglas";
import { MARCA_LLAMADA_IA_RESULTADO } from "@/lib/voice/llamar-pedido-reglas";
import { agendarEventoCalendario } from "@/lib/agent/scheduler";
import { aplicarEtiquetaAContacto } from "@/lib/agent/etiquetado";
import { deliverMessage } from "@/lib/channels/deliver";
import { alertarEquipo } from "@/lib/agent/alertas";
import { notificarSupervisoresCritico } from "@/lib/alerts/supervisor-alerts";

export const dynamic = "force-dynamic";

async function leerSetting(key: string): Promise<string | null> {
  try {
    const [row] = await db
      .select({ value: crmSettings.value })
      .from(crmSettings)
      .where(eq(crmSettings.key, key))
      .limit(1);
    return row?.value?.trim() || null;
  } catch {
    return null;
  }
}

/**
 * Verifica la firma opcional `ElevenLabs-Signature` (`t=timestamp,v0=hash`) si el usuario
 * configuró `ELEVENLABS_WEBHOOK_SECRET`. Si no la configuró, acepta el webhook para facilitar
 * la puesta en marcha inmediata.
 */
async function verificarFirmaElevenLabs(rawBody: string, sigHeader: string | null): Promise<boolean> {
  const secret =
    process.env.ELEVENLABS_WEBHOOK_SECRET?.trim() || (await leerSetting("voice.elevenlabs_webhook_secret"));
  if (!secret) return true;
  if (!sigHeader) return false;

  const parts = Object.fromEntries(
    sigHeader.split(",").map((p) => {
      const [k, v] = p.trim().split("=");
      return [k, v ?? ""];
    })
  );
  const timestamp = parts.t;
  const v0 = parts.v0;
  if (!timestamp || !v0) return false;

  const expected = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`, "utf8").digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(v0);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Webhook post-llamada de ElevenLabs Conversational AI:
 * URL para configurar en ElevenLabs -> Agent Settings -> Webhooks -> Post-call webhook:
 *   https://crm-aliv.onrender.com/api/webhooks/voice-ai
 */
export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const sigHeader = req.headers.get("elevenlabs-signature") || req.headers.get("x-elevenlabs-signature");

  const firmaOk = await verificarFirmaElevenLabs(rawBody, sigHeader);
  if (!firmaOk) {
    return NextResponse.json({ error: "Firma de ElevenLabs inválida" }, { status: 401 });
  }

  let payload: Record<string, unknown> = {};
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const data = (
    payload.data && typeof payload.data === "object" ? (payload.data as Record<string, unknown>) : payload
  ) as Record<string, unknown>;

  const elConversationId = typeof data.conversation_id === "string" ? data.conversation_id : `voice-${Date.now()}`;

  try {
    await db
      .insert(webhookEvents)
      .values({
        eventId: `elevenlabs-${elConversationId}`,
        provider: "elevenlabs",
        event: String(payload.type || "post_call_transcription"),
        status: "processed",
        attempts: 1,
        payload,
      })
      .onConflictDoNothing();
  } catch (err) {
    console.warn("[voice-ai-webhook] error guardando evento:", err);
  }

  // Extraer variables dinámicas enviadas al iniciar la llamada
  const clientData = (
    data.conversation_initiation_client_data && typeof data.conversation_initiation_client_data === "object"
      ? data.conversation_initiation_client_data
      : {}
  ) as Record<string, unknown>;
  const dynVars = (
    clientData.dynamic_variables && typeof clientData.dynamic_variables === "object"
      ? clientData.dynamic_variables
      : {}
  ) as Record<string, unknown>;

  let pedidoId = typeof dynVars.pedido_id === "string" ? dynVars.pedido_id : null;
  let contactId = typeof dynVars.contact_id === "string" ? dynVars.contact_id : null;
  const numeroOrdenVar = typeof dynVars.numero_orden === "string" ? dynVars.numero_orden : null;

  // Buscar el pedido en la base de datos
  let pedido = null;
  if (pedidoId) {
    const [row] = await db.select().from(pedidosOrdenes).where(eq(pedidosOrdenes.id, pedidoId)).limit(1);
    pedido = row ?? null;
  }
  if (!pedido && numeroOrdenVar) {
    const [row] = await db
      .select()
      .from(pedidosOrdenes)
      .where(eq(pedidosOrdenes.numeroOrden, numeroOrdenVar))
      .limit(1);
    pedido = row ?? null;
  }
  if (!pedido && contactId) {
    const [row] = await db
      .select()
      .from(pedidosOrdenes)
      .where(eq(pedidosOrdenes.contactId, contactId))
      .orderBy(desc(pedidosOrdenes.createdAt))
      .limit(1);
    pedido = row ?? null;
  }

  if (pedido) {
    pedidoId = pedido.id;
    contactId = contactId || pedido.contactId;
  }

  if (!contactId) {
    return NextResponse.json({ ok: true, ignored: "sin_contact_id" });
  }

  const resultado = analizarPayloadPostLlamada(payload, pedido?.ciudad ?? (dynVars.ciudad as string | undefined));

  // 1. Actualizar campos del pedido y del contacto con la información que apuntó la IA
  const [contactoActual] = await db.select().from(contacts).where(eq(contacts.id, contactId)).limit(1);
  const cfActual = ((contactoActual?.customFields as Record<string, unknown> | null) ?? {});
  const nuevoCf: Record<string, unknown> = { ...cfActual };

  let nuevaDireccion = pedido?.direccionEnvio ?? ( cfActual.direccion_envio as string | undefined ) ?? "";
  if (resultado.agenciaShalomOficial) {
    nuevaDireccion = resultado.agenciaShalomOficial;
    nuevoCf.direccion_envio = resultado.agenciaShalomOficial;
    nuevoCf.agencia_shalom = resultado.agenciaShalomOficial;
  } else if (resultado.referenciaDomicilio) {
    const refLimpia = resultado.referenciaDomicilio.trim();
    if (nuevaDireccion && !nuevaDireccion.toLowerCase().includes(refLimpia.toLowerCase())) {
      nuevaDireccion = `${nuevaDireccion} (Ref: ${refLimpia})`;
    } else if (!nuevaDireccion) {
      nuevaDireccion = `Ref: ${refLimpia}`;
    }
    nuevoCf.direccion_envio = nuevaDireccion;
    nuevoCf.referencia_domicilio = refLimpia;
  }

  const nuevoDistrito = resultado.distritoExtraido || pedido?.distrito || (cfActual.distrito as string | undefined) || null;
  if (nuevoDistrito) nuevoCf.distrito = nuevoDistrito;

  const nuevoDni = resultado.dniExtraido || pedido?.dniCliente || (cfActual.dni_ruc as string | undefined) || null;
  if (nuevoDni) nuevoCf.dni_ruc = nuevoDni;

  if (resultado.horarioEntrega) {
    nuevoCf.horario_entrega = resultado.horarioEntrega;
  }

  await db
    .update(contacts)
    .set({
      customFields: nuevoCf,
      updatedAt: new Date(),
    })
    .where(eq(contacts.id, contactId));

  // 2. Actualizar el pedido en pedidos_ordenes
  if (pedido) {
    const esAgencia = pedido.modalidadPago === "adelanto_agencia";
    // En Contraentrega (COD): si el cliente confirmó en la llamada, el pedido pasa a "confirmado"
    // y a la etapa "agendar_entrega" (Pedido confirmado por despachar).
    // En Agencia Shalom: sigue en "por_confirmar_cod" (por_validar) hasta verificar el Yape de S/ 20,
    // pero ya queda con su DNI y su agencia Shalom oficial apuntados en el pedido.
    let nuevoEstado = pedido.estado;
    if (resultado.estadoConfirmacion === "cancelado") {
      nuevoEstado = "cancelado";
    } else if (resultado.estadoConfirmacion === "confirmado" && !esAgencia) {
      nuevoEstado = "confirmado";
    }

    const marcaResultado = [
      `${MARCA_LLAMADA_IA_RESULTADO} ${new Date().toISOString()} estado=${resultado.estadoConfirmacion} duracion=${resultado.duracionSegundos}s`,
      resultado.referenciaDomicilio ? `Ref: ${resultado.referenciaDomicilio}` : null,
      resultado.horarioEntrega ? `Horario: ${resultado.horarioEntrega}` : null,
      resultado.dniExtraido ? `DNI: ${resultado.dniExtraido}` : null,
      resultado.agenciaShalomOficial ? `Agencia: ${resultado.agenciaShalomOficial}` : null,
    ]
      .filter(Boolean)
      .join(" | ");

    await db
      .update(pedidosOrdenes)
      .set({
        estado: nuevoEstado,
        direccionEnvio: nuevaDireccion || pedido.direccionEnvio,
        distrito: nuevoDistrito ?? pedido.distrito,
        dniCliente: nuevoDni ?? pedido.dniCliente,
        notas: [pedido.notas, marcaResultado].filter(Boolean).join("\n"),
        updatedAt: new Date(),
      })
      .where(eq(pedidosOrdenes.id, pedido.id));

    const primerProd = pedido.items?.[0]?.titulo ?? "Pedido Aliv";
    if (resultado.estadoConfirmacion === "cancelado") {
      await sincronizarEtapaPipeline(
        contactId,
        "cancelado",
        `${pedido.numeroOrden} · ${primerProd}`,
        Number(pedido.total) || 0,
        pedido.id,
        pedido.dealId,
        "cancelado_rechazado"
      );
      await aplicarEtiquetaAContacto({
        contactId,
        etiqueta: "Cancelado",
        accion: "establecer_estado",
        motivo: "Cliente canceló el pedido durante la llamada automática de confirmación",
      }).catch(() => {});
    } else if (resultado.estadoConfirmacion === "confirmado") {
      await sincronizarEtapaPipeline(
        contactId,
        nuevoEstado as any,
        `${pedido.numeroOrden} · ${primerProd}`,
        Number(pedido.total) || 0,
        pedido.id,
        pedido.dealId,
        esAgencia ? "por_validar" : "agendar_entrega"
      );
      await aplicarEtiquetaAContacto({
        contactId,
        etiqueta: esAgencia ? "Pendiente de adelanto" : "pedido confirmado",
        accion: "establecer_estado",
        motivo: "Pedido reconfirmado por llamada de IA",
      }).catch(() => {});
    }
  }

  // 3. Si el cliente acordó un horario/día de entrega en la llamada, agendarlo en el Calendario del CRM
  if (resultado.horarioEntrega && resultado.estadoConfirmacion !== "cancelado") {
    await agendarEventoCalendario({
      contactId,
      tipo: "delivery",
      horario: resultado.horarioEntrega,
      descripcion: `Entrega confirmada por llamada IA${pedido ? ` (${pedido.numeroOrden})` : ""}: ${resultado.horarioEntrega}`,
      direccion: nuevaDireccion,
      monto: pedido ? Number(pedido.total) : undefined,
    }).catch((err) => console.warn("[voice-ai-webhook] error agendando calendario:", err));
  }

  // 4. Registrar la llamada + transcripción en el historial de actividades del contacto
  const descripcionActividad = [
    `📞 [Llamada IA de Confirmación${pedido ? ` · ${pedido.numeroOrden}` : ""}]`,
    resultado.resumenLlamada,
    resultado.transcripcionTexto ? `\n--- Transcripción ---\n${resultado.transcripcionTexto.slice(0, 1800)}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  await db.insert(activities).values({
    type: "call",
    description: descripcionActividad.slice(0, 2500),
    contactId,
    dealId: pedido?.dealId ?? null,
    completedAt: new Date(),
  });

  // 5. Si el cliente NO contestó la llamada, enviarle un toque amable en su hilo de WhatsApp
  const [conv] = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(and(eq(conversations.contactId, contactId), eq(conversations.channel, "whatsapp")))
    .orderBy(desc(conversations.lastMessageAt))
    .limit(1);

  if (!resultado.contestada && conv && pedido) {
    const nombreCorto = (contactoActual?.name || "Hola").split(" ")[0];
    const esAg = pedido.modalidadPago === "adelanto_agencia";
    const textoNoContesto = esAg
      ? `¡Hola, ${nombreCorto}! 📞 Te acabamos de timbrar de Aliv Perú para confirmar el envío de tu pedido ${pedido.numeroOrden} a ${pedido.ciudad || "provincia"}. Por favor respóndenos por aquí con tu número de DNI y la agencia Shalom que prefieres para dejar lista tu guía. 💚`
      : `¡Hola, ${nombreCorto}! 📞 Te acabamos de timbrar de Aliv Perú para dejar programada la entrega de tu pedido ${pedido.numeroOrden} (${nuevaDireccion || pedido.ciudad || "a domicilio"}). ¿Me confirmas por aquí una referencia de tu casa y en qué horario te encontramos? Pagas al recibir. 💚`;
    await deliverMessage(conv.id, { text: textoNoContesto }, "agent").catch(() => {});
  }

  // 6. Avisar al equipo y supervisores con el resultado de la llamada y los datos apuntados
  await alertarEquipo({
    contactId,
    conversationId: conv?.id ?? null,
    titulo: `📞 Llamada IA (${pedido?.numeroOrden ?? "Pedido"}): ${
      resultado.estadoConfirmacion === "confirmado"
        ? "Confirmado"
        : resultado.estadoConfirmacion === "cancelado"
        ? "Cancelado"
        : resultado.contestada
        ? "Atendida"
        : "No contestó"
    }`,
    cuerpo: resultado.resumenLlamada.slice(0, 400),
  }).catch(() => {});

  if (resultado.contestada) {
    await notificarSupervisoresCritico({
      tipo: "pedido_shopify",
      titulo: `📞 Llamada IA finalizada · ${pedido?.numeroOrden ?? ""}`,
      detalle: resultado.resumenLlamada.replace(/\n+/g, " · "),
      clienteNombre: contactoActual?.name,
      clienteTelefono: contactoActual?.phone,
      contactId,
      conversationId: conv?.id ?? null,
    }).catch(() => {});
  }

  return NextResponse.json({
    ok: true,
    pedidoId,
    contactId,
    estadoConfirmacion: resultado.estadoConfirmacion,
    datosCapturados: {
      dni: resultado.dniExtraido,
      referencia: resultado.referenciaDomicilio,
      distrito: resultado.distritoExtraido,
      horario: resultado.horarioEntrega,
      agenciaShalom: resultado.agenciaShalomOficial,
    },
  });
}
