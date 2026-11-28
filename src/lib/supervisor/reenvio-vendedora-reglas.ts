/**
 * Reenvío a Gerardo de lo que entra al número de la vendedora (977126462), 27/11/2026.
 * Gerardo no puede abrir ese WhatsApp en su teléfono: cada mensaje de un cliente le llega
 * como aviso al 951 (por el 944) y puede contestar desde ahí con «r …».
 *
 *  - «r 4464 dile que sí llega mañana»  → la IA redacta la respuesta y pide «r ok».
 *  - «r 4464 "Hola, sí llega mañana"»   → sale tal cual, sin borrador.
 *  - «r …» sin los 4 dígitos            → al cliente del último aviso.
 *  - «r ok» / «r no»                    → envía o descarta el borrador.
 *
 * Módulo puro (sin base) para poder probarlo.
 */

export const CLAVE_ULTIMO_AVISO_VENDEDORA = "supervisor.vendedora.ultimo_aviso";
export const CLAVE_BORRADOR_VENDEDORA = "supervisor.vendedora.borrador";
/** El borrador vale 30 min: después «r ok» ya no manda nada. */
export const VIGENCIA_BORRADOR_MS = 30 * 60 * 1000;

export type RespuestaVendedora =
  | { tipo: "confirmar" }
  | { tipo: "descartar" }
  | { tipo: "responder"; ref: string | null; texto: string; literal: boolean };

/** Últimos 4 dígitos del teléfono del cliente: la referencia que va en el aviso. */
export function refCliente(telefono: string | null | undefined): string {
  const d = String(telefono ?? "").replace(/\D/g, "");
  return d.slice(-4) || "????";
}

const LITERAL = /^\s*["“«']([\s\S]+?)["”»']\s*$/;

/** Lee «r …». null si el mensaje no es una respuesta al número de la vendedora. */
export function interpretarRespuestaVendedora(body: string | null | undefined): RespuestaVendedora | null {
  const t = String(body ?? "").trim();
  const m = /^r\s*[:.,-]?\s+([\s\S]+)$/i.exec(t);
  if (!m) return null;
  const resto = m[1].trim();
  if (/^(ok|okey|okay|si|sí|envia|envía|enviar|dale|listo)[.!]*$/i.test(resto)) return { tipo: "confirmar" };
  if (/^(no|cancela|cancelar|descarta|descartar|borra)[.!]*$/i.test(resto)) return { tipo: "descartar" };

  let ref: string | null = null;
  let texto = resto;
  const conRef = /^(\d{4})\b\s*[:.,-]?\s*([\s\S]+)$/.exec(resto);
  if (conRef) {
    ref = conRef[1];
    texto = conRef[2].trim();
  }
  if (!texto) return null;
  const lit = LITERAL.exec(texto);
  return lit ? { tipo: "responder", ref, texto: lit[1].trim(), literal: true } : { tipo: "responder", ref, texto, literal: false };
}

const ETIQUETA_TIPO: Record<string, string> = {
  image: "📷 imagen",
  audio: "🎤 audio",
  voice: "🎤 audio",
  video: "🎬 video",
  document: "📄 documento",
  sticker: "sticker",
  location: "📍 ubicación",
};

/** Texto del mensaje para el aviso (adjuntos sin texto se nombran; lo largo se corta). */
export function cuerpoParaAviso(body: string | null | undefined, tipo: string | null | undefined): string {
  const texto = String(body ?? "").trim();
  const etiqueta = tipo && tipo !== "text" ? ETIQUETA_TIPO[tipo] ?? tipo : null;
  if (!texto) return etiqueta ? `[${etiqueta}]` : "[mensaje sin texto]";
  const corto = texto.length > 600 ? `${texto.slice(0, 600)}…` : texto;
  return etiqueta ? `[${etiqueta}] ${corto}` : corto;
}

export interface DatosAvisoVendedora {
  nombre: string | null;
  telefono: string | null;
  cuerpo: string;
  pedido?: string | null;
  botEncendido: boolean;
  vendedora?: string | null;
  conversationId: string;
}

export function textoAvisoVendedora(d: DatosAvisoVendedora): string {
  const ref = refCliente(d.telefono);
  const cliente = `${d.nombre?.trim() || "Cliente"} (${d.telefono ?? "sin número"})`;
  return [
    `📩 *977${d.vendedora ? ` · ${d.vendedora}` : ""}* · ${cliente} · ref *${ref}*`,
    d.pedido ? `🧾 ${d.pedido}` : null,
    `💬 ${d.cuerpo}`,
    d.botEncendido ? "🤖 El bot le está respondiendo." : "👤 Bot apagado: responde la vendedora.",
    `↩️ *r ${ref} <qué decirle>* (redacto y confirmas) · *r ${ref} "texto exacto"* (sale tal cual)`,
    `🔗 https://crm-aliv.onrender.com/conversations/${d.conversationId}`,
  ]
    .filter(Boolean)
    .join("\n");
}
