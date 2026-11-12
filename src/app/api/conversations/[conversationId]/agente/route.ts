import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { activities, contacts, conversations } from "@/db/schema";
import { eq } from "drizzle-orm";
import { requireMember } from "@/lib/api-auth";
import { canAccessContactId, displayName } from "@/lib/team";

interface Body {
  enabled?: boolean;
  clearNeedsHuman?: boolean;
}

/**
 * Pausa y reactivacion del agente POR CONVERSACION (handoff humano).
 *
 * - { enabled: false }                       -> pausa solo este hilo
 * - { enabled: true } o { clearNeedsHuman }  -> reactiva este hilo; si el contacto tenia
 *   el kill-switch global apagado o marcado "necesita humano", tambien lo limpia (si
 *   alguien reactiva un hilo es porque quiere que el agente vuelva a responder).
 *
 * Devuelve el estado combinado (contacto y conversacion), que es lo que muestra el chat.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ conversationId: string }> }) {
  const auth = await requireMember();
  if ("response" in auth) return auth.response;
  const { conversationId } = await params;

  let body: Body = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON invalido" }, { status: 400 });
  }

  const [conv] = await db.select().from(conversations).where(eq(conversations.id, conversationId)).limit(1);
  if (!conv || (conv.contactId && !(await canAccessContactId(auth.member, conv.contactId)))) {
    return NextResponse.json({ error: "Conversacion no encontrada" }, { status: 404 });
  }

  const now = new Date();
  const reactivar = body.enabled === true || body.clearNeedsHuman === true;

  if (reactivar) {
    await db
      .update(conversations)
      .set({
        ...(body.enabled === true ? { aiEnabled: true } : {}),
        needsHuman: false,
        needsHumanReason: null,
        needsHumanAt: null,
        updatedAt: now,
      })
      .where(eq(conversations.id, conversationId));
    if (conv.contactId && (body.enabled === true || body.clearNeedsHuman === true)) {
      await db
        .update(contacts)
        .set({
          ...(body.enabled === true ? { aiEnabled: true } : {}),
          needsHuman: false,
          needsHumanReason: null,
          needsHumanAt: null,
          updatedAt: now,
        })
        .where(eq(contacts.id, conv.contactId));
    }
  } else if (body.enabled === false) {
    await db
      .update(conversations)
      .set({ aiEnabled: false, updatedAt: now })
      .where(eq(conversations.id, conversationId));
  } else {
    return NextResponse.json({ error: "Nada para actualizar" }, { status: 400 });
  }

  // Registro de quien pausa, activa o atiende el bot (antes no quedaba rastro).
  if (conv.contactId) {
    const quien = displayName(auth.member);
    const hora = now.toLocaleString("es-PE", { timeZone: "America/Lima", dateStyle: "short", timeStyle: "short" });
    const accion =
      body.enabled === false
        ? "pausó el agente"
        : body.enabled === true
          ? "activó el agente"
          : "marcó la alerta como atendida (el agente sigue como estaba)";
    await db
      .insert(activities)
      .values({ type: "note", description: `${quien} ${accion} en esta conversación (${hora}).`, contactId: conv.contactId })
      .catch((err) => console.warn("[agente] no se pudo registrar la actividad:", err));
  }

  const [c2] = await db.select().from(conversations).where(eq(conversations.id, conversationId)).limit(1);
  const [contact] = conv.contactId
    ? await db.select().from(contacts).where(eq(contacts.id, conv.contactId)).limit(1)
    : [null];

  return NextResponse.json({
    conversationId,
    aiEnabled: (contact?.aiEnabled ?? true) && c2.aiEnabled,
    needsHuman: (contact?.needsHuman ?? false) || c2.needsHuman,
    needsHumanReason: c2.needsHumanReason ?? contact?.needsHumanReason ?? null,
  });
}
