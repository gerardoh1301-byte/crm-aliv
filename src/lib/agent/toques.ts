/**
 * Coordinación entre el bot, el equipo y los envíos automáticos (auditoría 21/11, E6).
 * Las decisiones son puras para poder probarlas; las consultas viven en `toques-servidor.ts`.
 */

/** Minutos que el bot se calla después de que una persona escribe desde el teléfono. */
export function minutosPausaTrasHumano(): number {
  const v = Number(process.env.BOT_PAUSA_TRAS_HUMANO_MIN);
  return Number.isFinite(v) && v >= 0 ? v : 60;
}

/**
 * Si una persona del equipo escribió desde el teléfono hace poco, el bot no contesta encima:
 * espera y retoma solo si nadie respondió al cliente (lo decide el historial al reintentar).
 */
export function pausaPorHumano(
  ultimoMensajeHumano: Date | null,
  ahora: Date,
  minutos: number = minutosPausaTrasHumano()
): { pausado: false } | { pausado: true; reanudarEnMs: number } {
  if (!ultimoMensajeHumano || minutos <= 0) return { pausado: false };
  const fin = ultimoMensajeHumano.getTime() + minutos * 60_000;
  if (ahora.getTime() >= fin) return { pausado: false };
  return { pausado: true, reanudarEnMs: fin - ahora.getTime() + 60_000 };
}

/** Máximo de mensajes nuestros seguidos sin respuesta del cliente (todas las fuentes). */
export const MAX_TOQUES_SIN_RESPUESTA = 3;
/** Los mensajes más viejos que esto ya no cuentan para el tope. */
export const VENTANA_TOQUES_MS = 72 * 3_600_000;

/**
 * Un envío proactivo (seguimiento, rescate) solo sale si todavía no hay 3 mensajes nuestros
 * sin respuesta en las últimas 72 h. Antes había chats con 4 a 6 seguidos (ficha del bot,
 * ficha del equipo, «envío información adicional», seguimiento, rescate) y clientes que
 * pedían que no les escribieran más.
 */
export function puedeEnviarOtroToque(salientesSinRespuesta: number): boolean {
  return salientesSinRespuesta < MAX_TOQUES_SIN_RESPUESTA;
}
