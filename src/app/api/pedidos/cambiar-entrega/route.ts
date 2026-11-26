import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentMember, displayName } from "@/lib/team";
import { cambiarTipoEntrega } from "@/lib/pedidos/cambiar-entrega";

/**
 * POST /api/pedidos/cambiar-entrega { pedidoId, destino: "shalom" | "cod", confirmado? }
 *
 * Menú ⋯ de la tarjeta del pipeline. Si el pedido ya tiene orden AliClik o guía Shalom,
 * responde 409 con `confirmar: true` para que el usuario confirme que la anuló.
 */
const schema = z.object({
  pedidoId: z.string().uuid(),
  destino: z.enum(["shalom", "cod"]),
  confirmado: z.boolean().optional(),
});

export async function POST(req: NextRequest) {
  const member = await getCurrentMember();
  if (!member) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Datos incompletos" }, { status: 400 });

  const { pedidoId, destino, confirmado } = parsed.data;
  const res = await cambiarTipoEntrega(pedidoId, destino, displayName(member), confirmado ?? false);
  if (res.ok) return NextResponse.json(res);
  return NextResponse.json(res, { status: res.confirmar ? 409 : 422 });
}
