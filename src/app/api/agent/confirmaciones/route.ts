import { NextRequest, NextResponse } from "next/server";
import { requireMember } from "@/lib/api-auth";
import { autorizadoPorSecreto } from "@/lib/secreto-worker";
import { procesarConfirmaciones } from "@/lib/pedidos/confirmacion-servidor";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Regla de confirmación real (lo llama barridos.ts con AGENT_WORKER_SECRET): los pedidos
 * «por confirmar» con un sí real del cliente, la llamada IA confirmada o el adelanto
 * verificado pasan a «Pedido confirmado»; los demás quedan en «Intención de compra».
 */
export async function GET(request: NextRequest) {
  if (!autorizadoPorSecreto(request)) {
    const auth = await requireMember();
    if ("response" in auth) return auth.response;
  }
  return NextResponse.json({ ok: true, ...(await procesarConfirmaciones()) });
}

export async function POST(request: NextRequest) {
  return GET(request);
}
