import "server-only";
import { db } from "@/db";
import { activities, contacts } from "@/db/schema";
import { desc, eq, inArray } from "drizzle-orm";
import { pedidosOrdenes } from "../../../modules/pedidos/tabla";
import { AliclikMcpClient } from "./mcp-client";
import { decidirEntregaAliclik, elegirOrdenAliclik, type DecisionAliclik, type OrdenMin } from "./sync-reglas";

/**
 * Sincroniza los pedidos que lleva AliClik con su API de pedidos (MCP).
 *
 * - Contra entrega: si AliClik dice «entregado», el pedido pasa a Entregado en el CRM
 *   (pedido, pipeline, posventa) con la liquidación PENDIENTE: la valida una persona con
 *   el botón «Liquidar AliClik». Se avisa a Gerardo por WhatsApp.
 * - Pedidos de agencia (AliClik lleva el paquete a Shalom): solo se informa el estado;
 *   el seguimiento lo hace el chequeo de Shalom con la guía.
 *
 * Sin ALICLIK_SYNC_ENTREGAS=on no cambia nada: devuelve lo que haría (modo prueba),
 * para revisar con pedidos reales qué estados devuelve AliClik antes de activarlo.
 */

const MARCA_ORDEN = /\[ALICLIK_ORDEN:([^\]]+)\]/i;
const MARCA_ENTREGA = "[ALICLIK_ENTREGADO]";

export interface ResultadoSyncAliclik {
  activo: boolean;
  revisados: number;
  entregados: number;
  detalles: Array<{
    numeroOrden: string;
    ordenAliclik: string | null;
    tipo: string | null;
    estadoEntrega: string | null;
    estadoSeguimiento: string | null;
    accion: DecisionAliclik["accion"] | "error";
    motivo: string;
  }>;
}

export function syncEntregasActivo(): boolean {
  return (process.env.ALICLIK_SYNC_ENTREGAS ?? "").toLowerCase() === "on";
}

