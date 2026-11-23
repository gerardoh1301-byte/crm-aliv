import { NextRequest, NextResponse } from "next/server";
import { requireMember } from "@/lib/api-auth";
import { enviarGuiaAlCliente } from "@/lib/pedidos/guia-pdf";

export const dynamic = "force-dynamic";

/** Reintenta enviar al cliente la imagen de la guía ya subida. */
export async function POST(req: NextRequest) {
  const auth = await requireMember();
  if ("response" in auth) return auth.response;
  const body = (await req.json().catch(() => ({}))) as { pedidoId?: string };
  if (!body.pedidoId) return NextResponse.json({ ok: false, error: "Falta pedidoId" }, { status: 400 });
  return NextResponse.json({ ok: true, ...(await enviarGuiaAlCliente(body.pedidoId)) });
}
