import { NextResponse } from "next/server";
import { db } from "@/db";
import { crmSettings, teamMembers } from "@/db/schema";
import { asc, eq } from "drizzle-orm";
import { ID_MIEMBRO_LOCAL, ID_VENDEDOR_LOCAL } from "@/lib/modo-local";

export const dynamic = "force-dynamic";

export const MASTER_GOOGLE_EMAIL = (
  process.env.MASTER_GOOGLE_EMAIL || "gerardoh1301@gmail.com"
)
  .trim()
  .toLowerCase();

export async function GET() {
  try {
    const rows = await db.select().from(teamMembers).orderBy(asc(teamMembers.createdAt));

    // Asegurar que la cuenta Google Maestra (gerardoh1301@gmail.com) siempre exista y este activa como admin
    const adminPorId = rows.find((r) => r.id === ID_MIEMBRO_LOCAL);
    const adminPorCorreo = rows.find(
      (r) => r.email.toLowerCase() === MASTER_GOOGLE_EMAIL
    );

    if (!adminPorId && !adminPorCorreo) {
      await db
        .insert(teamMembers)
        .values({
          id: ID_MIEMBRO_LOCAL,
          email: MASTER_GOOGLE_EMAIL,
          name: "Gerardo Huaynalaya (Maestro)",
          role: "admin",
          active: true,
        })
        .onConflictDoNothing();
    } else if (adminPorId && adminPorId.email === "admin@alivstore.shop" && !adminPorCorreo) {
      // Migrar el admin por defecto al correo Google Maestro del propietario
      await db
        .update(teamMembers)
        .set({
          email: MASTER_GOOGLE_EMAIL,
          name: "Gerardo Huaynalaya (Maestro)",
          role: "admin",
          active: true,
          updatedAt: new Date(),
        })
        .where(eq(teamMembers.id, ID_MIEMBRO_LOCAL));
    } else if (adminPorCorreo && (!adminPorCorreo.active || adminPorCorreo.role !== "admin")) {
      await db
        .update(teamMembers)
        .set({
          role: "admin",
          active: true,
          updatedAt: new Date(),
        })
        .where(eq(teamMembers.id, adminPorCorreo.id));
    }

    // Asegurar al menos un perfil vendedor base si no hay asesores registrados
    const tieneVendedor = rows.some((r) => r.role === "asesor");
    if (!tieneVendedor) {
      await db
        .insert(teamMembers)
        .values({
          id: ID_VENDEDOR_LOCAL,
          email: "vendedor@alivstore.shop",
          name: "Vendedor Aliv",
          role: "asesor",
          active: true,
        })
        .onConflictDoNothing();
    }

    const miembrosActuales = await db
      .select()
      .from(teamMembers)
      .where(eq(teamMembers.active, true))
      .orderBy(asc(teamMembers.createdAt));

    // Leer Google Client ID opcional desde crm_settings o variable de entorno
    let googleClientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || "";
    if (!googleClientId) {
      const [setting] = await db
        .select()
        .from(crmSettings)
        .where(eq(crmSettings.key, "auth.google_client_id"))
        .limit(1);
      if (typeof setting?.value === "string") {
        googleClientId = setting.value.trim();
      }
    }

    return NextResponse.json({
      ok: true,
      masterEmail: MASTER_GOOGLE_EMAIL,
      googleClientId: googleClientId || null,
      perfiles: miembrosActuales.map((m) => ({
        id: m.id,
        nombre: m.name || m.email.split("@")[0],
        email: m.email,
        role: m.role,
        esMaestro: m.email.toLowerCase() === MASTER_GOOGLE_EMAIL,
      })),
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "Error obteniendo perfiles",
      },
      { status: 500 }
    );
  }
}
