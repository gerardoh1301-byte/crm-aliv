/**
 * Detección y verificación de solicitudes de llamada telefónica en el chat.
 *
 * Permite al bot:
 * 1. Reconocer cuando el cliente solicita ser llamado (ej. "Me llamas a las 8 mañana", "llámame").
 * 2. Verificar directamente en el historial del mismo chat si la llamada ya fue realizada
 *    (por evento de llamada en WhatsApp, mensaje posterior de un asesor humano con origin='human',
 *     o texto que evidencia la llamada como "según lo conversado").
 */

export interface EstadoLlamadaChat {
  tieneSolicitud: boolean;
  llamadaRealizada: boolean;
  detalleSolicitud?: string;
  horaSolicitada?: string;
  evidenciaRealizada?: string;
}

const REGEX_SOLICITUD_LLAMADA =
  /\b(me\s+llamas|ll[aá]ma(?:me|nos)|pueden\s+llamar(?:me|nos)?|podr[ií]an\s+llamar(?:me|nos)?|me\s+puedes\s+llamar|me\s+marcas|m[aá]rcame|una\s+llamada|llamada\s+por\s+favor|me\s+comunico\s+por\s+llamada|deseo\s+llamada)\b/i;

const REGEX_EVIDENCIA_TEXTO_LLAMADA =
  /\b(seg[uú]n lo conversado|como conversamos|conversamos por tel[eé]fono|hablamos por tel[eé]fono|te acabamos de llamar|te llam[eéó]|acabo de llamarte|conforme a la llamada|coordinamos por tel[eé]fono)\b/i;

const REGEX_EVENTO_LLAMADA =
  /\b(llamada\s+\d+|llamada\s+perdida|llamada\s+finalizada|llamada\s+entrante|llamada\s+saliente|missed call|voice call)\b/i;

export function analizarSolicitudLlamada(
  mensajes: Array<{
    direction: string;
    origin?: string | null;
    body: string | null;
    type?: string;
    createdAt?: Date | string | null;
  }>
): EstadoLlamadaChat {
  if (!mensajes || mensajes.length === 0) {
    return { tieneSolicitud: false, llamadaRealizada: false };
  }

  // Buscar el último pedido de llamada hecho por el cliente (direction === 'in')
  let indiceSolicitud = -1;
  let textoSolicitud = "";

  for (let i = 0; i < mensajes.length; i++) {
    const m = mensajes[i];
    if (m.direction === "in" && m.body && REGEX_SOLICITUD_LLAMADA.test(m.body)) {
      indiceSolicitud = i;
      textoSolicitud = m.body.trim();
    }
  }

  if (indiceSolicitud === -1) {
    return { tieneSolicitud: false, llamadaRealizada: false };
  }

  // Extraer posible horario mencionado (ej. "a las 8 mañana", "mañana a las 10")
  const horaMatch = textoSolicitud.match(/\b(?:a las|a la|mañana a las|hoy a las)\s+\d{1,2}(?::\d{2})?\s*(?:am|pm|a\.m\.|p\.m\.|de la mañana|de la tarde|mañana)?\b/i);
  const horaSolicitada = horaMatch ? horaMatch[0] : undefined;

  // Verificar si DESPUÉS de la solicitud existe evidencia de que la llamada se realizó
  let llamadaRealizada = false;
  let evidenciaRealizada = "";

  for (let i = indiceSolicitud + 1; i < mensajes.length; i++) {
    const m = mensajes[i];
    const body = m.body?.trim() ?? "";
    const type = m.type?.toLowerCase() ?? "";

    // 1. Evento nativo de llamada en WhatsApp (ej. "Llamada 1 minuto", type: "call")
    if (type.includes("call") || REGEX_EVENTO_LLAMADA.test(body)) {
      llamadaRealizada = true;
      evidenciaRealizada = `Registro de llamada en el chat ("${body || type}")`;
      break;
    }

    // 2. Intervención posterior de asesor humano (origin === 'human')
    if (m.direction === "out" && m.origin === "human") {
      llamadaRealizada = true;
      evidenciaRealizada = `Mensaje de asesor humano enviado tras la solicitud: "${body.slice(0, 60)}..."`;
      break;
    }

    // 3. Texto explícito indicando que conversaron por teléfono ("según lo conversado", etc.)
    if (REGEX_EVIDENCIA_TEXTO_LLAMADA.test(body)) {
      llamadaRealizada = true;
      evidenciaRealizada = `Mensaje que confirma la conversación telefónica: "${body.slice(0, 60)}..."`;
      break;
    }
  }

  return {
    tieneSolicitud: true,
    llamadaRealizada,
    detalleSolicitud: textoSolicitud,
    horaSolicitada,
    evidenciaRealizada: llamadaRealizada ? evidenciaRealizada : undefined,
  };
}
