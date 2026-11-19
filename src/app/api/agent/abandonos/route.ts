import { NextRequest, NextResponse } from "next/server";
import { procesarAbandonos } from "@/lib/abandonos/servidor";
import { autorizadoPorSecreto } from "@/lib/secreto-worker";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Barrido de formularios abandonados (lo llama barridos.ts con AGENT_WORKER_SECRET).
 * 30 min después de la captura escribe el paso 1, a las 24 h el paso 2 y a las 48 h
 * siguientes cierra el caso. Corta si el cliente responde o compra. Los envíos solo
 * salen con ABANDONOS_ENVIO=on.
 */
export async function GET(request: NextRequest) {
  if (!autorizadoPorSecreto(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const limite = Math.min(50, parseInt(request.nextUrl.searchParams.get("limite") ?? "15", 10) || 15);
  // Solo en desarrollo: simular otra hora para probar los pasos sin esperar 30 min / 24 h.
  const ahoraParam = process.env.NODE_ENV !== "production" ? request.nextUrl.searchParams.get("ahora") : null;
  const ahora = ahoraParam && !Number.isNaN(Date.parse(ahoraParam)) ? new Date(ahoraParam) : undefined;
  const res = await procesarAbandonos({ limite, ahora });
  return NextResponse.json({ ok: true, ...res });
}

export async function POST(request: NextRequest) {
  return GET(request);
}
