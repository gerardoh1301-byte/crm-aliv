"use client";

import { useEffect, useRef, useState } from "react";
import { ConversationsList } from "./ConversationsList";
import type { ConversationListItem } from "@/lib/conversations";

interface Props {
  initialConversations: ConversationListItem[];
  selectedId?: string;
}

// 24/11: antes 4 s (y 20 s con la pestaña oculta). La bandeja completa cada 4 s
// consumía casi todo el ancho de banda gratis de Render (5 GB/mes).
const POLL_INTERVAL_MS = 12000;
const POLL_INTERVAL_HIDDEN_MS = 60000;
// 25/11: se manda la firma de lo último recibido y el servidor responde 204 si nada cambió.
// Cada 2 min se pide todo igual, por si algo cambió sin tocar la firma.
const RECARGA_COMPLETA_MS = 120000;

function rehydrate(raw: ConversationListItem): ConversationListItem {
  return {
    ...raw,
    lastAt: raw.lastAt ? new Date(raw.lastAt) : null,
  };
}

export function ConversationsListLive({
  initialConversations,
  selectedId,
}: Props) {
  const [conversations, setConversations] = useState(initialConversations);
  const mountedRef = useRef(true);
  const firmaRef = useRef<string | null>(null);
  const completaRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const refetch = async () => {
      try {
        const completa = Date.now() - completaRef.current > RECARGA_COMPLETA_MS;
        const url = !completa && firmaRef.current
          ? `/api/conversations?firma=${encodeURIComponent(firmaRef.current)}`
          : "/api/conversations";
        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok || res.status === 204) return;
        const data = (await res.json()) as ConversationListItem[];
        if (!mountedRef.current) return;
        firmaRef.current = res.headers.get("x-firma");
        completaRef.current = Date.now();
        setConversations(data.map(rehydrate));
      } catch {
        // retry on next tick
      }
    };

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
  }, []);

  return (
    <ConversationsList conversations={conversations} selectedId={selectedId} />
  );
}
