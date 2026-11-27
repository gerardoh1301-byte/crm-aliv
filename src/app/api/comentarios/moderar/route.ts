import { NextRequest, NextResponse } from "next/server";
import { moderarComentarios } from "@/lib/comentarios/moderador";
import { diagnosticoMeta } from "@/lib/comentarios/meta-graph";
import { requireMember } from "@/lib/api-auth";
import { autorizadoPorSecreto } from "@/lib/secreto-worker";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Moderador de comentarios de Facebook e Instagram (lo llama barridos.ts con
 * AGENT_WORKER_SECRET). Sin COMENTARIOS_MODERACION=on solo informa qué haría.
 * `?diagnostico=1` (miembro del equipo) prueba el token de Meta sin moderar nada.
 */
export async function GET(request: NextRequest) {
  if (!autorizadoPorSecreto(request)) {
    const auth = await requireMember();
    if ("response" in auth) return auth.response;
  }
  if (request.nextUrl.searchParams.get("diagnostico")) {
    return NextResponse.json({ ok: true, diagnostico: await diagnosticoMeta() });
  }
  const horas = Number(request.nextUrl.searchParams.get("horas"));
  const res = await moderarComentarios({ horas: Number.isFinite(horas) && horas > 0 ? Math.min(horas, 24 * 60) : undefined });
  return NextResponse.json({ ok: true, ...res });
}

export async function POST(request: NextRequest) {
  return GET(request);
}
