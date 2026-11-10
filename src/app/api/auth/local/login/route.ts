import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { crmSettings, teamMembers } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { timingSafeEqual } from "node:crypto";
import { COOKIE_SESION_LOCAL, ID_MIEMBRO_LOCAL } from "@/lib/modo-local";
import { DURACION_SESION_SEG, firmarSesion } from "@/lib/sesion-local";
import { MASTER_GOOGLE_EMAIL } from "@/app/api/auth/local/perfiles/route";

export const dynamic = "force-dynamic";

function pinIgual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

async function leerSettingTexto(key: string): Promise<string | null> {
  try {
    const [row] = await db
      .select()
      .from(crmSettings)
      .where(eq(crmSettings.key, key))
      .limit(1);
    if (typeof row?.value === "string" && row.value.trim()) {
      return row.value.trim();
    }
  } catch {
    // ignorar errores de lectura
  }
  return null;
}

async function verificarTokenGoogle(idToken: string): Promise<{
  email: string;
  name?: string;
  sub?: string;
} | null> {
  try {
    const res = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`,
      { cache: "no-store" }
    );
    if (!res.ok) return null;
    const data = (await res.json()) as {
      email?: string;
      email_verified?: string | boolean;
      name?: string;
      sub?: string;
      aud?: string;
    };
    const verificado =
      data.email_verified === true || data.email_verified === "true";
    if (!data.email || !verificado) return null;

    // Si hay un Client ID configurado, verificar que el token pertenezca a ese Client ID
    const clientIdConfigurado =
      process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ||
      (await leerSettingTexto("auth.google_client_id"));
    if (
      clientIdConfigurado &&
      data.aud &&
      data.aud.trim() !== clientIdConfigurado.trim()
    ) {
      return null;
    }

    return {
      email: data.email.trim().toLowerCase(),
      name: data.name?.trim(),
      sub: data.sub,
    };
  } catch {
    return null;
  }
}

async function asegurarAdminMaestro() {
  const [existente] = await db
    .select()
    .from(teamMembers)
    .where(sql`lower(${teamMembers.email}) = ${MASTER_GOOGLE_EMAIL}`)
    .limit(1);

  if (existente) {
    if (!existente.active || existente.role !== "admin") {
      const [actualizado] = await db
        .update(teamMembers)
        .set({ role: "admin", active: true, updatedAt: new Date() })
        .where(eq(teamMembers.id, existente.id))
        .returning();
      return actualizado;
    }
    return existente;
  }

  const [porId] = await db
    .select()
    .from(teamMembers)
    .where(eq(teamMembers.id, ID_MIEMBRO_LOCAL))
    .limit(1);

  if (porId) {
    const [actualizado] = await db
      .update(teamMembers)
      .set({
        email: MASTER_GOOGLE_EMAIL,
        name: porId.name || "Gerardo Huaynalaya (Maestro)",
        role: "admin",
        active: true,
        updatedAt: new Date(),
      })
      .where(eq(teamMembers.id, ID_MIEMBRO_LOCAL))
      .returning();
    return actualizado;
  }

  const [creado] = await db
    .insert(teamMembers)
    .values({
      id: ID_MIEMBRO_LOCAL,
      email: MASTER_GOOGLE_EMAIL,
      name: "Gerardo Huaynalaya (Maestro)",
      role: "admin",
      active: true,
    })
    .returning();
  return creado;
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      memberId?: string;
      email?: string;
      role?: string;
      pin?: string;
      googleCredential?: string;
    };

    // 1. Modo Google OAuth Token directo (One-Click con Google Identity Services)
    if (body.googleCredential) {
      const googleUser = await verificarTokenGoogle(body.googleCredential);
      if (!googleUser) {
        return NextResponse.json(
          { error: "No se pudo verificar la credencial de Google." },
          { status: 401 }
        );
      }

      let miembro;
      if (googleUser.email === MASTER_GOOGLE_EMAIL) {
        miembro = await asegurarAdminMaestro();
      } else {
        const [m] = await db
          .select()
          .from(teamMembers)
          .where(sql`lower(${teamMembers.email}) = ${googleUser.email}`)
          .limit(1);
        miembro = m;
      }

      if (!miembro || !miembro.active) {
        return NextResponse.json(
          {
            error: `La cuenta de Google (${googleUser.email}) no está autorizada. El Administrador Maestro (${MASTER_GOOGLE_EMAIL}) debe agregarla en Configuración → Equipo.`,
          },
          { status: 403 }
        );
      }

      const valorSesion = firmarSesion(miembro.id);
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
    }

    // 2. Modo Login por Cuenta Google (email) o Perfil seleccionado + Clave/PIN
    const pin = (body.pin ?? "").trim();
    const emailInput = (body.email ?? "").trim().toLowerCase();
    const memberId = body.memberId?.trim();
    const role = body.role?.trim();

    if (!pin) {
      return NextResponse.json(
        { error: "Ingresa tu clave o PIN de acceso" },
        { status: 400 }
      );
    }

    let miembro;
    if (emailInput) {
      if (emailInput === MASTER_GOOGLE_EMAIL) {
        miembro = await asegurarAdminMaestro();
      } else {
        const [m] = await db
          .select()
          .from(teamMembers)
          .where(sql`lower(${teamMembers.email}) = ${emailInput}`)
          .limit(1);
        miembro = m;
      }
      if (!miembro) {
        return NextResponse.json(
          {
            error: `La cuenta Google "${emailInput}" no está registrada en el equipo. Inicia sesión con la cuenta maestra (${MASTER_GOOGLE_EMAIL}) y agrégala en Configuración → Equipo.`,
          },
          { status: 403 }
        );
      }
    } else if (memberId) {
      const [m] = await db
        .select()
        .from(teamMembers)
        .where(eq(teamMembers.id, memberId))
        .limit(1);
      miembro = m;
      if (!miembro && memberId === ID_MIEMBRO_LOCAL) {
        miembro = await asegurarAdminMaestro();
      }
    } else if (role) {
      const [m] = await db
        .select()
        .from(teamMembers)
        .where(eq(teamMembers.role, role))
        .limit(1);
      miembro = m;
    } else {
      miembro = await asegurarAdminMaestro();
    }

    if (!miembro || !miembro.active) {
      return NextResponse.json(
        {
          error:
            "Esta cuenta Google está desactivada o no tiene acceso. Consulta al Administrador Maestro.",
        },
        { status: 403 }
      );
    }

    const esAdmin = miembro.role === "admin";
    const emailMiembro = miembro.email.toLowerCase();

    // Revisar si tiene clave individual o clave por rol en crm_settings / env / default
    const pinIndividual = await leerSettingTexto(`auth.pin.${emailMiembro}`);
    const pinRolConfig = await leerSettingTexto(
      esAdmin ? "auth.admin_pin" : "auth.vendedor_pin"
    );

    const pinEsperado =
      pinIndividual ||
      pinRolConfig ||
      (esAdmin
        ? process.env.ADMIN_PIN || "aliv2026"
        : process.env.VENDEDOR_PIN || "1234");

    // Permitir que el PIN maestro de admin tambien funcione si el admin prueba entrar
    const pinMaestro =
      (await leerSettingTexto("auth.admin_pin")) ||
      process.env.ADMIN_PIN ||
      "aliv2026";

    const pinValido =
      pinIgual(pin, pinEsperado) || (esAdmin && pinIgual(pin, pinMaestro));

    if (!pinValido) {
      return NextResponse.json(
        {
          error: `Clave/PIN incorrecto para ${miembro.email} (${
            esAdmin ? "Administrador Maestro" : "Perfil Vendedor"
          })`,
        },
        { status: 401 }
      );
    }

    const valorSesion = firmarSesion(miembro.id);

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
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "Error iniciando sesión",
      },
      { status: 500 }
    );
  }
}
