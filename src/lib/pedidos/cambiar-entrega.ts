import "server-only";
import { db } from "@/db";
import { activities, contacts } from "@/db/schema";
import { eq } from "drizzle-orm";
import { pedidosOrdenes } from "../../../modules/pedidos/tabla";
import { planCambioEntrega, type DestinoEntrega } from "./cambiar-entrega-reglas";

/** Cambia el pedido a contra entrega AliClik o agencia Shalom (menú ⋯ de la tarjeta, 26/11). */
export async function cambiarTipoEntrega(
  pedidoId: string,
  destino: DestinoEntrega,
  autor: string,
  confirmado = false
): Promise<{ ok: true; mensaje: string } | { ok: false; error: string; confirmar?: boolean }> {
  const [p] = await db.select().from(pedidosOrdenes).where(eq(pedidosOrdenes.id, pedidoId)).limit(1);
  if (!p) return { ok: false, error: "No encontré el pedido." };

  const r = planCambioEntrega(p, destino, { confirmado });
  if (!r.ok) return r;
  const { plan } = r;

  await db
    .update(pedidosOrdenes)
    .set({
      transportadora: plan.transportadora,
      modalidadPago: plan.modalidadPago,
      notas: plan.notas,
      ...(plan.limpiarGuia ? { numeroGuia: null, codigoRastreo: null, claveRecojo: null } : {}),
      updatedAt: new Date(),
    })
    .where(eq(pedidosOrdenes.id, p.id));

  // El bot lee modalidad_entrega del contacto: sin esto seguiría ofreciendo la entrega anterior.
  const [ct] = await db.select({ cf: contacts.customFields }).from(contacts).where(eq(contacts.id, p.contactId)).limit(1);
  const cf = (ct?.cf && typeof ct.cf === "object" ? ct.cf : {}) as Record<string, unknown>;
  await db
    .update(contacts)
    .set({ customFields: { ...cf, modalidad_entrega: plan.modalidadEntrega } })
    .where(eq(contacts.id, p.contactId));

  await db.insert(activities).values({
    type: "note",
    description: `[ENTREGA] ${p.numeroOrden} ${plan.resumen} por ${autor}.`,
    contactId: p.contactId,
    dealId: p.dealId,
  });
  if (p.dealId) {
    const { notificarCambioDealAlErp } = await import("@/lib/finanzas/notificar-erp");
    notificarCambioDealAlErp(p.dealId).catch(() => {});
  }
  return {
    ok: true,
    mensaje:
      destino === "shalom"
        ? `${p.numeroOrden} ahora va por agencia Shalom (adelanto S/20).`
        : `${p.numeroOrden} ahora es contra entrega AliClik. Regístralo en AliClik.`,
  };
}
