import { NextRequest, NextResponse } from "next/server";
import { procesarSeguimientos } from "@/lib/agent/seguimiento";
import { autorizadoPorSecreto } from "@/lib/secreto-worker";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Barrido de seguimientos con hora (lo llama barridos.ts con AGENT_WORKER_SECRET): escribe una
 * vez a quien prometió volver ("en 20 minutos te paso los datos") y no volvió ni compró.
 * Solo de 9:00 a 21:00 de Lima y dentro de la ventana de 24 h de WhatsApp.
 */
export async function GET(request: NextRequest) {
  if (!autorizadoPorSecreto(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const ahoraParam = process.env.NODE_ENV !== "production" ? request.nextUrl.searchParams.get("ahora") : null;
  const ahora = ahoraParam && !Number.isNaN(Date.parse(ahoraParam)) ? new Date(ahoraParam) : undefined;
  const res = await procesarSeguimientos({ ahora });
  return NextResponse.json({ ok: true, ...res });
}

export async function POST(request: NextRequest) {
  return GET(request);
}
