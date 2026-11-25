/**
 * Resumen diario de pendientes (25/11/2026, pedido de Gerardo): a las 22:00 de Lima cada
 * vendedor recibe por WhatsApp los pendientes de SUS clientes y Gerardo un resumen de todos
 * los chats, para empezar la jornada al día siguiente sabiendo qué atender.
 *
 * Módulo puro (sin base): arma los textos para poder probarlos.
 */

export type TipoPendiente = "esperando" | "asesor" | "por_cerrar" | "postulante";

export interface Pendiente {
  tipo: TipoPendiente;
  conversationId: string | null;
  ownerId: string | null;
  nombre: string | null;
  telefono: string | null;
  /** Último mensaje del cliente o motivo (asesor) o etapa (por cerrar). */
  detalle: string | null;
  desde: Date | string | null;
}

export interface ActividadDia {
  chatsNuevos: number;
  mensajesClientes: number;
  pedidosNuevos: number;
  /** Etapas operativas: nombre → cantidad (por despachar, adelanto pagado, en camino). */
  etapas: { nombre: string; n: number }[];
}

export const HORA_RESUMEN_LIMA = 22;
/** Máximo de clientes listados por sección (WhatsApp corta a 4096 caracteres). */
export const MAX_POR_SECCION = 8;

const TITULOS: Record<TipoPendiente, string> = {
  esperando: "💬 *Esperan tu respuesta*",
  asesor: "🙋 *Pidieron hablar con una persona*",
  por_cerrar: "🛒 *Por cerrar (intención de compra)*",
  postulante: "👔 *Postulantes por contactar*",
};
const ORDEN: TipoPendiente[] = ["esperando", "asesor", "por_cerrar", "postulante"];

/** Los postulantes (anuncio de empleo) no son clientes: solo los ve el administrador. */
export function esPostulante(motivo: string | null | undefined): boolean {
  return /^postulante/i.test((motivo ?? "").trim());
}

/** Hora (0-23) en Lima. */
export function horaLima(ahora: Date): number {
  return Number(
    new Intl.DateTimeFormat("en-US", { timeZone: "America/Lima", hour: "2-digit", hourCycle: "h23" }).format(ahora)
  );
}

/** «2026-11-25» en Lima. */
export function fechaLimaCorta(ahora: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Lima" }).format(ahora);
}

export function tocaResumen(ahora: Date): boolean {
  return horaLima(ahora) >= HORA_RESUMEN_LIMA;
}

function telCorto(tel: string | null): string {
  const d = (tel ?? "").replace(/\D/g, "").slice(-9);
  return d ? d.replace(/(\d{3})(\d{3})(\d{3})/, "$1 $2 $3") : "sin número";
}

function hace(desde: Date | string | null, ahora: Date): string {
  if (!desde) return "";
  const min = Math.max(0, Math.round((ahora.getTime() - new Date(desde).getTime()) / 60_000));
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 48) return `hace ${h} h`;
  return `hace ${Math.round(h / 24)} días`;
}

function recortar(t: string | null, n = 70): string {
  const limpio = (t ?? "").replace(/\s+/g, " ").trim();
  return limpio.length > n ? `${limpio.slice(0, n - 1)}…` : limpio;
}

function linea(p: Pendiente, ahora: Date): string {
  const extra = [recortar(p.detalle), hace(p.desde, ahora)].filter(Boolean).join(" · ");
  return `• ${p.nombre?.trim() || "Sin nombre"} (${telCorto(p.telefono)})${extra ? ` — ${extra}` : ""}`;
}

function secciones(pendientes: Pendiente[], ahora: Date): string[] {
  const out: string[] = [];
  for (const tipo of ORDEN) {
    const lista = pendientes.filter((p) => p.tipo === tipo);
    if (!lista.length) continue;
    const lineas = lista.slice(0, MAX_POR_SECCION).map((p) => linea(p, ahora));
    if (lista.length > MAX_POR_SECCION) lineas.push(`… y ${lista.length - MAX_POR_SECCION} más en el CRM`);
    out.push(`${TITULOS[tipo]} (${lista.length})\n${lineas.join("\n")}`);
  }
  return out;
}

/** Texto para un vendedor; null si no tiene pendientes (no se le escribe). */
export function textoResumenVendedor(nombre: string, todos: Pendiente[], ahora: Date): string | null {
  const pendientes = todos.filter((p) => p.tipo !== "postulante");
  if (!pendientes.length) return null;
  return [
    `📋 *Pendientes para mañana, ${nombre}*`,
    ...secciones(pendientes, ahora),
    "Empieza por los que esperan respuesta. Todo está en https://crm-aliv.onrender.com/conversations",
  ].join("\n\n");
}

/** Texto para el administrador: actividad del día, pendientes por vendedor y la lista completa. */
export function textoResumenAdmin(input: {
  pendientes: Pendiente[];
  actividad: ActividadDia;
  vendedores: { id: string; nombre: string | null }[];
  envios: { nombre: string; ok: boolean; error?: string; sinPendientes?: boolean }[];
  ahora: Date;
}): string {
  const { pendientes, actividad, vendedores, envios, ahora } = input;
  const nombreDe = (id: string | null) => vendedores.find((v) => v.id === id)?.nombre || "Sin asignar";
  const cuenta = (lista: Pendiente[], t: TipoPendiente) => lista.filter((p) => p.tipo === t).length;

  const porDueno = new Map<string, Pendiente[]>();
  for (const p of pendientes) {
    const k = nombreDe(p.ownerId);
    porDueno.set(k, [...(porDueno.get(k) ?? []), p]);
  }
  const clientes = (l: Pendiente[]) => l.filter((p) => p.tipo !== "postulante");
  const filasDueno = [...porDueno.entries()]
    .map(([n, l]) => [n, clientes(l)] as const)
    .filter(([, l]) => l.length > 0)
    .sort((a, b) => b[1].length - a[1].length)
    .map(([n, l]) => `• ${n}: ${cuenta(l, "esperando")} esperan · ${cuenta(l, "asesor")} piden persona · ${cuenta(l, "por_cerrar")} por cerrar`);

  const etapas = actividad.etapas.filter((e) => e.n > 0).map((e) => `• ${e.nombre}: ${e.n}`);
  const estadoEnvios = envios.map((e) =>
    e.ok ? `• ${e.nombre}: enviado ✅` : e.sinPendientes ? `• ${e.nombre}: sin pendientes` : `• ${e.nombre}: NO enviado (${e.error ?? "error"}) ⚠️`
  );

  return [
    `📊 *Resumen del día — ${fechaLimaCorta(ahora)}*`,
    `*Hoy:* ${actividad.chatsNuevos} chats nuevos · ${actividad.mensajesClientes} mensajes de clientes · ${actividad.pedidosNuevos} pedidos nuevos`,
    etapas.length ? `*Pedidos en curso*\n${etapas.join("\n")}` : "",
    filasDueno.length ? `*Pendientes por vendedor*\n${filasDueno.join("\n")}` : "✅ *Sin chats pendientes*",
    ...secciones(pendientes, ahora),
    estadoEnvios.length ? `*Resúmenes a vendedores*\n${estadoEnvios.join("\n")}` : "",
  ]
    .filter(Boolean)
    .join("\n\n")
    .slice(0, 4000);
}
