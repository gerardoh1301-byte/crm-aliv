import { NextRequest, NextResponse } from "next/server";
import { deliverMessage } from "@/lib/channels/deliver";
import { db } from "@/db";
import { conversations } from "@/db/schema";
import { eq } from "drizzle-orm";
import { canAccessContactId } from "@/lib/team";
import { requireMember } from "@/lib/api-auth";
import { autorizadoPorSecreto } from "@/lib/secreto-worker";

/**
 * Envio generico por conversacion: sirve para WhatsApp, Instagram y Messenger.
 * Reemplaza al `/api/whatsapp/send` del chat, que razonaba por telefono y por eso
 * bloqueaba los canales donde no hay telefono.
 */

export const dynamic = "force-dynamic";

interface SendBody {
  conversationId?: string;
  text?: string;
  attachments?: Array<{
    type?: "image" | "video" | "audio" | "document";
    url: string;
    name?: string;
    mimeType?: string;
  }>;
  replyTo?: string;
  quotedText?: string;
  quotedSender?: string;
  template?: {
    name: string;
    language?: string;
    components?: unknown[];
    previewText?: string;
  };
}

export async function POST(request: NextRequest) {
  const esWorker = autorizadoPorSecreto(request);
  let member: { id: string; role: string } | null = null;

  if (!esWorker) {
    const auth = await requireMember();
    if ("response" in auth) return auth.response;
    member = auth.member;
  }
  let body: SendBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON invalido" }, { status: 400 });
  }

  if (!body.conversationId) {
    return NextResponse.json(
      { error: "Campo 'conversationId' requerido" },
      { status: 400 }
    );
  }
  if (!body.text?.trim() && !body.template && !body.attachments?.length) {
    return NextResponse.json(
      { error: "Tenes que enviar 'text', 'template' o 'attachments'" },
      { status: 400 }
    );
  }

  // Un asesor solo escribe en hilos de sus contactos asignados (404: no se confirma que exista).
  const [conv] = await db
    .select({ contactId: conversations.contactId })
    .from(conversations)
    .where(eq(conversations.id, body.conversationId))
    .limit(1);

  if (
    !conv ||
    (!esWorker &&
      member &&
      (conv.contactId
        ? !(await canAccessContactId(member as any, conv.contactId))
        : member.role !== "admin"))
  ) {
    return NextResponse.json({ error: "conversation_not_found" }, { status: 404 });
  }

  const result = await deliverMessage(
    body.conversationId,
    body.template
      ? { template: body.template }
      : {
          text: body.text,
          attachments: body.attachments,
          replyTo: body.replyTo,
          quotedText: body.quotedText,
          quotedSender: body.quotedSender,
        },
    body.template ? "template" : "human"
  );

  if (!result.ok) {
    const status = result.error === "conversation_not_found" ? 404 : 502;
    return NextResponse.json(
      {
        success: false,
        error: result.error,
        hint: result.hint,
        messageId: result.messageId,
      },
      { status }
    );
  }

  return NextResponse.json({
    success: true,
    messageId: result.messageId,
    externalId: result.externalId,
  });
}
