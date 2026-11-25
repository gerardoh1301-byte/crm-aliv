import { NextRequest, NextResponse } from "next/server";
import { requireMember } from "@/lib/api-auth";
import { autorizadoPorSecreto } from "@/lib/secreto-worker";
import { enviarResumenDiario } from "@/lib/resumen-diario/servidor";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Resumen diario de pendientes (lo llama barridos.ts con AGENT_WORKER_SECRET): desde las 22:00
 * de Lima, a cada vendedor sus pendientes y a Gerardo el de todos los chats.
 * Un miembro del equipo puede ver los textos sin enviarlos con ?ver=1.
 */
export async function GET(request: NextRequest) {
  const porSecreto = autorizadoPorSecreto(request);
  if (!porSecreto) {
    const auth = await requireMember();
    if ("response" in auth) return auth.response;
  }
  const soloVer = request.nextUrl.searchParams.get("ver") === "1";
  try {
    // Sin el secreto solo se puede mirar: el envío lo hace el barrido.
    const res = await enviarResumenDiario({ soloVer: soloVer || !porSecreto, forzar: soloVer || !porSecreto });
    return NextResponse.json({ ok: true, ...res });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.warn("[resumen-diario]", error);
    return NextResponse.json({ ok: false, error }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  return GET(request);
}
