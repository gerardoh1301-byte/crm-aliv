import "server-only";
import { db } from "@/db";
import { conversations, messages } from "@/db/schema";
import { and, desc, eq, gte } from "drizzle-orm";
import { getAccountById } from "./accounts";
import { conectorParaConversacion } from "./conectores";
import type { ConversationRow, OutboundMessage } from "./conector";
import { touchConversation } from "./ingest";
import { conversacionEnNumeroBot, esCuentaDeVendedor } from "./numeros";
import type { Channel } from "./types";
import { aplicaVentana24h, fueraDeVentana24h } from "./ventana-24h";

const VENTANA_DEDUP_MS = 10 * 60 * 1000; // A7: 10 minutos sin reenviar el mismo texto a la misma conversación
const recentOutboundMemory = new Map<string, { normText: string; sentAt: number; messageId: string | null }>();

export function normalizarTextoDedup(texto: string): string {
  return texto.replace(/\s+/g, " ").trim().toLowerCase();
}

export function limpiarCacheDedupMensajes(): void {
  recentOutboundMemory.clear();
}

/**
 * Unico camino de salida del sistema: envia por el conector de la conversacion y
 * persiste. Nada mas sale a la red: el agente, el chat y las plantillas pasan por aqui.
 */

export interface DeliverResult {
  ok: boolean;
  messageId: string | null;
  externalId?: string | null;
  error?: string;
  hint?: string;
}

export type DeliverOrigin = "agent" | "human" | "template";

export async function getConversationRow(
  conversationId: string
): Promise<ConversationRow | null> {
  const [row] = await db
    .select()
    .from(conversations)
    .where(eq(conversations.id, conversationId))
    .limit(1);
  return row ?? null;
}

