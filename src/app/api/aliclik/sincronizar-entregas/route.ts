import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { autorizadoPorSecreto } from "@/lib/secreto-worker";
import { requireMember } from "@/lib/api-auth";
import { sincronizarEntregasAliclik } from "@/lib/aliclik/sync-entregas";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

declare global {
  var __aliclikSyncUltima: number | undefined;
}

/** Los barridos pasan cada 2 min; a AliClik se le pregunta como mucho cada 20 min. */
const MIN_ENTRE_CORRIDAS_MS = 20 * 60_000;

/**
 * Sincroniza con AliClik los pedidos contra entrega (ver sync-entregas.ts).
 * Lo llama barridos.ts con el secreto del worker; un miembro del equipo puede llamarlo
 * a mano (sin la espera de 20 min) para ver qué estados devuelve AliClik.
 */
export async function GET(req: NextRequest) {
  const porWorker = autorizadoPorSecreto(req);
  if (!porWorker) {
    const auth = await requireMember();
    if ("response" in auth) return auth.response;
  }
  if (!process.env.ALICLIK_MCP_TOKEN) {
    return NextResponse.json({ ok: false, error: "ALICLIK_MCP_TOKEN no configurado" }, { status: 200 });
  }
  if (porWorker && globalThis.__aliclikSyncUltima && Date.now() - globalThis.__aliclikSyncUltima < MIN_ENTRE_CORRIDAS_MS) {
    return NextResponse.json({ ok: true, omitido: "esperando intervalo" });
  }
  globalThis.__aliclikSyncUltima = Date.now();
  try {
    const data = await sincronizarEntregasAliclik();
    return NextResponse.json({ ok: true, data });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[aliclik-sync] Error:", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  return GET(req);
}
