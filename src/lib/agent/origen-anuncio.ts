/**
 * Chats que llegan desde un anuncio Click-to-WhatsApp de Meta.
 *
 * Dos problemas que resuelve:
 * 1. El saludo automatico de la app WhatsApp Business ("¡Hola! 👋 Bienvenido a *Aliv
 *    Peru*...") entra al CRM como un saliente sin `origin` a los 1-2 s del primer mensaje
 *    del cliente. El agente lo tomaba como "ya respondido" y no contestaba nunca el
 *    "Quiero mas informacion" del anuncio. Ese saludo se descarta del historial.
 * 2. El agente no sabia de que anuncio vino el cliente y preguntaba "¿NAC600 o Termix?".
 *    Con los campos `ctwa_*` que guarda Zernio se le dice el producto del anuncio para
 *    que su primera respuesta sea la informacion puntual de ese producto.
 */

/** Textos del saludo automatico de WhatsApp Business (no los escribe nadie del equipo). */
const SALUDOS_AUTOMATICOS = [/Bienvenid[oa]\s+a\s+\*?Aliv\s+Per[uú]/i];

/** true si el saliente es el saludo automatico de la app y no una respuesta real. */
export function esSaludoAutomatico(direction: string, origin: string | null, body: string | null): boolean {
  if (direction !== "out" || origin) return false;
  const texto = body ?? "";
  return SALUDOS_AUTOMATICOS.some((re) => re.test(texto));
}

export type ProductoAnuncio = "termix" | "nac600";

const PRODUCTOS: Array<{ clave: ProductoAnuncio; patron: RegExp }> = [
  { clave: "termix", patron: /termix|tobiller/i },
  { clave: "nac600", patron: /nac\s*-?\s*600|\bnad\+?|h[ií]gado/i },
];

function texto(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/** Producto que anuncia el aviso de origen, o null si no se reconoce. */
export function productoDelAnuncio(metadata: unknown): ProductoAnuncio | null {
  if (!metadata || typeof metadata !== "object") return null;
  const md = metadata as Record<string, unknown>;
  const contenido = [md.ctwa_headline, md.ctwa_body, md.meta_ad_title].map(texto).join(" \n ");
  if (!contenido.trim()) return null;
  return PRODUCTOS.find((p) => p.patron.test(contenido))?.clave ?? null;
}

const PRIMERA_RESPUESTA: Record<ProductoAnuncio, string> = {
  termix: [
    "El cliente escribio desde un anuncio de la *Termix Tobillera*. NO le preguntes que producto le interesa: ya lo sabes.",
    "Tu PRIMERA respuesta es la informacion puntual de la Termix, en un solo mensaje corto y facil de leer en el celular, con este contenido:",
    "- Saludo calido con su nombre si lo tienes (\"¡Hola, {nombre}! 👋 Gracias por escribir a Aliv Peru. Te cuento sobre la *Termix Tobillera* 🦶🔥\").",
    "- Beneficio en palabras simples: calor rapido con placas termicas de grafeno + doble motor de masaje por vibracion, para relajar los tobillos cansados mientras descansas.",
    "- Inalambrica, recargable por USB-C, talla universal (18 a 34 cm), sirve para el tobillo izquierdo o derecho.",
    "- Precios: 1 tobillera *S/99*; 2 tobilleras *S/169* (S/84,50 c/u) ⭐ la mas elegida, ideal para regalar; 3 tobilleras *S/219* (S/73 c/u).",
    "- Envio gratis a todo el Peru. Lima: pagas al recibir. Provincias: adelanto de S/20 y el saldo al recoger en agencia Shalom.",
    "- Garantia de 30 dias y el link con fotos y videos: https://alivstore.shop/products/termix-tobillera",
    "- Cierra con UNA pregunta que lleve al pedido: \"¿Cuantas te gustaria y a que distrito o ciudad te la enviamos? 😊\"",
    "Si el anuncio habla de un regalo (mama, papa, Navidad), conecta con eso en una frase. No prometas curar ni tratar ninguna enfermedad.",
  ].join("\n"),
  nac600: [
    "El cliente escribio desde un anuncio de *NAC600 + NAD+*. NO le preguntes que producto le interesa: ya lo sabes.",
    "Tu PRIMERA respuesta es la informacion puntual de NAC600 (que es, como se toma, precios por cantidad, envio gratis, forma de pago y link https://alivstore.shop/products/nac600), en un solo mensaje corto, y cierra con una pregunta que lleve al pedido.",
  ].join("\n"),
};

/**
 * Bloque para el system prompt con el anuncio de origen. Vacio si el chat no vino de un
 * anuncio. La instruccion de "primera respuesta" solo va mientras el agente no haya
 * respondido nada en este hilo; despues queda solo como dato de contexto.
 */
export function renderOrigenAnuncio(metadata: unknown, agenteYaRespondio: boolean): string {
  if (!metadata || typeof metadata !== "object") return "";
  const md = metadata as Record<string, unknown>;
  const titular = texto(md.ctwa_headline) || texto(md.meta_ad_title);
  const cuerpo = texto(md.ctwa_body).replace(/\s+/g, " ").slice(0, 400);
  if (!titular && !cuerpo) return "";

  const producto = productoDelAnuncio(metadata);
  const partes = [
    "\n\n## Origen del chat: anuncio de Meta",
    ...(titular ? [`- Titular del anuncio: ${titular}`] : []),
    ...(cuerpo ? [`- Texto del anuncio: ${cuerpo}`] : []),
  ];
  if (producto) {
    partes.push(`- Producto del anuncio: ${producto === "termix" ? "Termix Tobillera" : "NAC600 + NAD+"}`);
    if (!agenteYaRespondio) partes.push("", PRIMERA_RESPUESTA[producto]);
  }
  return partes.join("\n");
}
