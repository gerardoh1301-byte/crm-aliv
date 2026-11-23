import { NextRequest, NextResponse } from "next/server";
import { requireMember } from "@/lib/api-auth";
import { autorizadoPorSecreto } from "@/lib/secreto-worker";
import { reclasificarPedidosWeb } from "@/lib/shopify/reclasificar-pedidos-web";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Corrige AG/CE de los pedidos web de las últimas semanas (lo llama barridos.ts). Un miembro
 * del equipo puede verlo a mano: sin ?aplicar=1 solo muestra qué cambiaría.
 */
export async function GET(request: NextRequest) {
  if (autorizadoPorSecreto(request)) {
    return NextResponse.json({ ok: true, ...(await reclasificarPedidosWeb({ aplicar: true })) });
  }
  const auth = await requireMember();
  if ("response" in auth) return auth.response;
  const aplicar = request.nextUrl.searchParams.get("aplicar") === "1";
  return NextResponse.json({ ok: true, aplicar, ...(await reclasificarPedidosWeb({ aplicar })) });
}

export async function POST(request: NextRequest) {
  return GET(request);
}
