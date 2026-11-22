/**
 * Embudo semanal por fuente (auditoría 21/11, V6). Puro para poder probarlo: las consultas
 * viven en `metricas.ts` y aquí solo se cuenta.
 *
 * Fuentes de un chat nuevo:
 * - anuncio: llegó con datos de un anuncio de Meta (ctwa_source_id / meta_ad_id).
 * - confirmacion_web: el cliente ya había hecho un pedido en la web y el chat es para confirmarlo.
 * - mensaje_web: «Hola Aliv Perú, quiero información» sin datos de anuncio (botón de WhatsApp
 *   de la tienda u otro enlace directo).
 * - directo: cualquier otro.
 *
 * Quién cerró un pedido del chat: el autor del último mensaje nuestro antes de crearse
 * (bot = origin «agent»; equipo = escrito desde el teléfono o el CRM).
 */

export type FuenteChat = "anuncio" | "confirmacion_web" | "mensaje_web" | "directo";

export interface FilaEmbudo {
  de_anuncio: boolean;
  pedido_web_previo: boolean;
  primer_mensaje: string | null;
  bot_respondio: boolean;
  siguio: boolean;
  cotizado: boolean;
  pidio_datos: boolean;
  pedido: boolean;
  /** estado del primer pedido dentro de 7 días */
  estado_pedido: string | null;
  /** origin del último mensaje nuestro antes del pedido; null = escrito desde el teléfono */
  cerro_origen: string | null;
  pedido_de_chat: boolean | null;
}

const RE_MENSAJE_WEB = /^\s*hola,? aliv per[uú],? quiero informaci[oó]n/i;

export function fuenteDelChat(f: Pick<FilaEmbudo, "de_anuncio" | "pedido_web_previo" | "primer_mensaje">): FuenteChat {
  if (f.de_anuncio) return "anuncio";
  if (f.pedido_web_previo) return "confirmacion_web";
  if (RE_MENSAJE_WEB.test(f.primer_mensaje ?? "")) return "mensaje_web";
  return "directo";
}

const CONFIRMADOS = new Set(["confirmado", "preparando", "enviado", "entregado"]);

export type QuienCerro = "bot" | "equipo" | "web";

export function quienCerro(f: Pick<FilaEmbudo, "pedido" | "pedido_de_chat" | "cerro_origen">): QuienCerro | null {
  if (!f.pedido) return null;
  if (f.pedido_de_chat === false) return "web";
  return f.cerro_origen === "agent" ? "bot" : "equipo";
}

export interface CuentaEmbudo {
  chats: number;
  bot_respondio: number;
  siguio: number;
  cotizado: number;
  pidio_datos: number;
  pedido: number;
  confirmado: number;
  entregado: number;
  conversion_pct: number;
}

function vacia(): CuentaEmbudo {
  return { chats: 0, bot_respondio: 0, siguio: 0, cotizado: 0, pidio_datos: 0, pedido: 0, confirmado: 0, entregado: 0, conversion_pct: 0 };
}

function sumar(c: CuentaEmbudo, f: FilaEmbudo) {
  c.chats++;
  if (f.bot_respondio) c.bot_respondio++;
  if (f.siguio) c.siguio++;
  if (f.cotizado) c.cotizado++;
  if (f.pidio_datos) c.pidio_datos++;
  if (f.pedido) {
    c.pedido++;
    if (f.estado_pedido && CONFIRMADOS.has(f.estado_pedido)) c.confirmado++;
    if (f.estado_pedido === "entregado") c.entregado++;
  }
}

const pct = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : 0);

export function embudoPorFuente(filas: FilaEmbudo[]) {
  const porFuente: Record<FuenteChat, CuentaEmbudo> = {
    anuncio: vacia(),
    confirmacion_web: vacia(),
    mensaje_web: vacia(),
    directo: vacia(),
  };
  const pedidosPor: Record<QuienCerro, number> = { bot: 0, equipo: 0, web: 0 };
  for (const f of filas) {
    sumar(porFuente[fuenteDelChat(f)], f);
    const q = quienCerro(f);
    if (q) pedidosPor[q]++;
  }
  for (const c of Object.values(porFuente)) c.conversion_pct = pct(c.pedido, c.chats);
  // La meta de la auditoría: pedidos del bot sobre chats nuevos de venta (sin confirmaciones web).
  const chatsVenta = filas.filter((f) => fuenteDelChat(f) !== "confirmacion_web").length;
  return {
    por_fuente: porFuente,
    pedidos_por_quien_cerro: pedidosPor,
    pedidos_bot_sobre_chats_nuevos_pct: pct(pedidosPor.bot, chatsVenta),
    nota:
      "Fuente: anuncio (con datos de Meta), confirmacion_web (ya había pedido web), mensaje_web («Hola Aliv Perú, quiero información» sin anuncio) o directo. Quién cerró: autor del último mensaje nuestro antes del pedido. Meta de la auditoría 21/11: pedidos del bot sobre chats nuevos de ~1 % a 10 %.",
  };
}

/** Respuestas al rescate por valor ofrecido (nota «[RESCATE VENTAS] … valor=X»). */
export function rescatePorValor(filas: Array<{ descripcion: string; respondio: boolean }>) {
  const out: Record<string, { enviados: number; respondieron: number; respuesta_pct: number }> = {};
  for (const f of filas) {
    const valor = /valor=([a-z_]+)/.exec(f.descripcion)?.[1] ?? "sin_valor";
    const c = (out[valor] ??= { enviados: 0, respondieron: 0, respuesta_pct: 0 });
    c.enviados++;
    if (f.respondio) c.respondieron++;
  }
  for (const c of Object.values(out)) c.respuesta_pct = pct(c.respondieron, c.enviados);
  return out;
}
