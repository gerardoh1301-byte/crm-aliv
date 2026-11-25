import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { crmSettings, teamMembers } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { timingSafeEqual } from "node:crypto";
import { COOKIE_SESION_LOCAL, ID_MIEMBRO_LOCAL } from "@/lib/modo-local";
import { DURACION_SESION_SEG, firmarSesion } from "@/lib/sesion-local";
import { MASTER_GOOGLE_EMAIL } from "@/app/api/auth/local/perfiles/route";
import {
  limpiarIntentosLogin,
  obtenerIpCliente,
  registrarIntentoFallidoLogin,
  verificarLimiteIntentosLogin,
} from "@/lib/rate-limit-login";

export const dynamic = "force-dynamic";

export function pinIgual(a: string, b: string): boolean {
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
    // 24/11 (auditoría CRM-01): sin un Client ID válido no se acepta ningún token. Antes, con
    // el campo mal cargado (tenía un correo), se aceptaba un token emitido para CUALQUIER app.
    const clientId = (clientIdConfigurado || "").trim();
    if (!clientId.endsWith(".apps.googleusercontent.com")) return null;
    if (!data.aud || data.aud.trim() !== clientId) return null;

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
    const ip = obtenerIpCliente(request.headers);
    const limite = verificarLimiteIntentosLogin(ip);
    if (!limite.permitido) {
      return NextResponse.json(
        {
          error:
            "Demasiados intentos fallidos. Espera 15 minutos antes de volver a intentar.",
        },
        {
          status: 429,
          headers: { "Retry-After": String(limite.retryAfterSeg) },
        }
      );
    }

    const body = (await request.json().catch(() => ({}))) as {
      memberId?: string;
      email?: string;
      pin?: string;
      googleCredential?: string;
    };

    // 1. Modo Google OAuth Token directo (One-Click con Google Identity Services)
    if (body.googleCredential) {
      const googleUser = await verificarTokenGoogle(body.googleCredential);
      if (!googleUser) {
        registrarIntentoFallidoLogin(ip);
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
        registrarIntentoFallidoLogin(ip);
        return NextResponse.json(
          {
            error: "La cuenta de Google no está autorizada en el equipo.",
          },
          { status: 403 }
        );
      }

      const valorSesion = firmarSesion(miembro.id);
      if (!valorSesion) {
        return NextResponse.json(
          { error: "No se pudo generar la sesión firmada" },
          { status: 500 }
        );
      }

      limpiarIntentosLogin(ip);
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

    // 2. Modo Login por Cuenta Google (email) o ID de miembro + Clave/PIN
    const pin = (body.pin ?? "").trim();
    const emailInput = (body.email ?? "").trim().toLowerCase();
    const memberId = body.memberId?.trim();

    if (!pin) {
      return NextResponse.json(
        { error: "Ingresa tu clave o PIN de acceso" },
        { status: 400 }
      );
    }

    // S1: Prohibido entrar sin indicar explícitamente el usuario (email o memberId)
    if (!emailInput && !memberId) {
      registrarIntentoFallidoLogin(ip);
      return NextResponse.json(
        { error: "Debes indicar tu cuenta de usuario para iniciar sesión." },
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
    } else if (memberId) {
      const [m] = await db
        .select()
        .from(teamMembers)
        .where(eq(teamMembers.id, memberId))
        .limit(1);
      miembro = m;
    }

    if (!miembro || !miembro.active) {
      registrarIntentoFallidoLogin(ip);
      return NextResponse.json(
        {
          error: "Credenciales inválidas o cuenta no autorizada.",
        },
        { status: 401 }
      );
    }

    const esAdmin = miembro.role === "admin";
    const emailMiembro = miembro.email.toLowerCase();

    // S1: Sin claves fijas en el código ni valores por defecto ("1234", "aliv2026", "Aliv2026!").
    // Se lee únicamente de crm_settings o de variables de entorno explícitas.
    const pinIndividual = await leerSettingTexto(`auth.pin.${emailMiembro}`);
    const pinRolConfig = await leerSettingTexto(
      esAdmin ? "auth.admin_pin" : "auth.vendedor_pin"
    );
    const pinEnv = (
      esAdmin ? process.env.ADMIN_PIN : process.env.VENDEDOR_PIN
    )?.trim();

    const pinEsperado = pinIndividual || pinRolConfig || pinEnv || null;

    if (!pinEsperado) {
      return NextResponse.json(
        {
          error:
            "El perfil no tiene un PIN de acceso configurado. Contacta al administrador.",
        },
        { status: 403 }
      );
    }

    const pinValido = pinIgual(pin, pinEsperado);

    if (!pinValido) {
      registrarIntentoFallidoLogin(ip);
      return NextResponse.json(
        {
          error: "Clave o PIN de acceso incorrecto.",
        },
        { status: 401 }
      );
    }

    const valorSesion = firmarSesion(miembro.id);
    if (!valorSesion) {
      return NextResponse.json(
        { error: "No se pudo generar la sesión firmada" },
        { status: 500 }
      );
    }

    limpiarIntentosLogin(ip);
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
