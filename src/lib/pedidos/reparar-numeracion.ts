import "server-only";
import { db } from "@/db";
import { activities, deals } from "@/db/schema";
import { and, eq, isNull, like, sql } from "drizzle-orm";
import { pedidosOrdenes } from "../../../modules/pedidos/tabla";
import { generarNumeroChat } from "./numeracion";

/**
 * Reparación única (idempotente) de la numeración compartida.
 *
 * Hasta el 19/11 las ventas cerradas por un asesor tomaban el siguiente número de la serie de
 * Shopify ("#1148"). Esta función pasa esas ventas a la serie propia "CHAT-0001" para liberar el
 * número y que el pedido real de Shopify pueda registrarse. Solo toca pedidos que:
 * - no vienen de Shopify (sin shopify_order_id),
 * - tienen un número con forma de Shopify ("#1148"),
 * - y fueron creados por el panel de venta del asesor (su nota lo dice).
 * Una vez renombrados ya no cumplen la condición, así que correrla de nuevo no hace nada.
 */
export async function repararVentasChatConNumeroShopify(): Promise<{ renombrados: Array<{ antes: string; despues: string }> }> {
  const candidatos = await db
    .select({
      id: pedidosOrdenes.id,
      numeroOrden: pedidosOrdenes.numeroOrden,
      contactId: pedidosOrdenes.contactId,
      dealId: pedidosOrdenes.dealId,
    })
    .from(pedidosOrdenes)
    .where(
      and(
        isNull(pedidosOrdenes.shopifyOrderId),
        sql`${pedidosOrdenes.numeroOrden} ~ '^#[0-9]+$'`,
        like(pedidosOrdenes.notas, "Venta confirmada por asesor humano%")
      )
    )
    .orderBy(pedidosOrdenes.createdAt);

  const renombrados: Array<{ antes: string; despues: string }> = [];
  for (const p of candidatos) {
    const antes = p.numeroOrden;
    const despues = await generarNumeroChat();
    await db
      .update(pedidosOrdenes)
      .set({ numeroOrden: despues, updatedAt: new Date() })
      .where(and(eq(pedidosOrdenes.id, p.id), eq(pedidosOrdenes.numeroOrden, antes)));

    if (p.dealId) {
      const [d] = await db.select({ title: deals.title }).from(deals).where(eq(deals.id, p.dealId)).limit(1);
      if (d?.title?.includes(antes)) {
        await db.update(deals).set({ title: d.title.split(antes).join(despues) }).where(eq(deals.id, p.dealId));
      }
    }

    if (p.contactId) {
      await db
        .insert(activities)
        .values({
          type: "note",
          description: `[NUMERACIÓN] Venta por chat renumerada de ${antes} a ${despues}: la serie "#" es solo para pedidos de Shopify.`,
          contactId: p.contactId,
          dealId: p.dealId,
        })
        .catch(() => {});
    }

    // El ERP identifica los pedidos por número: se le avisa del nuevo para que no lo confunda
    // con el pedido de Shopify que tenía el número viejo.
    if (p.dealId) {
      const { notificarCambioDealAlErp } = await import("@/lib/finanzas/notificar-erp");
      await notificarCambioDealAlErp(p.dealId).catch(() => {});
    }
    renombrados.push({ antes, despues });
  }
  return { renombrados };
}
