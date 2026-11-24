import { NextRequest, NextResponse } from "next/server";
import { requireMember } from "@/lib/api-auth";
import { respaldoDiarioChats } from "@/lib/respaldo/chats";
import { autorizadoPorSecreto } from "@/lib/secreto-worker";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Copia diaria de los chats en Drive (lo llama barridos.ts con AGENT_WORKER_SECRET; sube una
 * vez por día de Lima). Un miembro del equipo puede forzar otra copia con ?forzar=1.
 */
export async function GET(request: NextRequest) {
  if (!autorizadoPorSecreto(request)) {
    const auth = await requireMember();
    if ("response" in auth) return auth.response;
  }
  const forzar = request.nextUrl.searchParams.get("forzar") === "1";
  try {
    return NextResponse.json({ ok: true, ...(await respaldoDiarioChats({ forzar })) });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.warn("[respaldo-chats]", error);
    return NextResponse.json({ ok: false, error }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  return GET(request);
}
