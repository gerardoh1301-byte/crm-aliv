import { NextResponse } from "next/server";
import { leerTokenResumen } from "@/lib/resumen-diario/token";
import { pdfResumen } from "@/lib/resumen-diario/servidor";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * PDF del resumen diario para WhatsApp (Zernio lo descarga al enviar). Pública pero solo con
 * el enlace firmado que genera el barrido; vence a los 3 días. Sin firma válida, 404.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const datos = leerTokenResumen(token.replace(/\.pdf$/i, ""), process.env.AGENT_WORKER_SECRET ?? "");
  if (!datos) return new NextResponse("No encontrado", { status: 404 });
  const pdf = await pdfResumen(datos.destino, datos.fecha).catch(() => null);
  if (!pdf) return new NextResponse("No encontrado", { status: 404 });
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="resumen-${datos.fecha}.pdf"`,
      "Cache-Control": "private, no-store",
      "X-Robots-Tag": "noindex",
    },
  });
}
