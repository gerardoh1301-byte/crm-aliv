import { NextRequest, NextResponse } from "next/server";
import { procesarToquesCalientes, registroPruebaToqueCaliente } from "@/lib/agent/toque-caliente";
import { requireMember } from "@/lib/api-auth";
import { autorizadoPorSecreto } from "@/lib/secreto-worker";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Toque en caliente (lo llama barridos.ts con AGENT_WORKER_SECRET): una sola vez, entre los
 * 12 y 45 min de silencio, a quien el bot le pidió el adelanto, los datos de envío o le dio
 * el precio. Solo envía con TOQUE_CALIENTE=on; sin ella responde qué enviaría.
 */
export async function GET(request: NextRequest) {
  // Un miembro del equipo puede verlo a mano (incluye el registro del modo prueba).
  if (!autorizadoPorSecreto(request)) {
    const auth = await requireMember();
    if ("response" in auth) return auth.response;
    const res = await procesarToquesCalientes();
    return NextResponse.json({ ok: true, ...res, registroPrueba: registroPruebaToqueCaliente() });
  }
  const ahoraParam = process.env.NODE_ENV !== "production" ? request.nextUrl.searchParams.get("ahora") : null;
  const ahora = ahoraParam && !Number.isNaN(Date.parse(ahoraParam)) ? new Date(ahoraParam) : undefined;
  const res = await procesarToquesCalientes({ ahora });
  return NextResponse.json({ ok: true, ...res });
}

export async function POST(request: NextRequest) {
  return GET(request);
}
