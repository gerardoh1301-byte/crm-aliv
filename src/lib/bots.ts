/**
 * Los tres bots del CRM (nombres decididos por Gerardo el 25/11/2026):
 * - Bot Asistente: atiende a Gerardo por WhatsApp (consultas y cambios del CRM).
 * - Bot Vendedor: atiende a los clientes en el WhatsApp de ventas.
 * - Bot Reclutador: atiende a quienes escriben por el aviso de empleo (etiqueta "postulante").
 */
export const BOT_ASISTENTE = "Bot Asistente";
export const BOT_VENDEDOR = "Bot Vendedor";
export const BOT_RECLUTADOR = "Bot Reclutador";

/** Qué bot atiende un chat de cliente según sus etiquetas. */
export function botDelChat(tags: readonly string[] | null | undefined): typeof BOT_VENDEDOR | typeof BOT_RECLUTADOR {
  return (tags ?? []).some((t) => t.trim().toLowerCase() === "postulante") ? BOT_RECLUTADOR : BOT_VENDEDOR;
}
