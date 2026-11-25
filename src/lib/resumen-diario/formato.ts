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

/** «hace 5 h», «hace 2 días». */
export function hace(desde: Date | string | null, ahora: Date): string {
  if (!desde) return "";
  const min = Math.max(0, Math.round((ahora.getTime() - new Date(desde).getTime()) / 60_000));
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 48) return `hace ${h} h`;
  return `hace ${Math.round(h / 24)} días`;
}

function nombreCorto(p: Pendiente): string {
  return (p.nombre ?? "").replace(/\s+/g, " ").trim().split(" ").slice(0, 2).join(" ") || "un cliente";
}

/** Cuántos hay de cada tipo, en líneas cortas (solo las que tienen algo). */
function conteos(pendientes: Pendiente[], incluirPostulantes: boolean): string[] {
  const n = (t: TipoPendiente) => pendientes.filter((p) => p.tipo === t).length;
  return [
    n("esperando") ? `💬 ${n("esperando")} esperan respuesta` : "",
    n("asesor") ? `🙋 ${n("asesor")} pidieron hablar con una persona` : "",
    n("por_cerrar") ? `🛒 ${n("por_cerrar")} por cerrar venta` : "",
    incluirPostulantes && n("postulante") ? `👔 ${n("postulante")} postulantes por contactar` : "",
  ].filter(Boolean);
}

/** El más urgente: el que espera respuesta hace más tiempo; si no, el primero que pidió persona. */
function primero(pendientes: Pendiente[], ahora: Date): string {
  const p = pendientes.find((x) => x.tipo === "esperando") ?? pendientes.find((x) => x.tipo === "asesor");
  if (!p) return "";
  const que = p.tipo === "esperando" ? "espera respuesta" : "pidió hablar con una persona";
  return `👉 Empieza por *${nombreCorto(p)}*: ${que} ${hace(p.desde, ahora)}.`;
}

/** Texto corto para un vendedor (el detalle va en el PDF); null si no tiene pendientes. */
export function textoResumenVendedor(nombre: string, todos: Pendiente[], ahora: Date): string | null {
  const pendientes = todos.filter((p) => p.tipo !== "postulante");
  if (!pendientes.length) return null;
  return [
    `📋 *${nombre}, tus pendientes para mañana*`,
    conteos(pendientes, false).join("\n"),
    primero(pendientes, ahora),
    "📄 Te envío el detalle en PDF.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** Texto corto para el administrador: lo principal del día; el detalle va en el PDF. */
export function textoResumenAdmin(input: {
  pendientes: Pendiente[];
  actividad: ActividadDia;
  vendedores: { id: string; nombre: string | null }[];
  envios: { nombre: string; ok: boolean; error?: string; sinPendientes?: boolean }[];
  ahora: Date;
}): string {
  const { pendientes, actividad, vendedores, envios, ahora } = input;
  const nombreDe = (id: string | null) => vendedores.find((v) => v.id === id)?.nombre || "Sin asignar";
  const clientes = pendientes.filter((p) => p.tipo !== "postulante");

  const porDueno = new Map<string, number>();
  for (const p of clientes) porDueno.set(nombreDe(p.ownerId), (porDueno.get(nombreDe(p.ownerId)) ?? 0) + 1);
  const reparto = [...porDueno.entries()].sort((a, b) => b[1] - a[1]).map(([n, c]) => `${n} ${c}`).join(" · ");
  const noLlego = envios.filter((e) => !e.ok && !e.sinPendientes).map((e) => e.nombre);
  const [d, m] = fechaLimaCorta(ahora).split("-").reverse();

  return [
    `📊 *Resumen del día ${d}/${m}*`,
    `Hoy: ${actividad.chatsNuevos} chats nuevos · ${actividad.pedidosNuevos} pedidos nuevos`,
    conteos(pendientes, true).join("\n") || "✅ Sin pendientes",
    reparto ? `Por vendedor: ${reparto}` : "",
    noLlego.length ? `⚠️ No les llegó su resumen: ${noLlego.join(", ")} (deben escribir al 944)` : "",
    "📄 El detalle va en el PDF.",
  ]
    .filter(Boolean)
    .join("\n\n");
}
