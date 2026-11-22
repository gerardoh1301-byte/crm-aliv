/**
 * Ventana de 24 h de WhatsApp: fuera de ella Meta solo entrega plantillas aprobadas y
 * rechaza el texto libre (error 131047). Puro para poder probarlo.
 *
 * Auditoría 21/11 (E4): 36 mensajes del bot salieron como texto a clientes que no escribían
 * hacía más de 24 h; Meta los rechazó y el cliente nunca los vio.
 */
export const VENTANA_WHATSAPP_MS = 24 * 3_600_000;
/** Margen para no mandar texto justo al borde de la ventana. */
const MARGEN_MS = 10 * 60_000;

export function fueraDeVentana24h(ultimoEntrante: Date | null, ahora: Date = new Date()): boolean {
  if (!ultimoEntrante) return true;
  return ahora.getTime() - ultimoEntrante.getTime() > VENTANA_WHATSAPP_MS - MARGEN_MS;
}

/** Solo WhatsApp por Meta/Zernio tiene esta regla (el simulador y otros canales no). */
export function aplicaVentana24h(channel: string, provider: string): boolean {
  return channel === "whatsapp" && provider !== "simulador";
}
