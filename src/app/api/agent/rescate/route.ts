import { NextRequest, NextResponse } from "next/server";
import { auditarChatsAbandonados } from "@/lib/agent/rescate";
import { autorizadoPorSecreto } from "@/lib/secreto-worker";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Barrido automático de rescate de chats abandonados.
 *
 * Busca conversaciones donde el cliente no ha respondido entre 2h y 22h,
 * detecta el escenario (dirección incompleta, freno de adelanto o cotización),
 * y envía el mensaje de seguimiento para recuperar la venta dentro de la ventana de 24h.
 */
export async function GET(request: NextRequest) {
  if (!autorizadoPorSecreto(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const forzarHorario = searchParams.get("forzar") === "true";
  const limite = parseInt(searchParams.get("limite") ?? "10", 10);

  const res = await auditarChatsAbandonados({ limite, forzarHorario });
  return NextResponse.json({ ok: true, ...res });
}

export async function POST(request: NextRequest) {
  return GET(request);
}
