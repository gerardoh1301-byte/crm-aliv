/**
 * Guion de venta por etapas (plan de entrenamiento del bot, 19/11/2026).
 *
 * El prompt general es largo y el modelo pierde de vista lo importante en cada momento. Este
 * módulo mira el chat, decide en qué etapa va (primer contacto, consulta, cotizado, datos,
 * adelanto) y qué está diciendo el cliente (precio, "está caro", "lo pienso"…), y agrega al
 * final del prompt solo el guion de esa etapa con 2 o 3 ejemplos del banco
 * (config/ejemplos-venta.ts). Lo último que lee el modelo es lo que más pesa.
 *
 * También reparte los chats en la prueba A/B del primer mensaje:
 * - A (control): primera respuesta como hasta hoy.
 * - B: primera respuesta corta (≤ 350 caracteres, una pregunta). Los datos del 12 al 19/11
 *   mostraron que los primeros mensajes cortos siguieron la conversación 70 % de las veces
 *   y terminaron en pedido 39 %, contra 9 % de los de más de 700 caracteres.
 */
import { EJEMPLOS_VENTA, type EjemploVenta, type EtapaVenta, type SituacionVenta } from "../../../config/ejemplos-venta";

export type VarianteAB = "A" | "B";

export interface MensajeChat {
  role: string;
  content: unknown;
}

