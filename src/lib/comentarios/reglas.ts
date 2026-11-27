/**
 * Moderador de comentarios de Facebook e Instagram (reglas puras, sin red ni base).
 *
 * Qué hace con cada comentario según su categoría:
 * - interes   → responde en público + mensaje privado con el WhatsApp de ventas
 * - positivo  → agradece en público con el WhatsApp de ventas
 * - queja     → oculta (no borra) y avisa a los supervisores para resolverla
 * - negativo  → oculta (troll, "estafa", competencia, insultos)
 * - spam      → elimina (links ajenos, bots)
 * - neutro    → nada (etiquetas a amigos, emojis sueltos)
 *
 * El link de WhatsApp lo pone el código, nunca la IA, para que no salga un número equivocado.
 */

export type CategoriaComentario = "interes" | "positivo" | "queja" | "negativo" | "spam" | "neutro";
export type AccionComentario = "responder" | "ocultar" | "eliminar" | "ninguna";

export const CATEGORIAS: readonly CategoriaComentario[] = ["interes", "positivo", "queja", "negativo", "spam", "neutro"];

/** WhatsApp oficial de ventas (Rossana, 977). Se cambia con COMENTARIOS_WHATSAPP. */
export const WHATSAPP_VENTAS_DEFAULT = "51977126462";

export function linkWhatsapp(numero = WHATSAPP_VENTAS_DEFAULT): string {
  return `https://wa.me/${numero.replace(/\D/g, "")}`;
}

export interface PlanComentario {
  categoria: CategoriaComentario;
  publico: AccionComentario;
  /** Mensaje privado (Messenger / DM de Instagram) al autor. */
  privado: boolean;
  /** Aviso a supervisores. */
  avisar: boolean;
}

/** Las respuestas a respuestas (hilos) solo se moderan: no se contesta dentro del hilo. */
export function planPara(categoria: CategoriaComentario, esRespuesta: boolean): PlanComentario {
  switch (categoria) {
    case "interes":
      return { categoria, publico: esRespuesta ? "ninguna" : "responder", privado: !esRespuesta, avisar: false };
    case "positivo":
      return { categoria, publico: esRespuesta ? "ninguna" : "responder", privado: false, avisar: false };
    case "queja":
      return { categoria, publico: "ocultar", privado: false, avisar: true };
    case "negativo":
      return { categoria, publico: "ocultar", privado: false, avisar: false };
    case "spam":
      return { categoria, publico: "eliminar", privado: false, avisar: false };
    default:
      return { categoria: "neutro", publico: "ninguna", privado: false, avisar: false };
  }
}

const RE_LINK = /(https?:\/\/|www\.|\b[a-z0-9-]+\.(com|pe|net|shop|store|site|online|xyz|ly|me)\b)/i;
const RE_LINK_PROPIO = /(alivstore\.shop|wa\.me\/51977126462|wa\.me\/51944392731)/i;
const RE_SPAM = /(gana dinero|ganar dinero desde casa|inversi[oó]n segura|criptomoneda|bitcoin|forex|escr[ií]beme al privado|sorteo|t[ií]o rico|ganancias diarias)/i;
const RE_QUEJA = /(no me (lleg[oó]|entregaron|devolvieron|respond)|nunca lleg[oó]|me cobraron|ped[ií] y no|mi pedido|no contestan|devoluci[oó]n|reclamo|me estafaron|mi dinero)/i;
const RE_NEGATIVO = /(estafa|estafadores|fraude|ladr[oó]n|ladrones|mentira|mentirosos|no sirve|no funciona|basura|enga[nñ]o|charlat|veneno|da[nñ]ino|timo|cuidado con)/i;
const RE_INTERES = /(precio|cu[aá]nto|cuesta|costo|valor|info|informaci[oó]n|env[ií]o|delivery|provincia|c[oó]mo (lo )?(compro|pido|tomo|se toma)|d[oó]nde|quiero|me interesa|pedido|contra ?entrega|yape|lleg(a|an) a|tienen|stock|\bpack\b|\bdm\b|\binbox\b|\bmd\b)/i;
const RE_POSITIVO = /(gracias|excelente|buen[oa]? producto|me (funcion[oó]|ayud[oó]|encant[oó]|gust[oó])|recomiendo|lo tomo|lo uso|genial|bendicion|bendiciones|s[uú]per)/i;
const RE_SOLO_EMOJI_O_TAG = /^[\s\p{Extended_Pictographic}\p{Emoji_Component}!.?¡¿❤️👍🙌]*$/u;

