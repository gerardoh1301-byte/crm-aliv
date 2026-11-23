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
  if (/\b(no tengo (dinero|plata)|no me alcanza|sin plata|ando (corto|misio)|estoy (corto|misio))\b/.test(t)) return "sin_dinero";
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
    "Ya le diste precios. No los repitas. Responde lo que dijo y propón el pedido armado (pack recomendado + su distrito o ciudad). Cierra con una alternativa entre dos opciones de compra («¿Te separo los 3 o prefieres empezar con 1?»), no con «¿te ayudo a registrar tu pedido?». Si elige 1 o 2, di una sola vez cuánto más cuesta el siguiente pack («por solo S/10 más te llevas 3 y tienes 90 días»).",
  datos_lima:
    "Está eligiendo o ya eligió. Pide solo el dato que falta (nombre, dirección con número y referencia, día de entrega) en una frase, y que comparta su UBICACIÓN por WhatsApp (📎 → Ubicación) si aún no la mandó. Con todo completo, registra el pedido en este turno (no esperes la ubicación para registrarlo).",
  datos_provincia:
    "Provincia, en este orden y sin juntar todo: 1) confirma la agencia Shalom más cercana; 2) recién entonces el adelanto de S/20 al Yape; 3) nombre completo y DNI para la guía. Da la prueba de confianza (guía oficial de Shalom con rastreo, RUC 20612283134).",
  adelanto:
    "Ya le pediste el adelanto. No repitas toda la explicación: responde su duda en una línea y pide solo lo que falte (captura del Yape, nombre o DNI).",
  con_pedido:
    "Ya tiene pedido registrado. No vuelvas a vender ni cotizar: atiende lo que pregunta sobre su pedido.",
};

const PRIMER_MENSAJE_CORTO =
  "PRUEBA A/B (variante B): tu primera respuesta tiene como MÁXIMO 350 caracteres y 3 líneas. Contenido: saludo con su nombre si lo tienes, UN beneficio en palabras simples, el precio del pack recomendado (NAC600: 3 frascos *S/199*; Termix: 2 tobilleras *S/139*), \"envío gratis\" y UNA pregunta fácil de contestar. Nada de listas de precios completas, links, ni explicación del adelanto de provincia en este primer mensaje: eso va después, cuando lo pregunte o cuando ya eligió. Esta instrucción manda sobre cualquier modelo de primera respuesta más largo que aparezca antes.";

// ---------------------------------------------------------------------------
// Cierre (auditoría 21/11, V1, V2 y V4)

