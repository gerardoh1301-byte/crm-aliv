import { NextResponse } from "next/server";
import { db } from "@/db";
import { teamMembers } from "@/db/schema";
import { asc, eq } from "drizzle-orm";
import { ID_MIEMBRO_LOCAL, ID_VENDEDOR_LOCAL } from "@/lib/modo-local";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    // Asegurar que existan administrador y vendedor por defecto
    const rows = await db.select().from(teamMembers).orderBy(asc(teamMembers.createdAt));
    
    // Asegurar que existan administrador y vendedor por defecto
    const tieneAdmin = rows.some((r) => r.id === ID_MIEMBRO_LOCAL || r.role === "admin");
    if (!tieneAdmin) {
      await db.insert(teamMembers).values({
        id: ID_MIEMBRO_LOCAL,
        email: "admin@alivstore.shop",
        name: "Administrador Aliv",
        role: "admin",
        active: true,
      }).onConflictDoNothing();
    }

    const tieneVendedor = rows.some((r) => r.id === ID_VENDEDOR_LOCAL || r.role === "asesor");
    if (!tieneVendedor) {
      await db.insert(teamMembers).values({
        id: ID_VENDEDOR_LOCAL,
        email: "vendedor@alivstore.shop",
        name: "Vendedor Aliv",
        role: "asesor",
        active: true,
      }).onConflictDoNothing();
    }

    const miembrosActuales = await db.select().from(teamMembers).where(eq(teamMembers.active, true)).orderBy(asc(teamMembers.createdAt));

    return NextResponse.json({
      ok: true,
      perfiles: miembrosActuales.map((m) => ({
        id: m.id,
        nombre: m.name || m.email.split("@")[0],
        email: m.email,
        role: m.role,
      })),
    });
  } catch (err) {
    return NextResponse.json({
      ok: false,
      error: err instanceof Error ? err.message : "Error obteniendo perfiles",
    }, { status: 500 });
  }
}
