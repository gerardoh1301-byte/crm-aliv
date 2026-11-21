import "server-only";
import { db } from "@/db";
import { activities, contacts, conversations } from "@/db/schema";
import { eq } from "drizzle-orm";
import { pedidosOrdenes } from "@modules/pedidos/tabla";
import { MARCA_ADELANTO_VERIFICADO } from "@/lib/pedidos/adelanto";
import { notificarCambioDealAlErp } from "@/lib/finanzas/notificar-erp";

type FilaPedido = typeof pedidosOrdenes.$inferSelect;

/**
 * Una PERSONA confirma que verificó el Yape de S/20 del adelanto (botón «Adelanto confirmado»
 * del CRM o la orden «adelanto 1153» de Gerardo por WhatsApp): queda registrado quién y cuándo,
 * el pedido pasa a «confirmado» (pipeline), se cierra la alerta «requiere humano» y el ERP
 * registra el ingreso. Idempotente: si ya estaba verificado no duplica la marca.
 * El bot nunca llama a esto por su cuenta.
 */
export async function confirmarAdelantoPedido(
  pedido: FilaPedido,
  quien: string
): Promise<{ pedido: FilaPedido; yaEstaba: boolean }> {
  const ahora = new Date();
  const hora = ahora.toLocaleString("es-PE", { timeZone: "America/Lima", dateStyle: "short", timeStyle: "short" });
  const yaEstaba = (pedido.notas ?? "").includes(MARCA_ADELANTO_VERIFICADO);
  const marca = `${MARCA_ADELANTO_VERIFICADO} S/20 verificado por ${quien} el ${hora}.`;

  const nuevoEstado = pedido.estado === "por_confirmar_cod" ? "confirmado" : pedido.estado;
  const [actualizado] = await db
    .update(pedidosOrdenes)
    .set({
      estado: nuevoEstado,
      modalidadPago: "adelanto_agencia",
      notas: yaEstaba ? pedido.notas : [pedido.notas, marca].filter(Boolean).join("\n"),
      updatedAt: ahora,
    })
    .where(eq(pedidosOrdenes.id, pedido.id))
    .returning();

  if (nuevoEstado !== pedido.estado) {
    const { sincronizarEtapaPipeline } = await import("@modules/pedidos/servidor");
    const primerProducto = (actualizado.items as Array<{ titulo?: string }>)?.[0]?.titulo || "Pedido Aliv";
    await sincronizarEtapaPipeline(
      actualizado.contactId,
      "confirmado",
      `${actualizado.numeroOrden} · ${primerProducto}`,
      Number(actualizado.total) || 0,
      actualizado.id,
      actualizado.dealId
    );
  }

  if (!yaEstaba) {
    await db.insert(activities).values({
      type: "note",
      description: `${marca} Pedido ${actualizado.numeroOrden}. Siguiente paso: registrar el envío en Shalom Pro y enviar el seguimiento al cliente.`,
      contactId: actualizado.contactId,
      dealId: actualizado.dealId,
    });
  }

  // La alerta "requiere humano" ya fue atendida. El bot sigue como estaba (no se toca aiEnabled).
  if (actualizado.contactId) {
    await db
      .update(conversations)
      .set({ needsHuman: false, needsHumanReason: null, needsHumanAt: null, updatedAt: ahora })
      .where(eq(conversations.contactId, actualizado.contactId));
    await db
      .update(contacts)
      .set({ needsHuman: false, needsHumanReason: null, needsHumanAt: null, updatedAt: ahora })
      .where(eq(contacts.id, actualizado.contactId));
  }

  // El ERP registra el ingreso de S/ 20 en BCP al instante
  if (actualizado.dealId) notificarCambioDealAlErp(actualizado.dealId).catch(() => {});

  return { pedido: actualizado, yaEstaba };
}
