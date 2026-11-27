/**
 * Regla de confirmación real (27/11, pedido de Gerardo).
 *
 * Un pedido pasa a «Pedido confirmado (por despachar)» SOLO si hay confirmación real:
 *
 * Contra entrega (Lima o provincia con AliClik):
 *   1. El cliente dice que sí con sus propias palabras («sí», «confirmo», «sí deseo»,
 *      «correcto», «ok»…) respondiendo a una pregunta del bot sobre el pedido, la entrega
 *      o la dirección; o la llamada IA terminó «confirmado»; o una persona lo validó
 *      (orden AliClik, guía). El mensaje automático de la landing («Hola Aliv, soy X.
 *      Quiero confirmar mi pedido #…») NO cuenta: lo manda el botón, no el cliente.
 *   2. Y la dirección se puede entregar: tiene número, Mz/Lote o una agencia.
 *
 * Agencia Shalom (adelanto): solo con el adelanto verificado por una persona.
 *
 * Todo lo demás con pedido queda en «Intención de compra».
 */

export interface MensajeChat {
  direction: string; // "in" | "out"
  body: string | null;
}

export interface DatosConfirmacion {
  estado: string;
  modalidadPago: string | null;
  notas: string | null;
  direccionEnvio: string | null;
  numeroGuia?: string | null;
  /** Mensajes del chat desde que se creó el pedido, en orden cronológico. */
  mensajes: MensajeChat[];
}

export type ResultadoConfirmacion =
  | { confirmado: true; motivo: string }
  | { confirmado: false; motivo: string; rechazo?: boolean };

const RE_LANDING = /quiero confirmar mi pedido/i;

function normalizar(t: string): string {
  return t
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9ñ\s,]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function esMensajeLanding(texto: string | null | undefined): boolean {
  return RE_LANDING.test(texto ?? "");
}

export function esRechazo(texto: string | null | undefined): boolean {
  const s = normalizar(texto ?? "");
  if (!s) return false;
  if (s === "no" || s.startsWith("no gracias")) return true;
  return /\b(ya no|no (lo |la )?(deseo|quiero|voy)|cancel\w*|no me interesa|no por ahora|me estafaron|ya me estafaron)\b/.test(s);
}

export function esAfirmacion(texto: string | null | undefined): boolean {
  const original = texto ?? "";
  if (!original.trim() || esMensajeLanding(original) || esRechazo(original)) return false;
  const s = normalizar(original);
  if (/^(si+|sip|sii+|claro|ok+|okey|oki|okay|dale|correcto|confirmo|confirmado|de acuerdo|listo|perfecto|esta bien|asi es|exacto|afirmativo|conforme)\b/.test(s)) {
    return true;
  }
  return /\b(confirmo|si deseo|aun (lo )?deseo|si quiero|si lo quiero|lo espero|si,? esta correcto|si,? correcto)\b/.test(s);
}

/** El mensaje del bot que antecede pregunta por el pedido, la entrega o la dirección. */
export function esPreguntaDeConfirmacion(texto: string | null | undefined): boolean {
  const t = texto ?? "";
  return t.includes("?") && /(confirm|agend|pedido|entrega|env[ií]o|direcci[oó]n|frasco|tobiller|s\/\s?\d)/i.test(t);
}

export function direccionEntregable(direccion: string | null | undefined): boolean {
  const d = direccion ?? "";
  return /\d/.test(d) || /\b(mz|mza|manzana|lote|lt|agencia|shalom)\b/i.test(d);
}

export function esPedidoAgencia(d: Pick<DatosConfirmacion, "modalidadPago" | "notas">): boolean {
  return d.modalidadPago === "adelanto_agencia" || /\[ENTREGA_WEB:AG\|/.test(d.notas ?? "");
}

/** Respuesta del cliente que confirma, o null. Recorre el chat buscando un «sí» tras una pregunta del bot. */
export function confirmacionEnChat(mensajes: MensajeChat[]): string | null {
  let ultimaPreguntaBot: string | null = null;
  for (const m of mensajes) {
    if (m.direction === "out") {
      ultimaPreguntaBot = esPreguntaDeConfirmacion(m.body) ? m.body : null;
      continue;
    }
    if (m.direction === "in" && ultimaPreguntaBot && esAfirmacion(m.body)) return (m.body ?? "").trim();
  }
  return null;
}

export function ultimoRechazo(mensajes: MensajeChat[]): string | null {
  const entrantes = mensajes.filter((m) => m.direction === "in" && (m.body ?? "").trim());
  const ultimo = entrantes[entrantes.length - 1];
  return ultimo && esRechazo(ultimo.body) ? (ultimo.body ?? "").trim() : null;
}

export function evaluarConfirmacion(d: DatosConfirmacion): ResultadoConfirmacion {
  const notas = d.notas ?? "";
  if (d.numeroGuia || /\[ALICLIK_ORDEN:/i.test(notas)) {
    return { confirmado: true, motivo: "ya registrado (guía u orden AliClik)" };
  }

  const rechazo = ultimoRechazo(d.mensajes);
  if (rechazo) return { confirmado: false, motivo: `el cliente dijo «${rechazo.slice(0, 60)}»`, rechazo: true };

  if (esPedidoAgencia(d)) {
    return notas.includes("[ADELANTO VERIFICADO]")
      ? { confirmado: true, motivo: "adelanto verificado" }
      : { confirmado: false, motivo: "agencia Shalom sin adelanto verificado" };
  }

  const porLlamada = /\[LLAMADA_IA_RESULTADO\][^\n]*estado=confirmado/.test(notas);
  const respuesta = porLlamada ? null : confirmacionEnChat(d.mensajes);
  if (!porLlamada && !respuesta) {
    return { confirmado: false, motivo: "el cliente aún no confirmó (el mensaje automático de la landing no cuenta)" };
  }
  if (!direccionEntregable(d.direccionEnvio)) {
    return { confirmado: false, motivo: "confirmó, pero falta la dirección exacta (número, Mz/Lote o agencia)" };
  }
  return {
    confirmado: true,
    motivo: porLlamada ? "confirmado en la llamada IA" : `el cliente respondió «${respuesta!.slice(0, 60)}»`,
  };
}