/**
 * Clasificación de respaldo sin IA (si la IA cae o no responde). Prudente: ante la duda
 * no hace nada ("neutro") antes que ocultar o borrar algo que no debía.
 */
export function clasificarSinIA(texto: string, opts: { nombresEtiquetados?: boolean } = {}): CategoriaComentario {
  const t = (texto ?? "").trim();
  if (!t) return "neutro";
  if (RE_LINK.test(t) && !RE_LINK_PROPIO.test(t)) return "spam";
  if (RE_SPAM.test(t)) return "spam";
  if (RE_QUEJA.test(t)) return "queja";
  if (RE_NEGATIVO.test(t)) return "negativo";
  if (RE_INTERES.test(t) || t.includes("?")) return "interes";
  if (RE_POSITIVO.test(t)) return "positivo";
  if (RE_SOLO_EMOJI_O_TAG.test(t) || opts.nombresEtiquetados) return "neutro";
  return "neutro";
}

export function primerNombre(nombre: string | null | undefined): string {
  const n = (nombre ?? "").trim().split(/\s+/)[0] ?? "";
  if (!n || n.startsWith("@") || /\d/.test(n)) return "";
  return n.charAt(0).toUpperCase() + n.slice(1).toLowerCase();
}

/** Respuestas fijas de respaldo (si la IA no dio texto). Rotan por el id del comentario. */
const RESPALDO_INTERES = [
  "¡Hola{n}! 🙌 El envío es gratis y en Lima pagas al recibir. Escríbenos y te pasamos precios y promociones 👉 {wa}",
  "¡Hola{n}! 😊 Te atendemos al toque por WhatsApp con precios, promos y envío gratis 👉 {wa}",
  "¡Hola{n}! 💚 Sí hacemos envíos a todo el Perú, gratis. Te damos toda la info aquí 👉 {wa}",
];
const RESPALDO_POSITIVO = [
  "¡Gracias{n}! 💚 Nos alegra mucho. Cualquier consulta o pedido, aquí te atendemos 👉 {wa}",
  "¡Mil gracias{n}! 🙌 Para pedidos o dudas escríbenos 👉 {wa}",
  "¡Qué bueno leerte{n}! 😊 Si quieres reponer o tienes dudas, aquí estamos 👉 {wa}",
];

function indicePorId(id: string, n: number): number {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h % n;
}

export function respuestaRespaldo(categoria: "interes" | "positivo", comentarioId: string, nombre: string, wa: string): string {
  const lista = categoria === "interes" ? RESPALDO_INTERES : RESPALDO_POSITIVO;
  const plantilla = lista[indicePorId(comentarioId, lista.length)];
  return plantilla.replace("{n}", nombre ? ` ${nombre}` : "").replace("{wa}", wa);
}

/** Palabras que nunca pueden salir en una respuesta pública (política de salud). */
const RE_PROHIBIDO = /\b(cura|curar|cura?n|desintoxica\w*|elimina\w*|bajar? de peso|adelgaza\w*|garantizad[oa] que|h[ií]gado graso)\b/i;

/**
 * Limpia el texto que propuso la IA: quita links que haya inventado, recorta, revisa la
 * política de salud y agrega el WhatsApp oficial al final. Devuelve null si no sirve.
 */
export function sanearRespuesta(texto: string | null | undefined, wa: string): string | null {
  let t = (texto ?? "").replace(/\s+/g, " ").trim();
  if (!t) return null;
  t = t.replace(/https?:\/\/\S+|wa\.me\/\S+|www\.\S+/gi, "").replace(/\+?51\s?9\d{2}\s?\d{3}\s?\d{3}/g, "").trim();
  t = t.replace(/[👉:\-–\s]+$/u, "").trim();
  if (t.length < 8 || t.length > 320) return null;
  if (RE_PROHIBIDO.test(t)) return null;
  return `${t} 👉 ${wa}`;
}

export function mensajePrivado(nombre: string, wa: string): string {
  return (
    `¡Hola${nombre ? ` ${nombre}` : ""}! 👋 Gracias por comentar en nuestra publicación. ` +
    `Te atendemos por WhatsApp con precios, promociones y envío gratis a todo el Perú (en Lima pagas al recibir): ${wa}`
  );
}

export function esCategoria(x: unknown): x is CategoriaComentario {
  return typeof x === "string" && (CATEGORIAS as readonly string[]).includes(x);
}
