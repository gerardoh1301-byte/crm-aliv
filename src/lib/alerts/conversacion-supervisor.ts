import "server-only";
import { db } from "@/db";
import { contacts, conversations } from "@/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { deliverMessage } from "@/lib/channels/deliver";
import { cuentaBotWhatsapp } from "@/lib/channels/numeros";

/**
 * Chat de WhatsApp de un supervisor con el número del bot (por donde salen los avisos
 * internos). Desde el 25/11 un contacto puede tener chat con el 944 y con el número de un
 * vendedor: sin este orden, el aviso o el cálculo de su ventana de 24 h podían tomar el chat
 * equivocado.
 */
export async function conversacionInternaDe(digitos: string): Promise<string | null> {
  const [c] = await db.select({ id: contacts.id }).from(contacts).where(eq(contacts.phone, `+51${digitos}`)).limit(1);
  if (!c) return null;
  const bot = await cuentaBotWhatsapp();
  const [conv] = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(and(eq(conversations.contactId, c.id), eq(conversations.channel, "whatsapp")))
    .orderBy(
      bot ? sql`case when ${conversations.accountId} = ${bot.id} then 0 else 1 end` : sql`0`,
      sql`${conversations.lastInboundAt} desc nulls last`
    )
    .limit(1);
  return conv?.id ?? null;
}

/** Envía un texto interno (sin plantilla) a un supervisor por el número del bot. */
export async function enviarTextoInterno(
  digitos: string,
  texto: string
): Promise<{ ok: boolean; error?: string }> {
  const conv = await conversacionInternaDe(digitos);
  if (!conv) return { ok: false, error: "sin_conversacion" };
  const res = await deliverMessage(conv, { text: texto } /* aviso interno: siempre texto libre, nunca plantilla */, "agent");
  return res.ok ? { ok: true } : { ok: false, error: res.error ?? "error" };
}
