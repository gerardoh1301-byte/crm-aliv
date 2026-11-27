"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChatPanel } from "./ChatPanel";
import type { ConversationMessage } from "@/lib/conversations";

import type { Channel } from "@/lib/channels/types";

interface Contact {
  id: string;
  name: string;
  phone: string | null;
  tags?: string[];
}

interface ConversationHeaderInfo {
  conversationId: string;
  channel: Channel;
  handle: string | null;
  lastInboundAt?: Date | string | null;
  metadata?: Record<string, unknown> | null;
}

interface Props {
  contact: Contact;
  conversation: ConversationHeaderInfo;
  initialMessages: ConversationMessage[];
  isAdmin?: boolean;
  soloLectura?: { numero: string | null } | null;
  detailsOpen?: boolean;
  onToggleDetails?: () => void;
}

// 24/11: antes 2,5 s (y 15 s oculta), con el historial completo en cada vuelta.
const POLL_INTERVAL_MS = 6000;
const POLL_INTERVAL_HIDDEN_MS = 60000;
// 25/11: con la firma de lo último recibido el servidor responde 204 si nada cambió.
// Cada 2 min se pide todo igual, por si algo cambió sin tocar la firma.
const RECARGA_COMPLETA_MS = 120000;

function rehydrate(raw: ConversationMessage): ConversationMessage {
  return {
    ...raw,
    sentAt: raw.sentAt ? new Date(raw.sentAt) : null,
    deliveredAt: raw.deliveredAt ? new Date(raw.deliveredAt) : null,
    readAt: raw.readAt ? new Date(raw.readAt) : null,
    createdAt: raw.createdAt ? new Date(raw.createdAt) : new Date(),
  };
}

export function ChatPanelLive({
  contact,
  conversation,
  initialMessages,
  isAdmin,
  soloLectura,
  detailsOpen,
  onToggleDetails,
}: Props) {
  const [messages, setMessages] = useState(initialMessages);
  const mountedRef = useRef(true);
  const firmaRef = useRef<string | null>(null);
  const completaRef = useRef(0);

  const refetch = useCallback(async () => {
    try {
      const completa = Date.now() - completaRef.current > RECARGA_COMPLETA_MS;
      const base = `/api/conversations/${conversation.conversationId}/messages`;
      const res = await fetch(
        !completa && firmaRef.current ? `${base}?firma=${encodeURIComponent(firmaRef.current)}` : base,
        { cache: "no-store" },
      );
      if (!res.ok || res.status === 204) return;
      const json = (await res.json()) as { firma?: string; messages: ConversationMessage[] };
      if (!mountedRef.current) return;
      firmaRef.current = json.firma ?? null;
      completaRef.current = Date.now();
      setMessages(json.messages.map(rehydrate));
    } catch {
      // network blip, next tick will retry
    }
  }, [conversation.conversationId]);

  useEffect(() => {
    mountedRef.current = true;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const schedule = () => {
      const delay = document.hidden
        ? POLL_INTERVAL_HIDDEN_MS
        : POLL_INTERVAL_MS;
      timer = setTimeout(async () => {
        // Con la pestaña oculta no se pide nada; al volver, visibilitychange recarga al instante.
        if (!document.hidden) await refetch();
        if (mountedRef.current) schedule();
      }, delay);
    };

    schedule();

    const onSent = () => {
      refetch();
    };
    window.addEventListener("conversations:refresh", onSent);

    const onVisibility = () => {
      if (!document.hidden) refetch();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      mountedRef.current = false;
      if (timer) clearTimeout(timer);
      window.removeEventListener("conversations:refresh", onSent);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [refetch]);

  return (
    <ChatPanel
      contact={contact}
      conversation={conversation}
      messages={messages}
      isAdmin={isAdmin}
      soloLectura={soloLectura}
      detailsOpen={detailsOpen}
      onToggleDetails={onToggleDetails}
    />
  );
}
