import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { calcularMetricas, leerRango } from "@/lib/metricas";
import { secretoPresentado } from "@/lib/secreto-worker";

export const dynamic = "force-dynamic";

/**
 * GET /api/metricas?desde=YYYY-MM-DD&hasta=YYYY-MM-DD  (Authorization: Bearer METRICAS_TOKEN)
 *
 * Lo consume el panel de crecimiento del sistema integrado. Token propio y no el del
 * worker: el panel corre fuera del CRM (tarea de Claude en la nube) y rotarlo no debe
 * tocar los barridos internos. Falla cerrada: sin METRICAS_TOKEN responde 401.
 */
function autorizado(request: NextRequest): boolean {
  const token = process.env.METRICAS_TOKEN;
  const presentado = secretoPresentado(request);
  if (!token || !presentado) return false;
  const a = Buffer.from(token);
  const b = Buffer.from(presentado);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(request: NextRequest) {
  if (!autorizado(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const rango = leerRango(request.nextUrl.searchParams);
  if ("error" in rango) {
    return NextResponse.json({ error: rango.error }, { status: 400 });
  }
  try {
    return NextResponse.json(await calcularMetricas(rango));
  } catch (err) {
    console.error("[metricas]", err);
    return NextResponse.json({ error: "No se pudieron calcular las metricas" }, { status: 500 });
  }
}
