import "server-only";
import { db } from "@/db";
import { contacts, conversations, messages } from "@/db/schema";
import { and, desc, eq, gt, like } from "drizzle-orm";
import { deliverMessage } from "@/lib/channels/deliver";
import { SUPERVISORES } from "@/lib/alerts/perfiles-supervisor";
import { VENTANA_WHATSAPP_MS } from "@/lib/channels/ventana-24h";
import {
  MARCA_AVISO_VENTANA,
  debeAvisarVentana,
  esRenovacionVentana,
  horaCierreTexto,
  textoAvisoVentana,
} from "@/lib/alerts/ventana-supervisor";

async function conversacionDe(digitos: string): Promise<string | null> {
  const [c] = await db.select({ id: contacts.id }).from(contacts).where(eq(contacts.phone, `+51${digitos}`)).limit(1);
  if (!c) return null;
  const [conv] = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(and(eq(conversations.contactId, c.id), eq(conversations.channel, "whatsapp")))
    .limit(1);
  return conv?.id ?? null;
}

async function ultimoEntrante(conversationId: string): Promise<Date | null> {
  const [m] = await db
    .select({ createdAt: messages.createdAt })
    .from(messages)
    .where(and(eq(messages.conversationId, conversationId), eq(messages.direction, "in")))
    .orderBy(desc(messages.createdAt))
    .limit(1);
  return m?.createdAt ?? null;
}

/** Barrido: avisa a cada supervisor cuya ventana de 24 h está por cerrarse (una vez por ventana). */
export async function procesarAvisosVentana(opts: { ahora?: Date } = {}) {
  const ahora = opts.ahora ?? new Date();
  const resultado: { nombre: string; enviado: boolean; motivo: string }[] = [];
  for (const sup of SUPERVISORES) {
    try {
      const conv = await conversacionDe(sup.digitos);
      if (!conv) {
        resultado.push({ nombre: sup.nombre, enviado: false, motivo: "sin_conversacion" });
        continue;
      }
      const entrante = await ultimoEntrante(conv);
      let yaAvisado = false;
      if (entrante) {
        const [aviso] = await db
          .select({ id: messages.id })
          .from(messages)
          .where(
            and(
              eq(messages.conversationId, conv),
              eq(messages.direction, "out"),
              gt(messages.createdAt, entrante),
              like(messages.body, `${MARCA_AVISO_VENTANA}%`)
            )
          )
          .limit(1);
        yaAvisado = Boolean(aviso);
      }
      if (!debeAvisarVentana(entrante, yaAvisado, ahora)) {
        resultado.push({ nombre: sup.nombre, enviado: false, motivo: "no_toca" });
        continue;
      }
      const cierre = new Date(entrante!.getTime() + VENTANA_WHATSAPP_MS);
      const res = await deliverMessage(conv, { text: textoAvisoVentana(sup.nombre, cierre) }, "agent");
      resultado.push({ nombre: sup.nombre, enviado: res.ok, motivo: res.ok ? "enviado" : res.error ?? "error" });
      if (!res.ok) console.warn(`[ventana-supervisor] no se pudo avisar a ${sup.nombre}: ${res.error}`);
    } catch (err) {
      console.warn(`[ventana-supervisor] error con ${sup.nombre}:`, err);
      resultado.push({ nombre: sup.nombre, enviado: false, motivo: "error" });
    }
  }
  return { resultado };
}

/**
 * Si el último mensaje del supervisor es solo para renovar la ventana («ok», «👍»), le confirma
 * hasta cuándo queda abierta, sin IA. Devuelve true si lo atendió.
 */
export async function manejarRenovacionVentana(conversationId: string): Promise<boolean> {
  const [ultimo] = await db
    .select({ body: messages.body, direction: messages.direction, createdAt: messages.createdAt })
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(desc(messages.createdAt))
    .limit(1);
  if (!ultimo || ultimo.direction !== "in" || !esRenovacionVentana(ultimo.body)) return false;
  const cierre = new Date(ultimo.createdAt.getTime() + VENTANA_WHATSAPP_MS);
  await deliverMessage(conversationId, { text: `✅ Ventana renovada hasta el ${horaCierreTexto(cierre)} (hora Perú).` }, "agent");
  return true;
}
