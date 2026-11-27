import "server-only";
import { and, asc, eq, gte, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { activities, contacts, deals, messages, pipelineStages, pipelines } from "@/db/schema";
import { setDealStage } from "@/lib/deals/stage";
import { pedidosOrdenes } from "../../../modules/pedidos/tabla";
import { evaluarConfirmacion, type MensajeChat, type ResultadoConfirmacion } from "./confirmacion";

export const MARCA_CONFIRMACION_REAL = "[CONFIRMACION_REAL]";

type Pedido = typeof pedidosOrdenes.$inferSelect;

/** Mensajes del cliente (todas sus fichas con el mismo teléfono) desde que se creó el pedido. */
export async function mensajesDelPedido(p: Pick<Pedido, "contactId" | "createdAt" | "numeroOrden">): Promise<MensajeChat[]> {
  if (!p.contactId) return [];
  const [c] = await db.select({ phone: contacts.phone }).from(contacts).where(eq(contacts.id, p.contactId)).limit(1);
  const ids = c?.phone
    ? (await db.select({ id: contacts.id }).from(contacts).where(eq(contacts.phone, c.phone))).map((r) => r.id)
    : [p.contactId];
  // Los pedidos del chat (CHAT-) se registran después de que el cliente dijo que sí.
  const margen = /^#?CHAT-/i.test(p.numeroOrden) ? 2 * 86_400_000 : 0;
  const desde = new Date(new Date(p.createdAt).getTime() - margen);
  return db
    .select({ direction: messages.direction, body: messages.body })
    .from(messages)
    .where(and(inArray(messages.contactId, ids), gte(messages.createdAt, desde)))
    .orderBy(asc(messages.createdAt));
}

export async function evaluarPedido(p: Pedido): Promise<ResultadoConfirmacion> {
  return evaluarConfirmacion({
    estado: p.estado,
    modalidadPago: p.modalidadPago,
    notas: p.notas,
    direccionEnvio: p.direccionEnvio,
    numeroGuia: p.numeroGuia,
    mensajes: await mensajesDelPedido(p),
  });
}

async function etapaId(clave: string): Promise<string | null> {
  const [s] = await db
    .select({ id: pipelineStages.id })
    .from(pipelineStages)
    .innerJoin(pipelines, eq(pipelines.id, pipelineStages.pipelineId))
    .where(and(eq(pipelines.isDefault, true), eq(pipelineStages.key, clave)))
    .limit(1);
  return s?.id ?? null;
}

/** Pasa el pedido a «Pedido confirmado (por despachar)» y deja la constancia del motivo. */
export async function marcarConfirmado(p: Pedido, motivo: string): Promise<void> {
  const nota = `${MARCA_CONFIRMACION_REAL} ${new Date().toISOString()} ${motivo}`;
  await db
    .update(pedidosOrdenes)
    .set({ estado: "confirmado", notas: [p.notas, nota].filter(Boolean).join("\n"), updatedAt: new Date() })
    .where(eq(pedidosOrdenes.id, p.id));
  const destino = await etapaId("agendar_entrega");
  if (p.dealId && destino) await setDealStage({ dealId: p.dealId, stageId: destino });
  await db.insert(activities).values({
    type: "note",
    description: `✅ Pedido ${p.numeroOrden} confirmado de verdad: ${motivo}. Pasa a «Pedido confirmado (por despachar)».`,
    contactId: p.contactId,
  });
}

/**
 * Barrido: revisa los pedidos «por confirmar» de los últimos 30 días.
 * - Con confirmación real → «Pedido confirmado (por despachar)».
 * - Sin ella, si la tarjeta quedó en «Pedido confirmado» → vuelve a «Intención de compra».
 */
export async function procesarConfirmaciones(): Promise<{ revisados: number; confirmados: string[]; devueltos: string[] }> {
  const pendientes = await db
    .select()
    .from(pedidosOrdenes)
    .where(
      and(eq(pedidosOrdenes.estado, "por_confirmar_cod"), sql`${pedidosOrdenes.createdAt} > now() - interval '30 days'`)
    );
  const intencion = await etapaId("carrito_armado");
  const confirmados: string[] = [];
  const devueltos: string[] = [];

  for (const p of pendientes) {
    const r = await evaluarPedido(p);
    if (r.confirmado) {
      await marcarConfirmado(p, r.motivo);
      confirmados.push(p.numeroOrden);
      continue;
    }
    if (!p.dealId || !intencion) continue;
    const [d] = await db
      .select({ key: pipelineStages.key })
      .from(deals)
      .innerJoin(pipelineStages, eq(pipelineStages.id, deals.stageId))
      .where(eq(deals.id, p.dealId))
      .limit(1);
    if (d?.key === "agendar_entrega" || d?.key === "formulario_abandonado") {
      await setDealStage({ dealId: p.dealId, stageId: intencion });
      devueltos.push(p.numeroOrden);
    }
  }
  return { revisados: pendientes.length, confirmados, devueltos };
}
