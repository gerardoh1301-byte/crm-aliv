import { NextResponse } from "next/server";
import { requireMember } from "@/lib/api-auth";
import { canAccessContactId } from "@/lib/team";
import { conversacionEnNumeroDelMiembro } from "@/lib/channels/numeros";

export const dynamic = "force-dynamic";

/**
 * Chat del contacto en el número propio del vendedor (lo crea si no existe). Lo usa el botón
 * «Escribirle desde mi número» del historial de solo lectura del 944 (27/11).
 */
export async function POST(req: Request) {
  const auth = await requireMember();
  if ("response" in auth) return auth.response;

  const body = (await req.json().catch(() => ({}))) as { contactId?: string };
  if (!body.contactId) {
    return NextResponse.json({ error: "Falta el contacto" }, { status: 400 });
  }
  if (!(await canAccessContactId(auth.member as never, body.contactId))) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const conversationId = await conversacionEnNumeroDelMiembro(body.contactId, auth.member);
  if (!conversationId) {
    return NextResponse.json(
      { error: "No tienes un número propio configurado o el cliente no tiene celular" },
      { status: 409 }
    );
  }
  return NextResponse.json({ conversationId });
}
