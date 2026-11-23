import { NextRequest, NextResponse } from "next/server";
import { procesarAvisosVentana } from "@/lib/alerts/ventana-supervisor-servidor";
import { requireMember } from "@/lib/api-auth";
import { autorizadoPorSecreto } from "@/lib/secreto-worker";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Aviso de ventana por cerrar (lo llama barridos.ts con AGENT_WORKER_SECRET): avisa a Gerardo
 * y a Lourdes, una vez por ventana, que su ventana de 24 h está por cerrarse, para que
 * respondan y sigan recibiendo los avisos internos sin plantilla.
 */
export async function GET(request: NextRequest) {
  if (!autorizadoPorSecreto(request)) {
    const auth = await requireMember();
    if ("response" in auth) return auth.response;
  }
  const res = await procesarAvisosVentana();
  return NextResponse.json({ ok: true, ...res });
}

export async function POST(request: NextRequest) {
  return GET(request);
}
