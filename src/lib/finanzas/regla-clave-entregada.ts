import "server-only";
import { db } from "@/db";
import { deals } from "@/db/schema";
import { eq } from "drizzle-orm";
import { pedidosOrdenes } from "@modules/pedidos/tabla";
import {
  extraerFinanzasShalom,
  OP_CLAVE_ENTREGADA,
  reemplazarTag,
  saldoPorClaveEntregada,
} from "@/lib/finanzas/tags-shalom";
import { fechaLimaHoy, registrarFinanzasShalom } from "@/lib/finanzas/registrar-shalom";

function esPedidoShalom(modalidad: string | null | undefined, notas: string): boolean {
  return modalidad === "adelanto_agencia" || /shalom/i.test(notas);
}

/**
 * Al pasar una tarjeta Shalom a "Entregado y Cobrado" se registra el saldo como cobrado ese día
 * (si nadie lo registró antes). Si la tarjeta sale de esa etapa, se quita el saldo que puso esta regla.
 */
export async function aplicarReglaClaveEntregada(dealId: string, entregado: boolean): Promise<void> {
  const [pedido] = await db.select().from(pedidosOrdenes).where(eq(pedidosOrdenes.dealId, dealId)).limit(1);
  const [deal] = await db.select().from(deals).where(eq(deals.id, dealId)).limit(1);
  if (!deal) return;
  const notas = [pedido?.notas, deal.notes].filter(Boolean).join("\n");
  if (!esPedidoShalom(pedido?.modalidadPago, notas)) return;
  const finanzas = extraerFinanzasShalom(notas);

  if (entregado) {
    if (finanzas?.saldoMonto !== null && finanzas?.saldoMonto !== undefined) return;
    const total = Number(pedido?.total ?? 0) || (deal.value && deal.value < 500 ? deal.value : (deal.value || 0) / 100);
    const saldo = saldoPorClaveEntregada(total, finanzas);
    if (saldo <= 0) return;
    await registrarFinanzasShalom(
      { dealId, pedidoId: pedido?.id, saldoMonto: saldo, saldoOp: OP_CLAVE_ENTREGADA, saldoFecha: fechaLimaHoy(), saldoCuenta: "BCP" },
      "Regla clave entregada"
    );
    return;
  }

  if (finanzas?.saldoOp !== OP_CLAVE_ENTREGADA) return;
  if (pedido) {
    await db.update(pedidosOrdenes)
      .set({ notas: reemplazarTag(pedido.notas, "SALDO_COBRADO", null), updatedAt: new Date() })
      .where(eq(pedidosOrdenes.id, pedido.id));
  }
  await db.update(deals)
    .set({ notes: reemplazarTag(deal.notes, "SALDO_COBRADO", null), updatedAt: new Date() })
    .where(eq(deals.id, deal.id));
}
