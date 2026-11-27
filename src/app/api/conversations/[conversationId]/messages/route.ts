import { NextResponse } from "next/server";
import {
  firmaMensajes,
  getConversation,
  markConversationAsRead,
} from "@/lib/conversations";
import { requireMember } from "@/lib/api-auth";
import { canAccessContact } from "@/lib/team";
import { cuentaPermitida, cuentasVisiblesPara } from "@/lib/channels/numeros";

export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ conversationId: string }> },
) {
  const auth = await requireMember();
  if ("response" in auth) return auth.response;

  const { conversationId } = await params;
  // El chat abierto se pide cada 6 s. Si los mensajes no cambiaron (misma firma), se responde
  // 204 sin releer el hilo. El acceso ya se comprobó en la respuesta completa anterior, que
  // es la única forma de conocer la firma.
  const firma = await firmaMensajes(conversationId);
  if (firma && new URL(req.url).searchParams.get("firma") === firma) {
    return new NextResponse(null, { status: 204, headers: { "x-firma": firma } });
  }
  const { conversation, contact, messages } = await getConversation(conversationId);
  if (!conversation) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  // Hilo de un contacto ajeno (o sin contacto, si no es admin): como si no existiera.
  const accesible = contact
    ? canAccessContact(auth.member, contact)
    : auth.member.role === "admin";
  if (!accesible || !cuentaPermitida(conversation.accountId, await cuentasVisiblesPara(auth.member))) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  await markConversationAsRead(conversationId);
  return NextResponse.json({
    firma,
    conversation,
    contact: contact
      ? {
          id: contact.id,
          name: contact.name,
          phone: contact.phone,
          email: contact.email,
          tags: contact.tags,
          notes: contact.notes,
          ownerId: contact.ownerId,
        }
      : null,
    messages,
  });
}
