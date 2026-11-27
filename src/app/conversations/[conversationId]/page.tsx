import { notFound, redirect } from "next/navigation";
import {
  listConversations,
  listConversationsForContact,
  getConversation,
  markConversationAsRead,
  resolveConversationId,
} from "@/lib/conversations";
import { ConversationsListLive } from "@/components/conversations/ConversationsListLive";
import { ConversationView } from "@/components/conversations/ConversationView";
import { canAccessContact, getCurrentMember, visibleOwnerId } from "@/lib/team";
import { cuentaPermitida, cuentasVisiblesPara } from "@/lib/channels/numeros";

// El inbox lee la base en cada request: nunca se prerenderiza en build.
export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ conversationId: string }>;
}

export default async function ConversationPage({ params }: Props) {
  const { conversationId } = await params;

  const member = await getCurrentMember();
  if (!member) redirect("/sin-acceso");

  const { conversation, contact, messages } = await getConversation(conversationId);

  // Retrocompatibilidad: hasta la migracion multicanal la ruta era /conversations/<contactId>.
  // Los links y bookmarks viejos se redirigen al hilo mas reciente de ese contacto.
  if (!conversation) {
    const resolved = await resolveConversationId(conversationId);
    if (resolved && resolved !== conversationId) {
      redirect(`/conversations/${resolved}`);
    }
    notFound();
  }

  // Hilo de un contacto ajeno: como si no existiera.
  const accesible = contact
    ? canAccessContact(member, contact)
    : member.role === "admin";
  // Vendedor con número propio: un hilo de otro número (el del bot) tampoco existe para él.
  const accountIds = await cuentasVisiblesPara(member);
  if (!accesible || !cuentaPermitida(conversation.accountId, accountIds)) notFound();

  await markConversationAsRead(conversationId);

  const [conversations, contactThreads] = await Promise.all([
    listConversations({ ownerId: visibleOwnerId(member), accountIds }),
    contact ? listConversationsForContact(contact.id, accountIds) : Promise.resolve([]),
  ]);

  return (
    <div className="flex h-[calc(100dvh-3.5rem-env(safe-area-inset-top)-2rem)] -m-4 md:-m-6 lg:-m-8 overflow-hidden border border-border rounded-lg bg-background">
      <ConversationsListLive
        initialConversations={conversations}
        selectedId={conversationId}
      />
      <ConversationView
        conversation={conversation}
        threads={contactThreads.map((t) => ({
          conversationId: t.conversationId,
          channel: t.channel,
        }))}
        contact={
          contact
            ? {
                id: contact.id,
                name: contact.name,
                phone: contact.phone,
                email: contact.email,
                tags: contact.tags ?? [],
                ownerId: contact.ownerId,
                notes: contact.notes,
                aiEnabled: contact.aiEnabled,
                needsHuman: contact.needsHuman,
                needsHumanReason: contact.needsHumanReason,
                customFields: contact.customFields as Record<string, unknown> | null,
                aiSummary: contact.aiSummary,
                aiSummaryAt: contact.aiSummaryAt,
              }
            : null
        }
        initialMessages={messages}
        isAdmin={member.role === "admin"}
      />
    </div>
  );
}