function sinTildes(t: string): string {
  return t.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/**
 * El cliente ya decidió: «deseo comprar 3», «quiero 2», «cómo hago el pedido», «me lo
 * separas». Antes el bot lo trataba como una consulta más (preguntaba el producto, repetía
 * la oferta) y la venta se enfriaba.
 */
export function detectarSenalCompra(ultimoCliente: string): boolean {
  const t = sinTildes(ultimoCliente);
  if (!t.trim()) return false;
  if (/\b(no (quiero|deseo|me interesa)|por ahora no|ahora no)\b/.test(t)) return false;
  return (
    /\b(quiero|quisiera|deseo|me llevo|lo pido|la pido|los pido|las pido|separa(me|melo|mela)?|reservame|lo compro|la compro|mandame|enviame|me lo envias|me la envias)\b.{0,40}\b(\d|uno|una|dos|tres|frascos?|tobilleras?|pack|comprar|pedido|pedir|llevar)/.test(t) ||
    /\b(quiero|deseo|quisiera) (comprar|pedir|hacer (el|un|mi) pedido|llevarlo|llevarla)\b/.test(t) ||
    /\bcomo (hago|hago para|puedo) (el |un |mi )?(pedido|pedir|comprar|compro)\b/.test(t) ||
    /\b(lo|la|los|las) (quiero|compro)\b/.test(t)
  );
}

/** El cliente cierra la puerta («gracias, por ahora no», «no tengo dinero»): no se le empuja. */
export function esRechazo(ultimoCliente: string): boolean {
  const t = sinTildes(ultimoCliente);
  return /\b(por ahora no|ahora no|no gracias|no me interesa|no estoy interesad[oa]|no tengo (dinero|plata)|ya no|no por el momento|mas adelante|despues le aviso|yo le aviso|yo te aviso|no me escriban|no me esten escribiendo|dejen de escribir)\b/.test(t);
}

function nombreProducto(p: "nac600" | "termix" | null): string {
  return p === "termix" ? "Termix Tobillera" : p === "nac600" ? "NAC600 + NAD+" : "";
}

function modoCierre(producto: "nac600" | "termix" | null): string {
  return [
    "MODO CIERRE: el cliente YA DECIDIÓ comprar. En ESTE mensaje cierras, no vuelves a vender (esto manda sobre el orden paso a paso de la etapa):",
    producto
      ? `- El producto es *${nombreProducto(producto)}*: NO le preguntes cuál quiere.`
      : "- Si no sabes el producto, pregúntalo dentro del mismo mensaje en que pides los datos («¿Es el NAC600 para el hígado o la Termix para tobillos?»), no en un mensaje aparte.",
    "- Si dijo una cantidad, ese es el pack (3 = 3 frascos o 3 tobilleras) con su precio oficial; confírmalo en media línea.",
    "- Pide TODOS los datos que faltan en un solo mensaje. Lima o ciudad con contra entrega: nombre completo, dirección con número y una referencia. Provincia con Shalom: propón la agencia Shalom de su ciudad y pide nombre completo y DNI para la guía; el adelanto de S/20 va cuando confirme la agencia.",
    "- Nada de beneficios, listas de precios ni links ahora. Máximo 4 líneas.",
    "- En cuanto tengas los datos, registra el pedido con crear_pedido_chat en ese mismo turno.",
  ].join("\n");
}

const PRIMER_CONTACTO_SIN_PRODUCTO =
  "No sabes qué producto vio (escribió sin anuncio, por ejemplo desde la web). NO mandes el menú de los dos productos ni preguntes «¿cuál te interesa?». Pregunta por su necesidad en una línea, por ejemplo: «¡Hola! 👋 ¿Lo buscas para cuidar tu hígado o para el dolor y cansancio de tobillos?». Con su respuesta ya sabes el producto. Esta instrucción manda sobre cualquier modelo de primera respuesta que aparezca antes.";

/**
 * Pregunta que hace avanzar la venta según la etapa. Antes solo el 49 % de las respuestas
 * terminaba en pregunta, y un mensaje sin pregunta deja al cliente sin nada que contestar.
 */
export function preguntaDeAvance(etapa: EtapaVenta, producto: "nac600" | "termix" | null): string | null {
  switch (etapa) {
    case "primer_contacto":
    case "consulta":
      return producto ? "¿Te lo enviamos a Lima o a provincia? 😊" : "¿Lo buscas para el hígado o para los tobillos? 😊";
    case "cotizado":
      return producto === "termix"
        ? "¿Te separo el par de tobilleras con envío gratis?"
        : producto === "nac600"
          ? "¿Te separo los 3 frascos con envío gratis?"
          : "¿Cuál te separo con envío gratis?";
    case "datos_lima":
      return "¿Me pasas tu dirección con número y una referencia, y qué día de esta semana te acomoda recibirlo? Si puedes, compárteme también tu ubicación por aquí 📍";
    case "datos_provincia":
      return "¿Qué agencia Shalom te queda más cerca?";
    default:
      return null;
  }
}

const RE_DESPEDIDA = /(que tengas|aqu[ií] estaremos|respetamos tu decisi[oó]n|cuando gustes|a tu disposici[oó]n|buenas noches|feliz (d[ií]a|tarde|noche)|bendiciones)/i;

/**
 * Si la respuesta del bot no tiene ninguna pregunta y el chat está en venta, se agrega la
 * pregunta de avance de la etapa. No toca despedidas, rechazos, pedidos ya registrados ni
 * la etapa de adelanto (ahí el bot espera la captura).
 */
export function asegurarPreguntaDeAvance(
  respuesta: string,
  e: { etapa: EtapaVenta; producto: "nac600" | "termix" | null; ultimoCliente: string }
): string {
  const limpio = respuesta.trim();
  if (!limpio || limpio.includes("?")) return respuesta;
  if (esRechazo(e.ultimoCliente) || RE_DESPEDIDA.test(limpio)) return respuesta;
  const pregunta = preguntaDeAvance(e.etapa, e.producto);
  if (!pregunta) return respuesta;
  return `${limpio}\n\n${pregunta}`;
}

export interface EntradaGuion {
  conversationId: string;
  historial: MensajeChat[];
  tienePedido?: boolean;
  productoAnuncio?: "nac600" | "termix" | null;
  /** Su ciudad de provincia tiene contra entrega de AliClik: se vende como en Lima. */
  contraEntregaProvincia?: boolean;
}

export interface Guion {
  etapa: EtapaVenta;
  situacion: SituacionVenta | null;
  variante: VarianteAB;
  bloque: string;
  producto: "nac600" | "termix" | null;
  senalCompra: boolean;
  ultimoCliente: string;
}

/** Bloque para el final del system prompt. */
export function renderGuionVenta(e: EntradaGuion): Guion {
  const etapaDetectada = detectarEtapa(e.historial, { tienePedido: e.tienePedido });
  const etapa: EtapaVenta =
    e.contraEntregaProvincia && etapaDetectada === "datos_provincia" ? "datos_lima" : etapaDetectada;
  const ultimoCliente = [...e.historial].reverse().find((m) => m.role === "user");
  const situacion = detectarSituacion(texto(ultimoCliente?.content));
  const producto = detectarProducto(e.historial, e.productoAnuncio);
  const variante = varianteAB(e.conversationId);

  const textoCliente = texto(ultimoCliente?.content);
  const senalCompra = etapa !== "con_pedido" && detectarSenalCompra(textoCliente);

  const partes = ["\n\n# GUION PARA ESTE MENSAJE (lo más importante ahora)", `Etapa: ${etapa}. ${GUION_ETAPA[etapa]}`];
  if (senalCompra) partes.push(modoCierre(producto));
  else if (etapa === "primer_contacto" && !producto) partes.push(PRIMER_CONTACTO_SIN_PRODUCTO);
  else if (etapa === "primer_contacto" && variante === "B") partes.push(PRIMER_MENSAJE_CORTO);

  if (etapa !== "con_pedido") {
    const ejemplos = elegirEjemplos(etapa, situacion, producto);
    if (ejemplos.length > 0) {
      partes.push(
        "Ejemplos de respuestas que cierran en una situación parecida (imita el largo y la forma de cerrar; adapta nombres, producto y datos al chat real, no los copies):"
      );
      for (const ej of ejemplos) partes.push(`- Cliente: "${ej.cliente}"\n  Tú: "${ej.respuesta}"`);
    }
  }
  return { etapa, situacion, variante, bloque: partes.join("\n"), producto, senalCompra, ultimoCliente: textoCliente };
}
