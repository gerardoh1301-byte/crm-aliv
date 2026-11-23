import { NextResponse } from "next/server";
import { imagenPorToken } from "@/lib/pedidos/guia-pdf";

export const dynamic = "force-dynamic";

/**
 * Imagen de la guía para WhatsApp (el proveedor la descarga al enviar). Pública pero solo con
 * el token aleatorio de 40 caracteres que guarda el pedido; sin token válido, 404.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const imagen = await imagenPorToken(token).catch(() => null);
  if (!imagen) return new NextResponse("No encontrado", { status: 404 });
  return new NextResponse(new Uint8Array(imagen), {
    headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=3600", "X-Robots-Tag": "noindex" },
  });
}
