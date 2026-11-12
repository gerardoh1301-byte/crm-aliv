import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { activities, contacts } from "@/db/schema";
import { eq } from "drizzle-orm";
import { canAccessContactId, displayName } from "@/lib/team";
import { requireMember } from "@/lib/api-auth";

interface Body {
  enabled?: boolean;
  clearNeedsHuman?: boolean;
}

/**
 * Toggle del agente IA por contacto.
 * - { enabled: true, clearNeedsHuman: true }  -> reactivar bot (lo mas comun, ej. cliente cerro caso humano)
 * - { enabled: false }                         -> apagar bot manualmente
 * - { clearNeedsHuman: true }                  -> solo limpiar bandera de "necesita humano"
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireMember();
  if ("response" in auth) return auth.response;
  const { member } = auth;
  const { id } = await params;
  let body: Body = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!(await canAccessContactId(member, id))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const update: Partial<typeof contacts.$inferInsert> = {
    updatedAt: new Date(),
  };
  if (typeof body.enabled === "boolean") update.aiEnabled = body.enabled;
  if (body.clearNeedsHuman) {
    update.needsHuman = false;
    update.needsHumanReason = null;
    update.needsHumanAt = null;
  }

  if (Object.keys(update).length === 1) {
    return NextResponse.json(
      { error: "Nada para actualizar" },
      { status: 400 }
    );
  }

  if (typeof body.enabled === "boolean" || body.clearNeedsHuman) {
    const hora = new Date().toLocaleString("es-PE", { timeZone: "America/Lima", dateStyle: "short", timeStyle: "short" });
    const accion =
      body.enabled === false ? "pausó el agente" : body.enabled === true ? "activó el agente" : "marcó la alerta como atendida";
    await db
      .insert(activities)
      .values({ type: "note", description: `${displayName(member)} ${accion} para todo el contacto (${hora}).`, contactId: id })
      .catch((err) => console.warn("[contacts/ai] no se pudo registrar la actividad:", err));
  }

  const [updated] = await db
    .update(contacts)
    .set(update)
    .where(eq(contacts.id, id))
    .returning({
      id: contacts.id,
      aiEnabled: contacts.aiEnabled,
      needsHuman: contacts.needsHuman,
      needsHumanReason: contacts.needsHumanReason,
    });

  if (!updated) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json(updated);
}
