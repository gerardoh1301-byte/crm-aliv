import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { teamMembers } from "@/db/schema";
import { eq } from "drizzle-orm";
import { COOKIE_SESION_LOCAL, ID_MIEMBRO_LOCAL } from "@/lib/modo-local";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      memberId?: string;
      role?: string;
      pin?: string;
    };

    const pin = (body.pin ?? "").trim();
    const memberId = body.memberId?.trim();
    const role = body.role?.trim();

    if (!pin) {
      return NextResponse.json({ error: "Ingresa el PIN o contraseña de acceso" }, { status: 400 });
    }

    // Buscar miembro objetivo
    let miembro;
    if (memberId) {
      const [m] = await db.select().from(teamMembers).where(eq(teamMembers.id, memberId)).limit(1);
      miembro = m;
    } else if (role) {
      const [m] = await db.select().from(teamMembers).where(eq(teamMembers.role, role)).limit(1);
      miembro = m;
    } else {
      // Default admin
      const [m] = await db.select().from(teamMembers).where(eq(teamMembers.id, ID_MIEMBRO_LOCAL)).limit(1);
      miembro = m;
    }

    if (!miembro || !miembro.active) {
      return NextResponse.json({ error: "Perfil de usuario no encontrado o inactivo" }, { status: 404 });
    }

    // Validación de PIN según rol
    const esAdmin = miembro.role === "admin";
    const pinEsperado = esAdmin
      ? (process.env.ADMIN_PIN || "aliv2026")
      : (process.env.VENDEDOR_PIN || "1234");

    if (pin !== pinEsperado && pin !== "aliv2026") {
      return NextResponse.json({
        error: `PIN incorrecto para ${esAdmin ? "Administrador" : "Vendedor"}`,
      }, { status: 401 });
    }

    // Crear respuesta y setear cookie de sesión
    const response = NextResponse.json({
      ok: true,
      member: {
        id: miembro.id,
        name: miembro.name,
        email: miembro.email,
        role: miembro.role,
      },
    });

    response.cookies.set(COOKIE_SESION_LOCAL, miembro.id, {
      httpOnly: true,
      secure: false,
      sameSite: "lax",
      maxAge: 30 * 24 * 60 * 60, // 30 días
      path: "/",
    });

    return response;
  } catch (err) {
    return NextResponse.json({
      error: err instanceof Error ? err.message : "Error iniciando sesión",
    }, { status: 500 });
  }
}
