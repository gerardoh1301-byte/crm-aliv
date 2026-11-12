"use client";

import Link from "next/link";
import { AlertCircle, Bot, Search, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ConversationListItem } from "@/lib/conversations";
import { cn } from "@/lib/utils";
import { avatarBg, getInitials } from "@/lib/avatar";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import type { Channel } from "@/lib/channels/types";
import { CHANNEL_COLORS, ChannelIcon } from "@/components/icons/channels";
import { ChannelFilter } from "./ChannelFilter";
import { ETIQUETAS_PRINCIPALES, getTagStyle } from "@/lib/tags";

const MINUTOS_ESPERA = 10;

function formatoEspera(min: number): string {
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)} h`;
}

interface Props {
  conversations: ConversationListItem[];
  selectedId?: string;
}

export function ConversationsList({ conversations, selectedId }: Props) {
  const [search, setSearch] = useState("");
  const [channel, setChannel] = useState<Channel | "all">("all");
  const [tagFilter, setTagFilter] = useState<string>("all");
  const searchParams = useSearchParams();
  const [soloAtencion, setSoloAtencion] = useState(searchParams.get("filtro") === "atencion");
  // Reloj de la bandeja: "espera N min" avanza solo cada minuto.
  const [ahora, setAhora] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setAhora(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  /** Alerta del bot, o cliente que escribio y espera respuesta hace mas de 10 min. */
  const minutosEsperando = (c: ConversationListItem): number | null => {
    if (c.lastDirection !== "in" || !c.lastAt || c.provider === "simulador") return null;
    const min = Math.floor((ahora - new Date(c.lastAt).getTime()) / 60_000);
    // Mas de 2 dias sin respuesta ya no es "esperando": es un chat que quedo atras.
    return min >= MINUTOS_ESPERA && min <= 48 * 60 ? min : null;
  };
  // Igual que el Dashboard: los chats del simulador no cuentan como pendientes reales.
  const requiereAtencion = (c: ConversationListItem) =>
    c.provider !== "simulador" && (c.needsHuman || minutosEsperando(c) !== null);
  const totalAtencion = conversations.filter(requiereAtencion).length;

  const counts = useMemo(() => {
    const acc: Record<string, number> = {};
    for (const c of conversations) acc[c.channel] = (acc[c.channel] ?? 0) + 1;
    return acc;
  }, [conversations]);

  const tagCounts = useMemo(() => {
    const acc: Record<string, number> = {};
    for (const c of conversations) {
      if (c.tags) {
        for (const t of c.tags) {
          const norm = t.toLowerCase();
          acc[norm] = (acc[norm] ?? 0) + 1;
        }
      }
    }
    return acc;
  }, [conversations]);

  const filtered = useMemo(() => {
    const base = soloAtencion ? conversations.filter(requiereAtencion) : conversations;
    const byChannel =
      channel === "all"
        ? base
        : base.filter((c) => c.channel === channel);

    const byTag =
      tagFilter === "all"
        ? byChannel
        : byChannel.filter((c) =>
            c.tags?.some((t) => t.toLowerCase() === tagFilter.toLowerCase())
          );

    const q = search.trim().toLowerCase();
    if (!q) return byTag;
    const digits = q.replace(/\D/g, "");
    return byTag.filter((c) => {
      if (c.name?.toLowerCase().includes(q)) return true;
      if (c.lastBody?.toLowerCase().includes(q)) return true;
      if (c.handle?.toLowerCase().includes(q)) return true;
      if (digits && c.phone && c.phone.replace(/\D/g, "").includes(digits))
        return true;
      if (c.tags?.some((t) => t.toLowerCase().includes(q))) return true;
      return false;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversations, search, channel, tagFilter, soloAtencion]);

  return (
    <aside
      className={cn(
        "w-full md:w-[340px] shrink-0 border-r border-border h-full flex-col bg-card",
        // En telefono no hay lugar para lista + chat: con un hilo abierto se ve solo el
        // chat (y el boton de volver en su cabecera). Sin eso, el chat colapsaba a 0 px.
        selectedId ? "hidden md:flex" : "flex"
      )}
    >
      <div className="h-14 px-4 flex items-center border-b border-border bg-muted/40">
        <h2 className="text-sm font-semibold tracking-tight font-heading">
          Conversaciones
        </h2>
        <span className="ml-auto text-[11px] font-mono text-muted-foreground tabular-nums">
          {filtered.length}
          {search && filtered.length !== conversations.length && (
            <span className="text-muted-foreground/60">/{conversations.length}</span>
          )}
        </span>
      </div>

      <div className="px-3 py-2 border-b border-border/60 bg-card">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nombre, usuario o telefono"
            className="w-full h-8 pl-8 pr-7 text-[12px] rounded-md border border-border/70 bg-muted/40 placeholder:text-muted-foreground focus:outline-none focus:bg-card focus:border-border focus:ring-2 focus:ring-primary/20 transition-colors"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              aria-label="Limpiar busqueda"
              className="absolute right-1.5 top-1/2 -translate-y-1/2 inline-flex h-5 w-5 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground hover:bg-muted/60 cursor-pointer"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>

      {/* Vista rapida: todo o solo lo que necesita a una persona */}
      <div className="px-3 pt-2 pb-1.5 border-b border-border/50 bg-card" role="tablist" aria-label="Vista de la bandeja">
        <div className="grid grid-cols-2 gap-1 rounded-lg bg-muted/60 p-0.5 text-[11.5px] font-medium">
          <button
            type="button"
            role="tab"
            aria-selected={!soloAtencion}
            onClick={() => setSoloAtencion(false)}
            className={cn(
              "h-7 rounded-md cursor-pointer transition-colors",
              !soloAtencion ? "bg-card shadow-xs text-foreground" : "text-muted-foreground hover:text-foreground"
            )}
          >
            Todas
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={soloAtencion}
            onClick={() => setSoloAtencion(true)}
            className={cn(
              "h-7 rounded-md cursor-pointer transition-colors inline-flex items-center justify-center gap-1.5",
              soloAtencion ? "bg-card shadow-xs text-foreground" : "text-muted-foreground hover:text-foreground"
            )}
          >
            Requiere atención
            {totalAtencion > 0 && (
              <span className="inline-flex items-center justify-center h-4 min-w-4 px-1 rounded-full bg-amber-500 text-white text-[10px] font-semibold tabular-nums">
                {totalAtencion}
              </span>
            )}
          </button>
        </div>
      </div>

      <ChannelFilter value={channel} onChange={setChannel} counts={counts} />

      {/* Filtro rápido por Etiquetas Principales */}
      <div className="px-2.5 py-1.5 border-b border-border/50 bg-muted/20 flex items-center gap-1 overflow-x-auto no-scrollbar">
        <button
          type="button"
          onClick={() => setTagFilter("all")}
          className={cn(
            "shrink-0 px-2 py-0.5 rounded-full border text-[10px] transition-all cursor-pointer font-medium",
            tagFilter === "all"
              ? "bg-primary text-primary-foreground border-primary font-semibold shadow-2xs"
              : "bg-background/80 text-muted-foreground border-border hover:bg-muted hover:text-foreground"
          )}
        >
          Todas
        </button>
        {ETIQUETAS_PRINCIPALES.map((p) => {
          const isSelected = tagFilter.toLowerCase() === p.nombre.toLowerCase();
          const count = tagCounts[p.nombre.toLowerCase()] ?? 0;
          return (
            <button
              key={p.nombre}
              type="button"
              onClick={() => setTagFilter(isSelected ? "all" : p.nombre)}
              className={cn(
                "shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] transition-all cursor-pointer font-medium whitespace-nowrap shadow-2xs",
                isSelected
                  ? `${p.color} ring-1.5 ring-primary/40 font-bold`
                  : "bg-background/80 text-muted-foreground border-border/60 hover:bg-muted hover:text-foreground"
              )}
            >
              <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", p.dot ?? "bg-primary")} />
              {p.nombre}
              {count > 0 && (
                <span className="text-[9px] opacity-80 font-mono font-semibold">({count})</span>
              )}
            </button>
          );
        })}
      </div>

      <div className="flex-1 overflow-auto">
        {conversations.length === 0 ? (
          <div className="px-4 py-12 text-center">
            <p className="text-sm text-muted-foreground">
              Aun no hay conversaciones.
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Cuando alguien te escriba por WhatsApp, Instagram o Messenger,
              va a aparecer aca.
            </p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="px-4 py-12 text-center">
            <p className="text-sm text-muted-foreground">
              {soloAtencion && !search ? "Nada pendiente: ningún chat requiere atención." : <>Sin resultados para &quot;{search}&quot;</>}
            </p>
            <p className="text-xs text-muted-foreground/70 mt-1">
              Probá buscando por nombre, usuario o número.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-border/40">
            {filtered.map((c) => {
              const isActive = selectedId === c.conversationId;
              return (
                <li key={c.conversationId}>
                  <Link
                    href={`/conversations/${c.conversationId}`}
                    className={cn(
                      "relative flex items-start gap-3 px-3 py-3 cursor-pointer transition-all",
                      isActive
                        ? "bg-primary/10"
                        : "hover:bg-muted/60 hover:shadow-xs",
                    )}
                  >
                    {isActive && (
                      <span
                        aria-hidden
                        className="absolute left-0 top-2 bottom-2 w-0.75 rounded-r-full bg-primary"
                      />
                    )}
                    <div className="relative shrink-0">
                      <div
                        className={cn(
                          "h-9 w-9 rounded-full flex items-center justify-center text-[11px] font-semibold",
                          avatarBg(c.name),
                        )}
                      >
                        {getInitials(c.name)}
                      </div>
                      <span
                        title={c.channel}
                        className={cn(
                          "absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full border border-card bg-card",
                          CHANNEL_COLORS[c.channel],
                        )}
                      >
                        <ChannelIcon channel={c.channel} className="h-2.5 w-2.5" />
                      </span>
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-2">
                        <span className="text-[13px] font-medium truncate flex-1 flex items-center gap-1.5">
                          {c.name}
                          {c.provider === "simulador" && (
                            <span
                              title="Conversacion simulada: nada sale a un canal real"
                              className="shrink-0 inline-flex items-center h-4 px-1 rounded-sm bg-violet-100 text-violet-800 text-[9px] font-semibold uppercase tracking-wide dark:bg-violet-950/40 dark:text-violet-300"
                            >
                              sim
                            </span>
                          )}
                          {c.needsHuman && (
                            <span
                              title={
                                c.needsHumanReason
                                  ? `Alerta del bot: ${c.needsHumanReason}`
                                  : "Alerta del bot: requiere una persona"
                              }
                              className="shrink-0 inline-flex items-center gap-0.5 h-4 px-1 rounded-sm bg-amber-100 text-amber-800 text-[9px] font-semibold uppercase tracking-wide dark:bg-amber-950/40 dark:text-amber-300"
                            >
                              <AlertCircle className="h-2.5 w-2.5" />
                              alerta
                            </span>
                          )}
                          <span
                            title={c.aiEnabled ? "Bot activo en este chat" : "Bot apagado: atiende una persona"}
                            className={cn(
                              "shrink-0 inline-flex items-center gap-0.5 h-4 px-1 rounded-sm text-[9px] font-semibold uppercase tracking-wide",
                              c.aiEnabled
                                ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
                                : "bg-muted text-muted-foreground"
                            )}
                          >
                            <Bot className="h-2.5 w-2.5" />
                            {c.aiEnabled ? "on" : "off"}
                          </span>
                        </span>
                        {minutosEsperando(c) !== null ? (
                          <span
                            className="text-[10px] font-semibold text-red-600 dark:text-red-400 shrink-0 tabular-nums"
                            title="El cliente escribió y nadie respondió"
                          >
                            espera {formatoEspera(minutosEsperando(c)!)}
                          </span>
                        ) : c.lastAt && (
                          <span className="text-[10px] font-mono text-muted-foreground shrink-0 tabular-nums">
                            {formatDistanceToNow(c.lastAt, {
                              addSuffix: false,
                              locale: es,
                            })
                              .replace("alrededor de ", "")
                              .replace("menos de ", "<")}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <p className="text-xs text-muted-foreground truncate flex-1">
                          {c.lastDirection === "out" && (
                            <span className="text-muted-foreground/70">
                              tu:{" "}
                            </span>
                          )}
                          {c.lastBody ?? "(sin cuerpo)"}
                        </p>
                        {c.unreadCount > 0 && (
                          <span className="shrink-0 inline-flex items-center justify-center h-4 min-w-4 px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-semibold tabular-nums">
                            {c.unreadCount}
                          </span>
                        )}
                      </div>
                      {c.tags && c.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1.5">
                          {c.tags
                            .filter((t) => !["shopify", "alivstore", "easysell_cod"].includes(t))
                            .slice(0, 3)
                            .map((t) => {
                              const style = getTagStyle(t);
                              return (
                                <span
                                  key={t}
                                  className={cn(
                                    "inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9.5px] font-medium border shadow-2xs leading-none",
                                    style.badge
                                  )}
                                >
                                  {style.dot && (
                                    <span className={cn("h-1.5 w-1.5 rounded-full mr-0.5", style.dot)} />
                                  )}
                                  {style.label}
                                </span>
                              );
                            })}
                          {c.tags.filter((t) => !["shopify", "alivstore", "easysell_cod"].includes(t)).length > 3 && (
                            <span className="text-[9px] text-muted-foreground self-center">
                              +{c.tags.filter((t) => !["shopify", "alivstore", "easysell_cod"].includes(t)).length - 3}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </aside>
  );
}