/** Hash estable (FNV-1a) para que un chat caiga siempre en la misma variante. */
function hash(texto: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < texto.length; i++) {
    h ^= texto.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Variante del primer mensaje para esta conversación.
 * AB_PRIMER_MENSAJE: "on" (por defecto, 50/50), "off" (todos A) o "B" (todos B, para usar
 * la ganadora cuando termine la prueba).
 */
export function varianteAB(conversationId: string, modo = process.env.AB_PRIMER_MENSAJE ?? "on"): VarianteAB {
  const m = modo.trim().toLowerCase();
  if (m === "off" || m === "a") return "A";
  if (m === "b" || m === "todos") return "B";
  return hash(conversationId) % 2 === 0 ? "A" : "B";
}

function texto(c: unknown): string {
  if (typeof c === "string") return c;
  if (Array.isArray(c)) {
    return c
      .map((p) => (p && typeof p === "object" && "text" in p ? String((p as { text: unknown }).text ?? "") : ""))
      .join(" ");
  }
  return "";
}

const RE_PRECIOS = /S\/\s?(79|119|139|189|199|219)\b|\b(119|189|199|139)\b.*(frasco|tobiller)/i;
const RE_PIDE_DATOS_LIMA = /(direcci[oó]n|referencia|a nombre de qui[eé]n|qu[eé] d[ií]a te acomoda)/i;
const RE_PROVINCIA = /(shalom|agencia|adelanto de s\/ ?20)/i;
const RE_PIDE_ADELANTO = /(adelanto de s\/ ?20|yape\s*\*?9\d{8}|captura del (yape|adelanto)|\bdni\b)/i;

/** Etapa del chat según lo que ya se dijo. */
export function detectarEtapa(historial: MensajeChat[], opts: { tienePedido?: boolean } = {}): EtapaVenta {
  if (opts.tienePedido) return "con_pedido";
  const bot = historial.filter((m) => m.role === "assistant").map((m) => texto(m.content));
  if (bot.length === 0) return "primer_contacto";
  const todoBot = bot.join("\n");
  const ultimosBot = bot.slice(-2).join("\n");
  const todoCliente = historial
    .filter((m) => m.role === "user")
    .map((m) => texto(m.content))
    .join("\n");

  if (RE_PIDE_ADELANTO.test(ultimosBot)) return "adelanto";
  const esProvincia = RE_PROVINCIA.test(ultimosBot) || /\b(provincia|arequipa|piura|trujillo|chiclayo|cusco|iquitos|huancayo|ica|tacna|puno|pucallpa|chimbote|cajamarca|ayacucho|tarapoto|huaraz|juliaca)\b/i.test(todoCliente);
  if (RE_PIDE_DATOS_LIMA.test(ultimosBot) || /\b(quiero|me llevo|deseo)\b.*\b(1|2|3|uno|dos|tres|el de|las|los)\b/i.test(todoCliente)) {
    return esProvincia ? "datos_provincia" : "datos_lima";
  }
  if (RE_PRECIOS.test(todoBot)) return "cotizado";
  return "consulta";
}

/** Qué está planteando el cliente en su último mensaje. */
export function detectarSituacion(ultimoCliente: string): SituacionVenta | null {
  const t = ultimoCliente.toLowerCase().trim();
  if (!t) return null;
  if (/\b(en (unos )?\d+ ?(min|minutos|hora|horas)|m[aá]s tarde|en un rato|ahorita te|ma[nñ]ana te|luego te (paso|escribo|confirmo)|te aviso|te escribo)\b/.test(t)) return "promete_volver";
  if (/\b(caro|car[ií]simo|descuento|rebaja|menos precio|muy costoso)\b/.test(t)) return "caro";
  if (/\b(lo pienso|lo voy a pensar|pensarlo|despu[eé]s veo|lo analizo)\b/.test(t)) return "lo_pienso";
  if (/\b(esposo|esposa|mi hij[oa]|mi mam[aá]|mi pap[aá]|consult(o|ar)|familia)\b/.test(t)) return "consulta_tercero";
  if (/\b(estafa|confiable|conf[ií]o|seguro que llega|real|fraude|enga[nñ]o)\b/.test(t)) return "confianza";
  if (/\b(funciona|sirve|resultado|efecto|de verdad)\b/.test(t)) return "funciona";
  if (/\b(demora|cu[aá]nto tarda|llega a|env[ií]an a|delivery|cu[aá]ndo llega)\b/.test(t)) return "entrega";
  if (/\b(c[oó]mo (se )?pag|yape|plin|transferencia|contraentrega|pago)\b/.test(t)) return "pago";
  if (/\b(precio|cu[aá]nto (cuesta|est[aá]|vale|es)|costo)\b/.test(t)) return "pide_precio";
  if (/\b(quiero|me llevo|deseo|separa|lo pido)\b/.test(t)) return "elige_pack";
  if (/\b(informaci[oó]n|info|detalles)\b/.test(t)) return "pide_info";
  if (/^(ok|okey|oki|ya|bueno|listo|gracias|👍|ok gracias|ya gracias)[.!]*$/.test(t)) return "silencio_ok";
  return null;
}

export function detectarProducto(historial: MensajeChat[], productoAnuncio?: "nac600" | "termix" | null): "nac600" | "termix" | null {
  if (productoAnuncio) return productoAnuncio;
  const todo = historial.map((m) => texto(m.content)).join("\n");
  const termix = (todo.match(/termix|tobiller/gi) ?? []).length;
  const nac = (todo.match(/nac\s?600|nad\+|h[ií]gado/gi) ?? []).length;
  if (termix === 0 && nac === 0) return null;
  return termix > nac ? "termix" : "nac600";
}

/** 2 o 3 ejemplos del banco que más se parecen a la situación. */
export function elegirEjemplos(
  etapa: EtapaVenta,
  situacion: SituacionVenta | null,
  producto: "nac600" | "termix" | null,
  banco: EjemploVenta[] = EJEMPLOS_VENTA,
  max = 3
): EjemploVenta[] {
  return banco
    .map((e) => {
      let puntos = 0;
      if (situacion && e.situacion === situacion) puntos += 3;
      if (e.etapas.includes(etapa)) puntos += 2;
      if (producto && e.producto === producto) puntos += 1;
      if (producto && e.producto && e.producto !== producto) puntos -= 3;
      return { e, puntos };
    })
    .filter((x) => x.puntos >= 2)
    .sort((a, b) => b.puntos - a.puntos || (a.e.origen === "real" ? -1 : 1))
    .slice(0, max)
    .map((x) => x.e);
}

const GUION_ETAPA: Record<EtapaVenta, string> = {
  primer_contacto:
    "Es tu primer mensaje. Saluda una vez y lleva la conversación al producto; termina con UNA pregunta fácil de contestar.",
  consulta:
    "El cliente todavía no tiene precios. Responde lo que preguntó en 1 o 2 líneas, da el precio del pack recomendado y propón el pedido.",
  cotizado:
    "Ya le diste precios. No los repitas. Responde lo que dijo y propón el pedido armado (pack recomendado + su distrito o ciudad) con una pregunta de sí o no.",
  datos_lima:
    "Está eligiendo o ya eligió. Pide solo el dato que falta (nombre, dirección con número y referencia, día de entrega) en una frase. Con todo completo, registra el pedido en este turno.",
  datos_provincia:
    "Provincia, en este orden y sin juntar todo: 1) confirma la agencia Shalom más cercana; 2) recién entonces el adelanto de S/20 al Yape; 3) nombre completo y DNI para la guía. Da la prueba de confianza (guía oficial de Shalom con rastreo, RUC 20612283134).",
  adelanto:
    "Ya le pediste el adelanto. No repitas toda la explicación: responde su duda en una línea y pide solo lo que falte (captura del Yape, nombre o DNI).",
  con_pedido:
    "Ya tiene pedido registrado. No vuelvas a vender ni cotizar: atiende lo que pregunta sobre su pedido.",
};

const PRIMER_MENSAJE_CORTO =
  "PRUEBA A/B (variante B): tu primera respuesta tiene como MÁXIMO 350 caracteres y 3 líneas. Contenido: saludo con su nombre si lo tienes, UN beneficio en palabras simples, el precio del pack recomendado (NAC600: 3 frascos *S/199*; Termix: 2 tobilleras *S/139*), \"envío gratis\" y UNA pregunta fácil de contestar. Nada de listas de precios completas, links, ni explicación del adelanto de provincia en este primer mensaje: eso va después, cuando lo pregunte o cuando ya eligió. Esta instrucción manda sobre cualquier modelo de primera respuesta más largo que aparezca antes.";

export interface EntradaGuion {
  conversationId: string;
  historial: MensajeChat[];
  tienePedido?: boolean;
  productoAnuncio?: "nac600" | "termix" | null;
}

export interface Guion {
  etapa: EtapaVenta;
  situacion: SituacionVenta | null;
  variante: VarianteAB;
  bloque: string;
}

/** Bloque para el final del system prompt. */
export function renderGuionVenta(e: EntradaGuion): Guion {
  const etapa = detectarEtapa(e.historial, { tienePedido: e.tienePedido });
  const ultimoCliente = [...e.historial].reverse().find((m) => m.role === "user");
  const situacion = detectarSituacion(texto(ultimoCliente?.content));
  const producto = detectarProducto(e.historial, e.productoAnuncio);
  const variante = varianteAB(e.conversationId);

  const partes = ["\n\n# GUION PARA ESTE MENSAJE (lo más importante ahora)", `Etapa: ${etapa}. ${GUION_ETAPA[etapa]}`];
  if (etapa === "primer_contacto" && variante === "B") partes.push(PRIMER_MENSAJE_CORTO);

  if (etapa !== "con_pedido") {
    const ejemplos = elegirEjemplos(etapa, situacion, producto);
    if (ejemplos.length > 0) {
      partes.push(
        "Ejemplos de respuestas que cierran en una situación parecida (imita el largo y la forma de cerrar; adapta nombres, producto y datos al chat real, no los copies):"
      );
      for (const ej of ejemplos) partes.push(`- Cliente: "${ej.cliente}"\n  Tú: "${ej.respuesta}"`);
    }
  }
  return { etapa, situacion, variante, bloque: partes.join("\n") };
}
