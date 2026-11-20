import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentMember, displayName } from "@/lib/team";
import { registrarClaveEntregada } from "@/lib/supervisor/comandos";

/**
 * POST /api/pedidos/clave-entregada { pedidoId }
 *
 * Lo llama el botón «Enviar Clave Auto» del seguimiento Shalom después de mandar (o
 * dejar lista en WhatsApp Web) la clave de retiro. Entregar la clave implica que el
 * saldo se verificó: se registra como cobrado y el pedido pasa a «Entregado y cobrado».
 */
const schema = z.object({ pedidoId: z.string().uuid() });

export async function POST(req: NextRequest) {
  const member = await getCurrentMember();
  if (!member) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Falta el pedido" }, { status: 400 });

  const res = await registrarClaveEntregada(parsed.data.pedidoId, `${displayName(member)} (botón Enviar Clave)`);
  return NextResponse.json(res, { status: res.ok ? 200 : 422 });
}