function fechaISO(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function sincronizarEntregasAliclik(opts: { limite?: number } = {}): Promise<ResultadoSyncAliclik> {
  const activo = syncEntregasActivo();
  const res: ResultadoSyncAliclik = { activo, revisados: 0, entregados: 0, detalles: [] };
  const cliente = new AliclikMcpClient();

  const pedidos = await db
    .select({
      id: pedidosOrdenes.id,
      numeroOrden: pedidosOrdenes.numeroOrden,
      contactId: pedidosOrdenes.contactId,
      dealId: pedidosOrdenes.dealId,
      estado: pedidosOrdenes.estado,
      transportadora: pedidosOrdenes.transportadora,
      notas: pedidosOrdenes.notas,
      total: pedidosOrdenes.total,
      items: pedidosOrdenes.items,
      createdAt: pedidosOrdenes.createdAt,
      phone: contacts.phone,
    })
    .from(pedidosOrdenes)
    .leftJoin(contacts, eq(contacts.id, pedidosOrdenes.contactId))
    .where(inArray(pedidosOrdenes.estado, ["confirmado", "enviado"]))
    .orderBy(desc(pedidosOrdenes.createdAt))
    .limit(200);

  const candidatos = pedidos
    .filter((p) => /aliclik/i.test(p.transportadora ?? "") || MARCA_ORDEN.test(p.notas ?? ""))
    .filter((p) => !(p.notas ?? "").includes(MARCA_ENTREGA))
    .slice(0, opts.limite ?? 30);

  for (const p of candidatos) {
    res.revisados++;
    try {
      let numeroAliclik = MARCA_ORDEN.exec(p.notas ?? "")?.[1]?.trim() ?? null;
      let orden: OrdenMin | null = null;

      if (numeroAliclik) {
        orden = await cliente.getOrder(numeroAliclik);
      } else {
        // Sin número guardado: se busca por celular desde 3 días antes del pedido.
        const celular = String(p.phone ?? "").replace(/\D/g, "").slice(-9);
        if (celular.length === 9) {
          const desde = new Date((p.createdAt ?? new Date()).getTime() - 3 * 86_400_000);
          const r = await cliente.searchOrders({ from: fechaISO(desde), to: fechaISO(new Date(Date.now() + 86_400_000)), phone: celular, pageSize: 20 });
          orden = elegirOrdenAliclik(r.items ?? [], Number(p.total) || 0);
          numeroAliclik = orden?.orderNumber ?? null;
        }
      }

      const decision = decidirEntregaAliclik(orden);
      res.detalles.push({
        numeroOrden: p.numeroOrden,
        ordenAliclik: numeroAliclik,
        tipo: orden?.deliveryType ?? null,
        estadoEntrega: orden ? `${orden.deliveryStatus}${orden.deliveryStatusLabel ? ` (${orden.deliveryStatusLabel})` : ""}` : null,
        estadoSeguimiento: orden?.trackingStatusLabel || orden?.trackingStatus || null,
        accion: decision.accion,
        motivo: decision.motivo,
      });

      if (!activo) continue;

      // Guardar el número de AliClik si se encontró por celular (para no volver a buscar).
      if (numeroAliclik && !MARCA_ORDEN.test(p.notas ?? "")) {
        p.notas = `${p.notas ? `${p.notas}\n` : ""}[ALICLIK_ORDEN:${numeroAliclik}]`;
        await db.update(pedidosOrdenes).set({ notas: p.notas, updatedAt: new Date() }).where(eq(pedidosOrdenes.id, p.id));
      }

      if (decision.accion === "marcar_entregado") {
        await marcarEntregadoPorAliclik(p, numeroAliclik!, decision.motivo);
        res.entregados++;
      }
    } catch (err) {
      res.detalles.push({
        numeroOrden: p.numeroOrden,
        ordenAliclik: null,
        tipo: null,
        estadoEntrega: null,
        estadoSeguimiento: null,
        accion: "error",
        motivo: err instanceof Error ? err.message.slice(0, 200) : String(err),
      });
    }
  }
  return res;
}

async function marcarEntregadoPorAliclik(
  p: {
    id: string;
    numeroOrden: string;
    contactId: string | null;
    dealId: string | null;
    notas: string | null;
    total: string | null;
    items: unknown;
    phone: string | null;
  },
  numeroAliclik: string,
  motivo: string
): Promise<void> {
  const { sincronizarEtapaPipeline } = await import("@modules/pedidos/servidor");
  const { crearOActualizarDealPostventa } = await import("@/lib/postventa/engine");
  const ahora = new Date();
  await db
    .update(pedidosOrdenes)
    .set({
      estado: "entregado",
      notas: `${p.notas ? `${p.notas}\n` : ""}${MARCA_ENTREGA} ${ahora.toISOString().slice(0, 10)} · liquidación pendiente`,
      updatedAt: ahora,
    })
    .where(eq(pedidosOrdenes.id, p.id));

  const items = Array.isArray(p.items) ? (p.items as Array<{ titulo?: string }>) : [];
  const producto = items[0]?.titulo ?? "Pedido Aliv";
  const total = Number(p.total) || 0;
  if (p.contactId) {
    await sincronizarEtapaPipeline(p.contactId, "entregado", `${p.numeroOrden} · ${producto}`, total, p.id, p.dealId);
    await crearOActualizarDealPostventa(p.contactId, p.numeroOrden, total).catch((err) =>
      console.warn("[aliclik-sync] posventa:", err)
    );
    await db.insert(activities).values({
      type: "note",
      description: `[ALICLIK] ${p.numeroOrden} entregado según AliClik (${numeroAliclik}: ${motivo}). Liquidación pendiente: valídala con «Liquidar AliClik».`,
      contactId: p.contactId,
      dealId: p.dealId,
    });
  }
  if (p.dealId) {
    const { notificarCambioDealAlErp } = await import("@/lib/finanzas/notificar-erp");
    notificarCambioDealAlErp(p.dealId).catch(() => {});
  }

  const { notificarSupervisoresCritico, SUPERVISOR_PAGOS } = await import("@/lib/alerts/supervisor-alerts");
  const [c] = p.contactId
    ? await db.select({ name: contacts.name }).from(contacts).where(eq(contacts.id, p.contactId)).limit(1)
    : [];
  await notificarSupervisoresCritico({
    tipo: "aliclik_entregado",
    titulo: `Entregado por AliClik ${p.numeroOrden}`,
    detalle: `AliClik marcó ${numeroAliclik} como entregado (S/ ${total.toFixed(2)}). El pedido pasó a Entregado; falta validar la liquidación con «Liquidar AliClik».`,
    clienteNombre: c?.name ?? null,
    clienteTelefono: p.phone,
    contactId: p.contactId,
    soloA: [SUPERVISOR_PAGOS],
  }).catch((err) => console.warn("[aliclik-sync] aviso:", err));
}

