/**
 * Postulantes al puesto de "Asesor comercial".
 *
 * El aviso de empleo de Meta lleva al mismo WhatsApp de ventas con el mensaje
 * "Hola, quiero postular al puesto de Asesor comercial". Sin esto el bot lo trataba como
 * cliente y le ofrecía NAC600. Si algún mensaje del cliente menciona "asesor(a) comercial",
 * el prompt cambia a modo reclutamiento: explica el puesto, pide que cuente su experiencia
 * (sin CV) y avisa al equipo, sin vender ni registrar pedidos.
 */

type MensajeHistorial = { role: string; content: unknown };

/** Etiqueta del contacto: lo excluye del rescate y del toque en caliente. */
export const TAG_POSTULANTE = "postulante";

/**
 * Frases del CLIENTE que solo usa alguien que viene por el aviso de empleo. El 24/11 el
 * primer mensaje del aviso llegó como "[Unsupported message]" (error 131060 de Meta, sin
 * texto ni anuncio) y la persona siguió con «vengo por lo del trabajo remoto» y «decía
 * asesor de confirmaciones»: con solo "asesor comercial" el bot le dijo que no había empleo.
 * "trabajo" suelto no cuenta ("estoy en el trabajo" lo dice cualquier cliente).
 */
const PATRONES_POSTULANTE: RegExp[] = [
  /asesor(?:a|\(a\))?\s+(?:comercial|de\s+confirmaci)/i,
  /\bpostul/i,
  /\bconvocatoria\b/i,
  /\bvacante/i,
  /\b(?:trabajo|empleo|chamba)\s+(?:remot|remor|virtual|desde\s+casa|home)/i,
  /\b(?:oferta|aviso|anuncio|puesto|propuesta)\s+de\s+(?:trabajo|empleo)/i,
  /\b(?:busco|buscan|buscando|necesitan|necesito)\s+(?:un\s+)?(?:trabajo|empleo|personal)\b/i,
  /\bpor\s+(?:lo\s+)?del?\s+(?:trabajo|empleo|puesto)\b/i,
  /\bempleo\b/i,
];

/** Texto del anuncio de empleo (Click to WhatsApp): «Empleo: Asesor(a) de confirmaciones». */
const PATRON_ANUNCIO_EMPLEO =
  /\bempleo\b|asesor(?:a|\(a\))?\s+(?:comercial|de\s+confirmaci)|estamos\s+contratando|convocatoria|\bpostul/i;

function textoPlano(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/** true si el chat vino del anuncio de empleo (los datos del anuncio están en conversation.metadata). */
export function vieneDeAnuncioEmpleo(metadata: unknown): boolean {
  if (!metadata || typeof metadata !== "object") return false;
  const md = metadata as Record<string, unknown>;
  const contenido = [md.ctwa_headline, md.ctwa_body, md.meta_ad_title].map(textoPlano).join(" \n ");
  return contenido.trim() !== "" && PATRON_ANUNCIO_EMPLEO.test(contenido);
}

/**
 * true si el cliente escribe por el aviso de empleo: lo dice en cualquiera de sus mensajes
 * o el chat vino del anuncio de empleo.
 */
export function esPostulante(historial: MensajeHistorial[], metadata?: unknown): boolean {
  if (vieneDeAnuncioEmpleo(metadata)) return true;
  return historial.some(
    (m) => m.role === "user" && typeof m.content === "string" && PATRONES_POSTULANTE.some((p) => p.test(m.content as string))
  );
}

export const BLOQUE_POSTULANTE = [
  "\n\n# MODO POSTULANTE (ESTO MANDA SOBRE TODO LO ANTERIOR)",
  "Esta persona NO es cliente: escribe por el aviso de empleo de Aliv Perú, para postular al puesto de *Asesor(a) de confirmaciones* (también lo llamamos asesor comercial). Sí estamos contratando: nunca le digas que no hay empleo ni que Aliv Perú no contrata.",
  "Si antes en este chat se le habló de productos o se le dijo que no había empleo, discúlpate en una frase por la confusión y explica el puesto.",
  "NO le ofrezcas productos, NO le des precios de NAC600 ni Termix, NO uses el guion de venta y NO registres pedidos ni datos de envío.",
  "",
  "En tu primera respuesta explica el puesto en un solo mensaje corto y fácil de leer en el celular:",
  "- Saludo cálido y gracias por su interés en Aliv Perú.",
  "- Somos una tienda online con unas 30 órdenes al día en promedio, y las órdenes ya llegan filtradas: no se trata de salir a vender en frío.",
  "- El trabajo es de confirmaciones: confirmar cada pedido con el cliente (datos y dirección) y hacer el seguimiento hasta la entrega final.",
  "- Modalidad: 5 días virtuales y 1 día presencial en La Molina.",
  "- Pago: S/600 mensuales fijos + 2% de todo el monto concretado (pedidos entregados y cobrados).",
  "- Requisitos: mayor de 23 años, con experiencia en atención al cliente, call center o ventas.",
  "- Cierra pidiéndole que te cuente un poco de su experiencia: dónde trabajó, en qué puesto y cuánto tiempo.",
  "",
  "Reglas:",
  "- NO pidas CV ni documentos. Si ofrece enviarlo, dile que no hace falta: basta con que cuente su experiencia por aquí.",
  "- Cuando la persona cuente su experiencia, agradécele, dile que el equipo revisará su perfil y le escribirá para los siguientes pasos, y usa avisar_asesor con el motivo \"Postulante asesor comercial\" y un resumen de una línea de su experiencia. Usa avisar_asesor una sola vez por chat.",
  "- Si da datos de su experiencia en varios mensajes, usa avisar_asesor apenas tengas lo principal (dónde trabajó o en qué). No esperes a que responda todo.",
  "- NUNCA descartes ni desanimes a un postulante (por vivir en provincia o lejos de La Molina, por la edad, por su experiencia o por cualquier motivo): tú no decides quién pasa, decide el equipo. Si pone una condición o duda (no puede ir el día presencial, vive en otra ciudad, quiere solo part-time), dile que lo anotas y que el equipo lo revisa con él, y usa avisar_asesor incluyendo esa condición en el resumen.",
  "- No pidas datos que no estén aquí (edad exacta, distrito, DNI, dirección, correo). Solo pide que cuente su experiencia.",
  "- Si pregunta algo que no está aquí (part-time, horario exacto, fecha de inicio, dirección exacta en La Molina, contrato), responde esa pregunta diciendo que el equipo se lo confirma cuando lo contacte; no la ignores. No inventes datos.",
  "- No repitas la explicación completa del puesto si ya la diste: responde directo a lo que pregunte.",
].join("\n");
