import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { crmSettings, teamMembers } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { timingSafeEqual } from "node:crypto";
import { COOKIE_SESION_LOCAL, ID_MIEMBRO_LOCAL } from "@/lib/modo-local";
import { firmarSesion } from "@/lib/sesion-local";
import {
  limpiarIntentosLogin,
  obtenerIpCliente,
  registrarIntentoFallidoLogin,
  verificarLimiteIntentosLogin,
} from "@/lib/rate-limit-login";

export const dynamic = "force-dynamic";

function pinIgual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

export async function POST(request: NextRequest) {
  const ip = obtenerIpCliente(request.headers);
  const limite = verificarLimiteIntentosLogin(`erp:${ip}`);
  if (!limite.permitido) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Demasiados intentos fallidos. Espera 15 minutos antes de volver a intentar.",
      },
      {
        status: 429,
        headers: { "Retry-After": String(limite.retryAfterSeg) },
      }
    );
  }

  try {
    const body = (await request.json().catch(() => ({}))) as { pin?: string };
    const pin = (body.pin ?? "").trim();
    if (!pin) {
      return NextResponse.json(
        { ok: false, error: "PIN requerido" },
        { status: 400 }
      );
    }

    const [row] = await db
      .select()
      .from(crmSettings)
      .where(eq(crmSettings.key, "auth.erp_pin"))
      .limit(1);

    const pinConfigurado =
      (typeof row?.value === "string" && row.value.trim()) ||
      process.env.ALIV_FINANZAS_PIN?.trim() ||
      null;

    if (!pinConfigurado) {
      return NextResponse.json(
        { ok: false, error: "PIN de ERP no configurado" },
        { status: 403 }
      );
    }

    if (!pinIgual(pin, pinConfigurado)) {
      registrarIntentoFallidoLogin(`erp:${ip}`);
      return NextResponse.json(
        { ok: false, error: "PIN incorrecto" },
        { status: 401 }
      );
    }

    limpiarIntentosLogin(`erp:${ip}`);
    const [adminActivo] = await db
      .select({ id: teamMembers.id })
      .from(teamMembers)
      .where(and(eq(teamMembers.role, "admin"), eq(teamMembers.active, true)))
      .limit(1);
    const crmSessionToken = firmarSesion(adminActivo?.id ?? ID_MIEMBRO_LOCAL);

    return NextResponse.json({
      ok: true,
      crmSessionCookie: crmSessionToken
        ? `${COOKIE_SESION_LOCAL}=${crmSessionToken}`
        : null,
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "Error verificando PIN",
      },
      { status: 500 }
    );
  }
}
