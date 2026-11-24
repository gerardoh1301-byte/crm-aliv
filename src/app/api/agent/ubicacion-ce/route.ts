import { NextRequest, NextResponse } from "next/server";
import { procesarUbicacionesCE } from "@/lib/pedidos/ubicacion-ce";
import { requireMember } from "@/lib/api-auth";
import { autorizadoPorSecreto } from "@/lib/secreto-worker";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Mejora 9b (lo llama barridos.ts con AGENT_WORKER_SECRET): pedidos CE del bot sin pin o sin
 * referencia reciben un recordatorio a los 10 min; sin pin 10 min después, el punto de Google
 * queda en las notas del pedido. Un miembro del equipo también puede abrirla a mano.
 */
export async function GET(request: NextRequest) {
  if (!autorizadoPorSecreto(request)) {
    const auth = await requireMember();
    if ("response" in auth) return auth.response;
  }
  const ahoraParam = process.env.NODE_ENV !== "production" ? request.nextUrl.searchParams.get("ahora") : null;
  const ahora = ahoraParam && !Number.isNaN(Date.parse(ahoraParam)) ? new Date(ahoraParam) : undefined;
  return NextResponse.json({ ok: true, ...(await procesarUbicacionesCE({ ahora })) });
}

export async function POST(request: NextRequest) {
  return GET(request);
}
