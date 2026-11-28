import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { verificarYNotificarLlegadasShalom } from "@/lib/agencias/notificar-llegada-shalom";
import { autorizadoPorSecreto } from "@/lib/secreto-worker";
import { requireMember } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

async function autorizar(req: NextRequest): Promise<NextResponse | null> {
  if (autorizadoPorSecreto(req)) return null;
  const auth = await requireMember();
  if ("response" in auth) return auth.response;
  return null;
}

/**
 * 27/11/2026: Shalom pide reCAPTCHA en su API de rastreo y el servidor ya no puede consultarla
 * (todas las llamadas fallan). El barrido cada 2 min queda apagado salvo SHALOM_RASTREO_API=on;
 * los estados llegan una vez al día por /api/shalom/reportar-estados desde el navegador.
 */
function apiShalomApagada(): boolean {
  return (process.env.SHALOM_RASTREO_API || "").toLowerCase() !== "on";
}

function respuestaApagada() {
  return NextResponse.json({
    ok: true,
    data: null,
    omitido: "API de rastreo Shalom apagada (reCAPTCHA). Los estados llegan por /api/shalom/reportar-estados.",
  });
}

export async function GET(req: NextRequest) {
  const denied = await autorizar(req);
  if (denied) return denied;
  if (apiShalomApagada()) return respuestaApagada();
  try {
    const { searchParams } = new URL(req.url);
    const forzar = searchParams.get("forzar") === "true";
    const contactId = searchParams.get("contactId") || undefined;

    const resultado = await verificarYNotificarLlegadasShalom({
      forzarReenvio: forzar,
      contactIdEspecifico: contactId,
    });

    return NextResponse.json({
      ok: true,
      data: resultado,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[api-shalom-verificar] Error:", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const denied = await autorizar(req);
  if (denied) return denied;
  if (apiShalomApagada()) return respuestaApagada();
  try {
    const body = await req.json().catch(() => ({}));
    const forzar = Boolean(body.forzarReenvio);
    const contactId = body.contactIdEspecifico || undefined;

    const resultado = await verificarYNotificarLlegadasShalom({
      forzarReenvio: forzar,
      contactIdEspecifico: contactId,
    });

    return NextResponse.json({
      ok: true,
      data: resultado,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[api-shalom-verificar] Error:", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
