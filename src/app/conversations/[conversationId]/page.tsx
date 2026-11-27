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
import { cuentaPermitida, cuentasVisiblesPara, numerosCortosDeCuentas } from "@/lib/channels/numeros";

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
  // Los links y bookmarks viejos se redirigen al hilo mas reciente de ese contacto
  // (el del número propio, si es un vendedor con número).
  if (!conversation) {
    const resolved = await resolveConversationId(conversationId, await cuentasVisiblesPara(member));
    if (resolved && resolved !== conversationId) {
      redirect(`/conversations/${resolved}`);
    }
    notFound();
  }

  // Hilo de un contacto ajeno: como si no existiera.
  const accesible = contact
    ? canAccessContact(member, contact)
    : member.role === "admin";
  if (!accesible) notFound();
  // Vendedor con número propio: el hilo de otro número (el 944) de un cliente suyo se abre
  // solo para leer, como contexto para rescatar la venta (27/11). La bandeja sigue mostrando
  // solo su número.
  const accountIds = await cuentasVisiblesPara(member);
  const soloLectura = !cuentaPermitida(conversation.accountId, accountIds);

  if (!soloLectura) await markConversationAsRead(conversationId);

  const [conversations, contactThreads, numerosCortos] = await Promise.all([
    listConversations({ ownerId: visibleOwnerId(member), accountIds }),
    contact ? listConversationsForContact(contact.id) : Promise.resolve([]),
    numerosCortosDeCuentas(),
  ]);
  const numeroDelHilo = conversation.accountId ? numerosCortos[conversation.accountId] : undefined;

  // Hilo de otro número sin un solo mensaje (provisorio de una automatización): no hay nada
  // que leer, así que se abre el chat del vendedor si existe.
  if (soloLectura && messages.length === 0) {
    const propio = contactThreads.find((t) => t.accountId && accountIds?.includes(t.accountId));
    if (propio) redirect(`/conversations/${propio.conversationId}`);
  }
  // Los hilos vacíos de otros números no se muestran como pestaña.
  const hilosVisibles = contactThreads.filter(
    (t) => t.conversationId === conversationId || t.lastAt || cuentaPermitida(t.accountId, accountIds)
  );

  return (
    <div className="flex h-[calc(100dvh-3.5rem-env(safe-area-inset-top)-2rem)] -m-4 md:-m-6 lg:-m-8 overflow-hidden border border-border rounded-lg bg-background">
      <ConversationsListLive
        initialConversations={conversations}
        selectedId={conversationId}
      />
      <ConversationView
        conversation={conversation}
        threads={hilosVisibles.map((t) => ({
          conversationId: t.conversationId,
          channel: t.channel,
          numero: t.accountId ? numerosCortos[t.accountId] : undefined,
        }))}
        soloLectura={soloLectura ? { numero: numeroDelHilo ?? null } : null}
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
