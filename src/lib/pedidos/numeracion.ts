import { db } from "@/db";
import { like } from "drizzle-orm";
import { pedidosOrdenes } from "../../../modules/pedidos/tabla";
import { PREFIJO_CHAT, siguienteNumeroChat } from "./numero-formato";

export { PREFIJO_CHAT, esNumeroChat, formatearNumeroChat, siguienteNumeroChat, mostrarNumeroOrden } from "./numero-formato";

/**
 * Numeración de pedidos.
 *
 * - Shopify es dueño de la serie "#1148", "#1149"…: esos números solo los pone el webhook o
 *   la sincronización con el número real de la tienda.
 * - Toda venta que nace fuera de Shopify (asesor por chat o llamada, bot, pedido creado a mano
 *   en el CRM) usa su propia serie "CHAT-0001", "CHAT-0002"…
 *
 * Antes las dos compartían la serie numérica: una venta del asesor tomó "#1148" y, cuando llegó
 * el pedido #1148 de Shopify, el CRM lo dio por repetido y el cliente nunca recibió su mensaje.
 */
/** Próximo número libre de la serie de chat. */
export async function generarNumeroChat(): Promise<string> {
  const rows = await db
    .select({ numeroOrden: pedidosOrdenes.numeroOrden })
    .from(pedidosOrdenes)
    .where(like(pedidosOrdenes.numeroOrden, `${PREFIJO_CHAT}%`));
  return siguienteNumeroChat(rows.map((r) => r.numeroOrden));
}