export async function deliverMessage(
  conversationId: string,
  msg: OutboundMessage,
  origin: DeliverOrigin = "human",
  /**
   * permitirRepetido: se salta el filtro A7 de mensajes idénticos. Solo para las respuestas
   * a órdenes del supervisor: si Gerardo vuelve a preguntar, quiere la respuesta otra vez
   * (el 23/11 «Código de retiro» se quedó sin respuesta por este filtro).
   */
  opts: { permitirRepetido?: boolean } = {}
): Promise<DeliverResult> {
  let conversation = await getConversationRow(conversationId);
  if (!conversation) {
    return { ok: false, messageId: null, error: "conversation_not_found" };
  }

  // Número de un vendedor: lo automático (bot, plantillas, avisos) sale por el número del
  // bot, que es el que tiene las plantillas aprobadas. Solo lo que escribe una persona sale
  // por el número del vendedor. Ver numeros-reglas.ts.
  if (origin !== "human" && conversation.channel === "whatsapp" && (await esCuentaDeVendedor(conversation.accountId))) {
    const idBot = await conversacionEnNumeroBot(conversation);
    const enBot = idBot ? await getConversationRow(idBot) : null;
    if (!idBot || !enBot) {
      return {
        ok: false,
        messageId: null,
        error: "sin_chat_en_numero_bot",
        hint: "El chat es del número de un vendedor y no se pudo abrir el chat en el número del bot.",
      };
    }
    console.info(`[deliver] ${origin} desde el número del vendedor redirigido al número del bot: ${conversationId} -> ${idBot}`);
    conversation = enBot;
    conversationId = idBot;
  }

  const conector = conectorParaConversacion(conversation);
  if (!conector) {
    return {
      ok: false,
      messageId: null,
      error: `sin conector para el proveedor "${conversation.provider}"`,
    };
  }

  let body = bodyOf(msg);
  if (!body) {
    return { ok: false, messageId: null, error: "mensaje vacio" };
  }

  // BLINDAJE CRÍTICO DE SEGURIDAD (ANTI-FILTRACIÓN DE CLAVE DE RETIRO):
  // Bajo ninguna circunstancia el bot/IA (origin === "agent") puede enviar una clave de retiro o código de recojo.
  if (origin === "agent") {
    const patronClave = /(?:clave(?:\s+secreta)?(?:\s+de)?\s*(?:recojo|retiro)?|código(?:\s+secreto)?(?:\s+de)?\s*(?:recojo|retiro)?)\s*(?:es|:|sería)?\s*[\*\(]?(\d{3,6})[\*\)]?/gi;
    if (patronClave.test(body)) {
      console.warn("[deliverMessage] ⚠️ GUARDRAIL ACTIVADO: La IA intentó enviar una clave de retiro. Purgando código del mensaje saliente...");
      body = body.replace(patronClave, "clave de retiro (que te enviará un asesor humano una vez verificado tu abono)");
    }
    body = body.replace(/tu clave de recojo \([^\)]+\)/gi, "tu clave de retiro (que te compartirá un asesor humano)");
    body = body.replace(/\b\(?0011\)?\b/g, "[verificación humana]");
  }

  // E4: fuera de la ventana de 24 h Meta rechaza el texto libre. Un mensaje del bot sin
  // plantilla no sale (el que llama decide: plantilla, nota o nada) en vez de quedar como
  // «fallido» en el chat y gastar la reputación del número.
  if (origin === "agent" && !msg.template && aplicaVentana24h(conversation.channel, conversation.provider)) {
    const [ultimoEntrante] = await db
      .select({ createdAt: messages.createdAt })
      .from(messages)
      .where(and(eq(messages.conversationId, conversation.id), eq(messages.direction, "in")))
      .orderBy(desc(messages.createdAt))
      .limit(1);
    if (fueraDeVentana24h(ultimoEntrante?.createdAt ?? null)) {
      console.warn(`[deliverMessage] E4: texto del bot omitido en ${conversation.id}: fuera de la ventana de 24 h`);
      return {
        ok: false,
        messageId: null,
        error: "fuera_de_ventana_24h",
        hint: "El cliente no escribe hace más de 24 h: solo se puede enviar una plantilla aprobada.",
      };
    }
  }

  // Asegurar que el mensaje saliente real lleve el body sanitizado
  const msgToSend: OutboundMessage = msg.text ? { ...msg, text: body } : msg;

  // A7: Evitar reenviar un mensaje con el mismo texto a la misma conversación dentro de 10 minutos
  const normBody = normalizarTextoDedup(body);
  const nowMs = Date.now();
  const memPrev = opts.permitirRepetido ? undefined : recentOutboundMemory.get(conversationId);
  if (memPrev && memPrev.normText === normBody && nowMs - memPrev.sentAt < VENTANA_DEDUP_MS) {
    console.warn(`[deliverMessage] A7 Dedup (memoria): mensaje idéntico omitido en conversación ${conversationId}`);
    return {
      ok: true,
      messageId: memPrev.messageId,
      hint: "deduplicated_within_10m",
    };
  }

  const hace10Min = new Date(nowMs - VENTANA_DEDUP_MS);
  const recientesOut = opts.permitirRepetido ? [] : await db
    .select({ id: messages.id, body: messages.body, status: messages.status })
    .from(messages)
    .where(
      and(
        eq(messages.conversationId, conversation.id),
        eq(messages.direction, "out"),
        gte(messages.createdAt, hace10Min)
      )
    )
    .orderBy(desc(messages.createdAt))
    .limit(5);

  const duplicadoReciente = recientesOut.find(
    (m) => m.status !== "failed" && m.body && normalizarTextoDedup(m.body) === normBody
  );
  if (duplicadoReciente) {
    recentOutboundMemory.set(conversationId, {
      normText: normBody,
      sentAt: nowMs,
      messageId: duplicadoReciente.id,
    });
    console.warn(`[deliverMessage] A7 Dedup (BD): mensaje idéntico omitido en conversación ${conversationId}`);
    return {
      ok: true,
      messageId: duplicadoReciente.id,
      hint: "deduplicated_within_10m",
    };
  }

  recentOutboundMemory.set(conversationId, {
    normText: normBody,
    sentAt: nowMs,
    messageId: null,
  });

  // Fila optimista antes de salir a la red: si el proveedor tarda o falla, el mensaje
  // ya esta en el hilo y el usuario ve el estado real en vez de que desaparezca.
  const [pending] = await db
    .insert(messages)
    .values({
      contactId: conversation.contactId,
      conversationId: conversation.id,
      channel: conversation.channel,
      provider: conversation.provider,
      direction: "out",
      origin,
      type: msgToSend.attachments?.length ? (msgToSend.attachments[0].type ?? "image") : msgToSend.template ? "template" : "text",
      body,
      rawPayload: (msgToSend.attachments?.length || msgToSend.replyTo || msgToSend.quotedText) ? {
        ...(msgToSend.attachments?.length ? { attachments: msgToSend.attachments } : {}),
        ...(msgToSend.replyTo ? { replyTo: msgToSend.replyTo } : {}),
        ...(msgToSend.quotedText ? { quotedText: msgToSend.quotedText, quotedSender: msgToSend.quotedSender } : {}),
      } : null,
      templateName: msgToSend.template?.name ?? null,
      status: "pending",
      tenantId: conversation.tenantId,
      toPhone:
        conversation.channel === "whatsapp" ? conversation.participantId : null,
      sentAt: new Date(),
      createdAt: new Date(),
    })
    .returning({ id: messages.id });

  const account = await getAccountById(conversation.accountId);
  const outcome = await conector.enviar(
    { conversation, account, channel: conversation.channel as Channel },
    msgToSend
  );

  if (!outcome.success) {
    recentOutboundMemory.delete(conversationId);
    const errorText = outcome.error?.message ?? "error desconocido";
    await db
      .update(messages)
      .set({ status: "failed", errorMessage: JSON.stringify(outcome.error ?? {}) })
      .where(eq(messages.id, pending.id));

    console.error(
      `[deliver] fallo el envio (${origin}, ${conversation.channel}/${conversation.provider}):`,
      errorText
    );
    return {
      ok: false,
      messageId: pending.id,
      error: errorText,
      hint: outcome.hint,
    };
  }

  await db
    .update(messages)
    .set({ status: "sent", externalId: outcome.externalId ?? null })
    .where(eq(messages.id, pending.id));

  await touchConversation(conversation.id, {
    direction: "out",
    body,
    sentAt: new Date(),
  });

  return {
    ok: true,
    messageId: pending.id,
    externalId: outcome.externalId ?? null,
  };
}

