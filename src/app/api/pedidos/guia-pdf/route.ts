import { NextRequest, NextResponse } from "next/server";
import { requireMember } from "@/lib/api-auth";
import { guardarGuiaPdf, pedidosShalomDeContacto } from "@/lib/pedidos/guia-pdf";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Sube la guía PDF de Shalom a Drive (formulario: pedidoId, archivo, enviar=1|0). */
export async function POST(req: NextRequest) {
  const auth = await requireMember();
  if ("response" in auth) return auth.response;
  const form = await req.formData().catch(() => null);
  const pedidoId = String(form?.get("pedidoId") ?? "");
  const archivo = form?.get("archivo");
  if (!pedidoId || !(archivo instanceof Blob)) {
    return NextResponse.json({ ok: false, error: "Falta el pedido o el archivo PDF" }, { status: 400 });
  }
  try {
    const res = await guardarGuiaPdf({
      pedidoId,
      pdf: new Uint8Array(await archivo.arrayBuffer()),
      enviar: String(form?.get("enviar") ?? "1") !== "0",
      quien: auth.member.name || "Equipo",
    });
    return NextResponse.json(res, { status: res.ok ? 200 : 400 });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

/** Pedidos Shalom de un contacto (?contactId=), para subir la preguía desde su ficha. */
export async function GET(req: NextRequest) {
  const auth = await requireMember();
  if ("response" in auth) return auth.response;
  const contactId = req.nextUrl.searchParams.get("contactId") ?? "";
  if (!contactId) return NextResponse.json({ pedidos: [] });
  try {
    return NextResponse.json({ pedidos: await pedidosShalomDeContacto(contactId) });
  } catch (err) {
    return NextResponse.json({ pedidos: [], error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
