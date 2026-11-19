import { NextRequest, NextResponse } from "next/server";
import {
  procesarSeguimientosPostventaAutomaticos,
  backfillPedidosEntregadosAPostventa,
} from "@/lib/postventa/engine";
import { autorizadoPorSecreto } from "@/lib/secreto-worker";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Endpoint cron para procesar la secuencia automática de postventa y recompra.
 * Envía mensajes en Día 1-3, Día 7 y Día 25 y mueve de etapa a los clientes.
 */
export async function GET(request: NextRequest) {
  if (!autorizadoPorSecreto(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const forzarHorario = searchParams.get("forzar") === "true";
  const runBackfill = searchParams.get("backfill") === "true";

  let backfillRes = null;
  if (runBackfill) {
    backfillRes = await backfillPedidosEntregadosAPostventa();
  }

  const res = await procesarSeguimientosPostventaAutomaticos({ forzarHorario });
  return NextResponse.json({ ok: true, backfill: backfillRes, ...res });
}

export async function POST(request: NextRequest) {
  return GET(request);
}
