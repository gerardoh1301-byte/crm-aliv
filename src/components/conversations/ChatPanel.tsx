"use client";

import { useState, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import Link from "next/link";
import { ConversationMessage } from "@/lib/conversations";
import { ChatInput } from "./ChatInput";
import { cn } from "@/lib/utils";
import { avatarBg, getInitials } from "@/lib/avatar";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import {
  ArrowLeft,
  Check,
  CheckCheck,
  AlertCircle,
  Clock,
  PanelRightClose,
  PanelRightOpen,
  Reply,
  Tag,
} from "lucide-react";
import { CHANNEL_LABELS, type Channel } from "@/lib/channels/types";
import { CHANNEL_COLORS, ChannelIcon } from "@/components/icons/channels";
import { ConversationActions } from "./ConversationActions";
import { ETIQUETAS_PRINCIPALES, getTagStyle } from "@/lib/tags";
import { toast } from "sonner";

interface Contact {
  id: string;
  name: string;
  phone: string | null;
  tags?: string[];
}

interface ConversationHeaderInfo {
  conversationId: string;
  channel: Channel;
  /** Telefono en WhatsApp, @usuario en Instagram, nombre en Messenger. */
  handle: string | null;
  lastInboundAt?: Date | string | null;
}

interface Props {
  contact: Contact;
  conversation: ConversationHeaderInfo;
  messages: ConversationMessage[];
  /** El menu de eliminar solo se le muestra al admin. */
  isAdmin?: boolean;
  detailsOpen?: boolean;
  onToggleDetails?: () => void;
}

function StatusIcon({ msg }: { msg: ConversationMessage }) {
  if (msg.direction !== "out") return null;
  if (msg.status === "failed")
    return <AlertCircle className="h-3 w-3 text-destructive" />;
  if (msg.status === "pending")
    return <Clock className="h-3 w-3 text-muted-foreground" />;
  if (msg.status === "read")
    return <CheckCheck className="h-3 w-3 text-sky-600" />;
  if (msg.status === "delivered")
    return <CheckCheck className="h-3 w-3 text-muted-foreground" />;
  return <Check className="h-3 w-3 text-muted-foreground" />;
}

export function ChatPanel({
  contact,
  conversation,
  messages,
  isAdmin,
  detailsOpen,
  onToggleDetails,
}: Props) {
  const [replyingTo, setReplyingTo] = useState<ConversationMessage | null>(null);
  const [localTags, setLocalTags] = useState<string[]>(contact.tags ?? []);
  const [showTagMenu, setShowTagMenu] = useState(false);
  const tagMenuRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const prevContactIdRef = useRef<string | null>(null);
  const prevCountRef = useRef(messages.length);

  useEffect(() => {
    setLocalTags(contact.tags ?? []);
  }, [contact.id, contact.tags]);

  // Cerrar menú al hacer clic fuera
  useEffect(() => {
    if (!showTagMenu) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (tagMenuRef.current && !tagMenuRef.current.contains(e.target as Node)) {
        setShowTagMenu(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showTagMenu]);

  const toggleTag = async (tagName: string) => {
    if (!contact.id) return;
    const current = localTags;
    const exists = current.some((t) => t.toLowerCase() === tagName.toLowerCase());
    const next = exists
      ? current.filter((t) => t.toLowerCase() !== tagName.toLowerCase())
      : [...current, tagName];
    setLocalTags(next);
    try {
      const res = await fetch(`/api/contacts/${contact.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tags: next }),
      });
      if (!res.ok) throw new Error();
      window.dispatchEvent(new Event("conversations:refresh"));
      toast.success(exists ? `Etiqueta eliminada: ${tagName}` : `Etiquetado: ${tagName}`);
    } catch {
      setLocalTags(current);
      toast.error("No se pudo actualizar la etiqueta");
    }
  };

  // Ultimo mensaje entrante del cliente: define la ventana de 24h para texto libre.
  // El servidor ya lo materializa en la conversacion; se recalcula desde los mensajes
  // como respaldo para que el banner reaccione al polling sin recargar la pagina.
  const lastInboundAt = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].direction === "in") {
        return messages[i].sentAt ?? messages[i].createdAt ?? null;
      }
    }
    return conversation.lastInboundAt
      ? new Date(conversation.lastInboundAt)
      : null;
  }, [messages, conversation.lastInboundAt]);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const isNewConversation =
      prevContactIdRef.current !== conversation.conversationId;
    if (isNewConversation) {
      el.scrollTop = el.scrollHeight;
      prevContactIdRef.current = conversation.conversationId;
      prevCountRef.current = messages.length;
    }
  }, [conversation.conversationId, messages.length]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (messages.length > prevCountRef.current) {
      const distanceFromBottom =
        el.scrollHeight - el.scrollTop - el.clientHeight;
      const last = messages[messages.length - 1];
      const isOwnMessage = last?.direction === "out";
      if (isOwnMessage || distanceFromBottom < 200) {
        el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
      }
    }
    prevCountRef.current = messages.length;
  }, [messages]);

  return (
    <section className="flex-1 flex flex-col h-full min-w-0 bg-background">
      {/* Header */}
      <header className="h-14 px-3 md:px-5 flex items-center gap-2 md:gap-3 border-b border-border bg-muted/40 shrink-0">
        <Link
          href="/conversations"
          aria-label="Volver a la lista"
          className="md:hidden -ml-1 h-9 w-9 shrink-0 inline-flex items-center justify-center rounded-full text-muted-foreground hover:bg-muted/60"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="relative shrink-0">
          <div
            className={cn(
              "h-9 w-9 rounded-full flex items-center justify-center text-[11px] font-semibold",
              avatarBg(contact.name),
            )}
          >
            {getInitials(contact.name)}
          </div>
          <span
            title={CHANNEL_LABELS[conversation.channel]}
            className={cn(
              "absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full border border-card bg-card",
              CHANNEL_COLORS[conversation.channel],
            )}
          >
            <ChannelIcon channel={conversation.channel} className="h-2.5 w-2.5" />
          </span>
        </div>
        <div className="flex flex-col min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[14px] font-semibold tracking-tight truncate">
              {contact.name}
            </span>
            {localTags
              .filter((t) => ETIQUETAS_PRINCIPALES.some((p) => p.nombre.toLowerCase() === t.toLowerCase()))
              .map((t) => {
                const style = getTagStyle(t);
                return (
                  <span
                    key={t}
                    className={cn(
                      "hidden sm:inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border shadow-2xs leading-none",
                      style.badge
                    )}
                  >
                    {style.dot && (
                      <span className={cn("h-1.5 w-1.5 rounded-full", style.dot)} />
                    )}
                    {style.label}
                  </span>
                );
              })}
          </div>
          <span className="text-[11px] text-muted-foreground truncate flex items-center gap-1.5">
            <span
              aria-hidden
              className="h-1.5 w-1.5 rounded-full bg-emerald-500"
            />
            {conversation.handle ?? CHANNEL_LABELS[conversation.channel]}
          </span>
        </div>
        <div className="ml-auto flex items-center gap-1.5 shrink-0">
          {/* Selector Rápido de Etiquetas */}
          {contact.id && (
            <div className="relative" ref={tagMenuRef}>
              <button
                type="button"
                onClick={() => setShowTagMenu((prev) => !prev)}
                className={cn(
                  "inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md border text-xs font-medium transition-colors cursor-pointer shadow-2xs",
                  localTags.some((t) => ETIQUETAS_PRINCIPALES.some((p) => p.nombre.toLowerCase() === t.toLowerCase()))
                    ? "bg-primary/10 border-primary/30 text-primary font-semibold hover:bg-primary/15"
                    : "bg-background border-border text-muted-foreground hover:text-foreground hover:bg-muted"
                )}
                title="Etiquetar conversación"
              >
                <Tag className="h-3.5 w-3.5" />
                <span className="hidden md:inline">
                  {localTags.find((t) => ETIQUETAS_PRINCIPALES.some((p) => p.nombre.toLowerCase() === t.toLowerCase())) ?? "Etiquetar"}
                </span>
              </button>

              {showTagMenu && (
                <div className="absolute right-0 top-full mt-1.5 w-60 rounded-lg border border-border bg-popover p-1.5 text-popover-foreground shadow-lg z-50 text-xs animate-in fade-in-0 zoom-in-95">
                  <div className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground border-b border-border/50 mb-1 flex items-center justify-between">
                    <span>Etiquetar conversación</span>
                  </div>
                  <div className="space-y-0.5">
                    {ETIQUETAS_PRINCIPALES.map((p) => {
                      const active = localTags.some((t) => t.toLowerCase() === p.nombre.toLowerCase());
                      return (
                        <button
                          key={p.nombre}
                          type="button"
                          onClick={() => {
                            void toggleTag(p.nombre);
                          }}
                          className={cn(
                            "w-full flex items-center justify-between px-2.5 py-1.5 rounded-md text-left transition-colors cursor-pointer",
                            active
                              ? `${p.color} font-semibold ring-1 ring-primary/30`
                              : "hover:bg-muted text-foreground"
                          )}
                        >
                          <span className="flex items-center gap-2">
                            <span className={cn("h-2 w-2 rounded-full", p.dot ?? "bg-primary")} />
                            {p.nombre}
                          </span>
                          {active && <Check className="h-3.5 w-3.5" />}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        {onToggleDetails && (
          <button
            type="button"
            onClick={onToggleDetails}
            aria-label={
              detailsOpen ? "Ocultar detalles" : "Mostrar detalles"
            }
            className="hidden lg:inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors cursor-pointer"
          >
            {detailsOpen ? (
              <PanelRightClose className="h-4 w-4" />
            ) : (
              <PanelRightOpen className="h-4 w-4" />
            )}
          </button>
        )}
        {isAdmin && (
          <ConversationActions
            conversationId={conversation.conversationId}
            name={contact.name}
            messageCount={messages.length}
          />
        )}
        </div>
      </header>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-auto px-4 md:px-8 py-6">
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center">
            <p className="text-sm text-muted-foreground">
              Sin mensajes todavia.
            </p>
            <p className="text-xs text-muted-foreground/70 mt-1">
              Escribi abajo y presiona Enter para enviar el primero.
            </p>
          </div>
        ) : (
          <ol className="flex flex-col gap-1.5 max-w-2xl mx-auto">
            {messages.map((m, idx) => {
              const isOut = m.direction === "out";
              const prev = messages[idx - 1];
              const showTimestamp =
                !prev ||
                prev.direction !== m.direction ||
                (m.sentAt && prev.sentAt &&
                  m.sentAt.getTime() - prev.sentAt.getTime() > 5 * 60 * 1000);

              return (
                <li
                  key={m.id}
                  className={cn(
                    "flex flex-col gap-1",
                    isOut ? "items-end" : "items-start",
                    showTimestamp && idx > 0 ? "mt-3" : ""
                  )}
                >
                  {showTimestamp && m.sentAt && (
                    <span className="text-[10px] font-mono text-muted-foreground/70 self-center my-2">
                      {format(m.sentAt, "d 'de' MMM, HH:mm", { locale: es })}
                    </span>
                  )}
                  <div
                    className={cn(
                      "group/bubble flex items-center gap-1.5 max-w-[85%] md:max-w-[70%]",
                      isOut ? "flex-row-reverse" : "flex-row"
                    )}
                  >
                    <div
                      className={cn(
                        "rounded-2xl px-3.5 py-2 text-[13px] leading-relaxed break-words border",
                        isOut
                          ? "bg-primary text-primary-foreground border-transparent shadow-sm rounded-br-md"
                          : "bg-card text-foreground border-border shadow-xs rounded-bl-md",
                      )}
                    >
                      {/* Mensaje Citado (Respuesta a otro mensaje estilo WhatsApp) */}
                      {(() => {
                        const rp = (m.rawPayload ?? {}) as Record<string, any>;
                        const quotedText = rp?.quotedText as string | undefined;
                        const quotedSender = rp?.quotedSender as string | undefined;
                        const targetMsg = rp?.replyTo ? messages.find((x) => x.externalId === rp.replyTo || x.id === rp.replyTo) : null;
                        const finalQuotedText = quotedText || targetMsg?.body;
                        const finalQuotedSender = quotedSender || (targetMsg ? (targetMsg.direction === "out" ? "Tú" : contact.name) : null);

                        if (!finalQuotedText) return null;

                        return (
                          <div
                            className={cn(
                              "mb-2 p-2 rounded-md text-[11.5px] border-l-4 leading-tight select-none",
                              isOut
                                ? "bg-black/15 border-primary-foreground/70 text-primary-foreground/90"
                                : "bg-muted/70 border-primary text-foreground/90"
                            )}
                          >
                            <p className="font-bold text-[10px] mb-0.5 opacity-90">
                              {finalQuotedSender || "Mensaje citado"}
                            </p>
                            <p className="line-clamp-2 italic text-[11px] opacity-80">
                              {finalQuotedText}
                            </p>
                          </div>
                        );
                      })()}

                      {(() => {
                        const imgMatch = m.body?.match(/https?:\/\/[^\s)]+\.(?:jpg|jpeg|png|webp|gif)/i);
                        const imgUrl = imgMatch ? imgMatch[0] : null;
                        const textoLimpio = imgUrl ? m.body?.replace(imgUrl, "").replace(/\[imagen\]/i, "").trim() : m.body;

                        return (
                          <div className="space-y-1.5">
                            {imgUrl && (
                              <div className="overflow-hidden rounded-lg border border-border/50 max-w-[280px]">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                  src={imgUrl}
                                  alt="Imagen"
                                  className="w-full h-auto object-cover max-h-[220px] rounded"
                                  loading="lazy"
                                />
                              </div>
                            )}
                            {(textoLimpio || !imgUrl) && (
                              <p>
                                {textoLimpio || (
                                  <span className="italic text-current/60">
                                    ({m.type})
                                  </span>
                                )}
                              </p>
                            )}
                          </div>
                        );
                      })()}
                      {m.templateName && (
                        <div className="mt-1 text-[10px] font-mono opacity-70">
                          plantilla: {m.templateName}
                        </div>
                      )}
                    </div>

                    {/* Botón flotante para responder/citar este mensaje */}
                    <button
                      type="button"
                      onClick={() => setReplyingTo(m)}
                      className="opacity-0 group-hover/bubble:opacity-100 transition-opacity p-1.5 rounded-full hover:bg-muted text-muted-foreground hover:text-foreground cursor-pointer shrink-0 shadow-2xs"
                      title="Responder a este mensaje"
                    >
                      <Reply className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <div
                    className={cn(
                      "flex items-center gap-1 text-[10px] font-mono text-muted-foreground px-1",
                      isOut ? "flex-row-reverse" : ""
                    )}
                  >
                    <StatusIcon msg={m} />
                    {m.sentAt && (
                      <span>{format(m.sentAt, "HH:mm")}</span>
                    )}
                    {m.errorMessage && (
                      <span className="text-destructive">· {parseError(m.errorMessage)}</span>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </div>

      {/* Input */}
      <ChatInput
        conversationId={conversation.conversationId}
        channel={conversation.channel}
        contactId={contact.id}
        contactPhone={contact.phone ?? ""}
        contactName={contact.name}
        lastInboundAt={lastInboundAt}
        replyingTo={replyingTo}
        onClearReply={() => setReplyingTo(null)}
      />
    </section>
  );
}

function parseError(raw: string): string {
  try {
    const e = JSON.parse(raw);
    return e.message || e.error?.message || "error";
  } catch {
    return raw.slice(0, 80);
  }
}