/**
 * Persistencia de un saliente que ya se envio por fuera del adapter.
 *
 * Lo usa el agente cuando le inyectan un sender propio (el experimento de GHL): el
 * transporte es ajeno pero la fila tiene que quedar igual de bien formada que el resto.
 */
export async function persistOutbound(
  conversation: ConversationRow,
  body: string,
  externalId: string | null
): Promise<string> {
  const now = new Date();
  const [row] = await db
    .insert(messages)
    .values({
      contactId: conversation.contactId,
      conversationId: conversation.id,
      channel: conversation.channel,
      provider: conversation.provider,
      direction: "out",
      origin: "human",
      type: "text",
      body,
      externalId,
      status: "sent",
      tenantId: conversation.tenantId,
      sentAt: now,
      createdAt: now,
    })
    .returning({ id: messages.id });

  await touchConversation(conversation.id, {
    direction: "out",
    body,
    sentAt: now,
  });

  return row.id;
}

function bodyOf(msg: OutboundMessage): string | null {
  if (msg.text?.trim()) return msg.text.trim();
  if (msg.template) {
    return msg.template.previewText?.trim() || `[plantilla] ${msg.template.name}`;
  }
  if (msg.attachments?.length) {
    return msg.attachments[0].name || `[imagen] ${msg.attachments[0].url}`;
  }
  return null;
}
