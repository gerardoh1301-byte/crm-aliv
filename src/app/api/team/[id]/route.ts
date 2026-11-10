import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { contacts, crmSettings, teamMembers } from "@/db/schema";
import { and, eq, ne } from "drizzle-orm";
import { requireAdmin } from "@/lib/api-auth";
import { MASTER_GOOGLE_EMAIL } from "@/app/api/auth/local/perfiles/route";

export const dynamic = "force-dynamic";

/** Editar nombre, rol, estado o PIN individual de un miembro (solo admin). */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdmin();
  if ("response" in auth) return auth.response;
  const { id } = await params;

  let body: { name?: string; role?: string; active?: boolean; pin?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON invalido" }, { status: 400 });
  }

  const [target] = await db
    .select()
    .from(teamMembers)
    .where(eq(teamMembers.id, id))
    .limit(1);
  if (!target) {
    return NextResponse.json({ error: "Miembro no encontrado" }, { status: 404 });
  }

  // Proteger la cuenta maestra para que nunca quede desactivada ni pierda el rol admin
  if (target.email.toLowerCase() === MASTER_GOOGLE_EMAIL) {
    if (body.active === false || (body.role && body.role !== "admin")) {
      return NextResponse.json(
        { error: `La cuenta maestra (${MASTER_GOOGLE_EMAIL}) no puede desactivarse ni perder el rol de Administrador.` },
        { status: 400 }
      );
    }
  }

  const update: Partial<typeof teamMembers.$inferInsert> = { updatedAt: new Date() };
  if (body.name !== undefined) update.name = body.name.trim() || null;
  if (body.role !== undefined) update.role = body.role === "admin" ? "admin" : "asesor";
  if (body.active !== undefined) update.active = Boolean(body.active);

  // No dejar el equipo sin ningun admin activo
  const quitaAdmin =
    target.role === "admin" &&
    target.active &&
    (update.role === "asesor" || update.active === false);
  if (quitaAdmin) {
    const otros = await db
      .select({ id: teamMembers.id })
      .from(teamMembers)
      .where(
        and(
          eq(teamMembers.role, "admin"),
          eq(teamMembers.active, true),
          ne(teamMembers.id, id)
        )
      );
    if (otros.length === 0) {
      return NextResponse.json(
        { error: "Es el unico administrador activo. Nombra otro antes." },
        { status: 400 }
      );
    }
  }

  if (typeof body.pin === "string") {
    const key = `auth.pin.${target.email.toLowerCase()}`;
    const pinClean = body.pin.trim();
    await db
      .insert(crmSettings)
      .values({ key, value: pinClean })
      .onConflictDoUpdate({
        target: crmSettings.key,
        set: { value: pinClean },
      });
  }

  const [row] = await db
    .update(teamMembers)
    .set(update)
    .where(eq(teamMembers.id, id))
    .returning();

  return NextResponse.json(row);
}

/** Eliminar una cuenta Google de vendedor del equipo (solo admin). */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdmin();
  if ("response" in auth) return auth.response;
  const { id } = await params;

  const [target] = await db
    .select()
    .from(teamMembers)
    .where(eq(teamMembers.id, id))
    .limit(1);

  if (!target) {
    return NextResponse.json({ error: "Miembro no encontrado" }, { status: 404 });
  }

  if (target.email.toLowerCase() === MASTER_GOOGLE_EMAIL) {
    return NextResponse.json(
      { error: `No se puede eliminar la cuenta Google Maestra (${MASTER_GOOGLE_EMAIL}).` },
      { status: 400 }
    );
  }

  // Liberar contactos asignados antes de borrar
  await db
    .update(contacts)
    .set({ ownerId: null, updatedAt: new Date() })
    .where(eq(contacts.ownerId, id));

  await db.delete(teamMembers).where(eq(teamMembers.id, id));

  return NextResponse.json({ ok: true });
}
