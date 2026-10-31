import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { teamMembers } from "@/db/schema";
import { eq } from "drizzle-orm";
import { timingSafeEqual } from "node:crypto";
import { COOKIE_SESION_LOCAL, ID_MIEMBRO_LOCAL, modoLocal } from "@/lib/modo-local";
import { DURACION_SESION_SEG, firmarSesion } from "@/lib/sesion-local";

export const dynamic = "force-dynamic";

function pinIgual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

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
    // Los PIN por defecto solo valen en modo local: en la nube, sin variable, no se entra.
    // Antes "aliv2026" abria cualquier perfil aunque se cambiara ADMIN_PIN.
    const soloLocal = modoLocal() && process.env.NODE_ENV !== "production";
    const pinEsperado = esAdmin
      ? (process.env.ADMIN_PIN || (soloLocal ? "aliv2026" : ""))
      : (process.env.VENDEDOR_PIN || (soloLocal ? "1234" : ""));

    if (!pinEsperado) {
      return NextResponse.json({
        error: `Falta configurar ${esAdmin ? "ADMIN_PIN" : "VENDEDOR_PIN"} en el servidor`,
      }, { status: 500 });
    }

    if (!pinIgual(pin, pinEsperado)) {
      return NextResponse.json({
        error: `PIN incorrecto para ${esAdmin ? "Administrador" : "Vendedor"}`,
      }, { status: 401 });
    }

    const valorSesion = firmarSesion(miembro.id);
    if (!valorSesion) {
      return NextResponse.json({
        error: "Falta SESSION_SECRET o AGENT_WORKER_SECRET en el servidor",
      }, { status: 500 });
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

    response.cookies.set(COOKIE_SESION_LOCAL, valorSesion, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: DURACION_SESION_SEG,
      path: "/",
    });

    return response;
  } catch (err) {
    return NextResponse.json({
      error: err instanceof Error ? err.message : "Error iniciando sesión",
    }, { status: 500 });
  }
}
