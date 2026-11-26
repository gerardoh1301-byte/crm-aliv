import "server-only";
import { db } from "@/db";
import { activities, contacts } from "@/db/schema";
import { and, desc, eq, gte, inArray } from "drizzle-orm";
import { pedidosOrdenes } from "../../../modules/pedidos/tabla";
import { AliclikMcpClient, type AliclikOrderItem } from "./mcp-client";
import {
  decidirEntregaAliclik,
  elegirOrdenAliclik,
  enCaminoAliclik,
  mismoCelular,
  type DecisionAliclik,
  type OrdenMin,
} from "./sync-reglas";

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
const MARCA_EN_CAMINO = "[ALICLIK_EN_CAMINO]";

export interface ResultadoSyncAliclik {
  activo: boolean;
  revisados: number;
  entregados: number;
  enCamino: number;
  diagnostico?: { listados: number; desde: string; hasta: string; respuestaLista: string; formatoFecha: string; formatoCelular: string };
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

/** Fecha de AliClik en ISO o dd/mm/aaaa; si no se entiende, no descarta el pedido. */
function fechaAliclik(t: string | null | undefined): number | null {
  const v = String(t ?? "").trim();
  if (!v) return null;
  const dmy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(v);
  if (dmy) return Date.UTC(Number(dmy[3]), Number(dmy[2]) - 1, Number(dmy[1]));
  const ms = Date.parse(v);
  return Number.isNaN(ms) ? null : ms;
}

/** El pedido de AliClik se crea después del pedido del CRM (margen de 3 días). */
function fechaCompatible(fechaOrden: string | null | undefined, creadoCrm: Date | null): boolean {
  const ms = fechaAliclik(fechaOrden);
  if (ms === null || !creadoCrm) return true;
  return ms >= creadoCrm.getTime() - 3 * 86_400_000;
}

function fechaISO(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function sincronizarEntregasAliclik(opts: { limite?: number } = {}): Promise<ResultadoSyncAliclik> {
  const activo = syncEntregasActivo();
  const res: ResultadoSyncAliclik = { activo, revisados: 0, entregados: 0, enCamino: 0, detalles: [] };
  const cliente = new AliclikMcpClient();

  // AliClik reparte contra entrega en Lima (ALIDRIVER) y en provincia, y lleva paquetes a
  // Shalom. En el CRM muchos de esos pedidos no dicen "AliClik" (figuran como motorizado o
  // sin transportadora), así que se cruzan TODOS los pedidos abiertos de los últimos 30
  // días con los de AliClik por número guardado o por celular + total.
  const desde = new Date(Date.now() - 30 * 86_400_000);
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
    .where(
      and(
        inArray(pedidosOrdenes.estado, ["por_confirmar_cod", "confirmado", "enviado"]),
        gte(pedidosOrdenes.createdAt, desde)
      )
    )
    .orderBy(desc(pedidosOrdenes.createdAt))
    .limit(300);

  const candidatos = pedidos.filter((p) => !(p.notas ?? "").includes(MARCA_ENTREGA)).slice(0, opts.limite ?? 150);
  if (!candidatos.length) return res;

  // Una sola consulta (paginada) de los pedidos de AliClik del periodo.
  const ordenesAliclik: AliclikOrderItem[] = [];
  const desdeAliclik = fechaISO(new Date(desde.getTime() - 5 * 86_400_000));
  const hasta = fechaISO(new Date(Date.now() + 86_400_000));
  let respuestaLista = "";
  for (let page = 1; page <= 5; page++) {
    const r = await cliente.searchOrders({ from: desdeAliclik, to: hasta, page, pageSize: 50 });
    if (page === 1) respuestaLista = typeof r === "string" ? String(r).slice(0, 200) : `total=${r?.total ?? "?"} items=${r?.items?.length ?? "?"}`;
    ordenesAliclik.push(...(r.items ?? []));
    if (!r.items?.length || ordenesAliclik.length >= (r.total ?? 0)) break;
  }
  const muestra = ordenesAliclik[0];
  res.diagnostico = {
    listados: ordenesAliclik.length,
    desde: desdeAliclik,
    hasta,
    respuestaLista,
    // Formato (dígitos enmascarados) para revisar el cruce sin exponer datos del cliente.
    formatoFecha: String(muestra?.createdAt ?? "").replace(/\d/g, "9"),
    formatoCelular: String(muestra?.customerPhone ?? "").replace(/\d/g, "9"),
  };
  const busquedaPorCelular = ordenesAliclik.length === 0;
  const porNumero = new Map(ordenesAliclik.map((o) => [o.orderNumber, o]));
  const celular9 = (t: string | null | undefined) => String(t ?? "").replace(/\D/g, "").slice(-9);
  const usados = new Set<string>();

  for (const p of candidatos) {
    try {
      let numeroAliclik = MARCA_ORDEN.exec(p.notas ?? "")?.[1]?.trim() ?? null;
      let orden: OrdenMin | null = null;

      if (numeroAliclik) {
        orden = porNumero.get(numeroAliclik) ?? (await cliente.getOrder(numeroAliclik));
      } else {
        const cel = celular9(p.phone);
        if (cel.length !== 9) continue;
        if (busquedaPorCelular) {
          const r = await cliente.searchOrders({ from: fechaISO(new Date((p.createdAt ?? new Date()).getTime() - 3 * 86_400_000)), to: hasta, phone: cel, pageSize: 20 });
          for (const o of r.items ?? []) if (!porNumero.has(o.orderNumber)) { porNumero.set(o.orderNumber, o); ordenesAliclik.push(o); }
        }
        const delCliente = ordenesAliclik.filter(
          (o) =>
            !usados.has(o.orderNumber) &&
            mismoCelular(o.customerPhone, cel) &&
            // El pedido de AliClik se crea después del pedido del CRM (margen de 3 días).
            fechaCompatible(o.createdAt, p.createdAt)
        );
        orden = elegirOrdenAliclik(delCliente, Number(p.total) || 0);
        numeroAliclik = orden?.orderNumber ?? null;
      }
      // Pedido que no pasó por AliClik (Shalom directo, motorizado propio): no se informa.
      if (!orden || !numeroAliclik) continue;
      usados.add(numeroAliclik);
      res.revisados++;

      let decision = decidirEntregaAliclik(orden);
      // Contra entrega por entregar: si ya es su fecha programada, está en reparto. La fecha
      // solo viene en el detalle; se pide solo para estos (pocos por corrida).
      if (
        decision.accion === "sin_cambios" &&
        p.estado !== "enviado" &&
        orden.deliveryType === "CASH_ON_DELIVERY" &&
        orden.deliveryStatus === "PENDING_DELIVERY"
      ) {
        if (orden.scheduledDate === undefined) {
          const det = await cliente.getOrder(numeroAliclik).catch(() => null);
          orden = { ...orden, scheduledDate: det?.shipping?.scheduledDate ?? null };
        }
        if (enCaminoAliclik(orden)) {
          decision = { accion: "marcar_en_camino", motivo: `por entregar con fecha programada ${String(orden.scheduledDate).slice(0, 10)}` };
        }
      }
      res.detalles.push({
        numeroOrden: p.numeroOrden,
        ordenAliclik: numeroAliclik,
        tipo: orden.deliveryType ?? null,
        estadoEntrega: `${orden.deliveryStatus}${orden.deliveryStatusLabel ? ` (${orden.deliveryStatusLabel})` : ""}`,
        estadoSeguimiento: orden.trackingStatusLabel || orden.trackingStatus || null,
        accion: decision.accion,
        motivo: decision.motivo,
      });

      if (!activo) continue;

      // Guardar el número de AliClik encontrado por celular (para no volver a cruzarlo).
      if (!MARCA_ORDEN.test(p.notas ?? "")) {
        p.notas = `${p.notas ? `${p.notas}\n` : ""}[ALICLIK_ORDEN:${numeroAliclik}]`;
        await db.update(pedidosOrdenes).set({ notas: p.notas, updatedAt: new Date() }).where(eq(pedidosOrdenes.id, p.id));
      }

      if (decision.accion === "marcar_entregado") {
        await marcarEntregadoPorAliclik(p, numeroAliclik, decision.motivo);
        res.entregados++;
      } else if (decision.accion === "marcar_en_camino") {
        await marcarEnCaminoPorAliclik(p, numeroAliclik, decision.motivo);
        res.enCamino++;
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

/** Contra entrega en reparto según AliClik: pedido «enviado» y tarjeta en «Orden en camino». */
async function marcarEnCaminoPorAliclik(
  p: { id: string; numeroOrden: string; contactId: string | null; dealId: string | null; notas: string | null; total: string | null; items: unknown },
  numeroAliclik: string,
  motivo: string
): Promise<void> {
  const { sincronizarEtapaPipeline } = await import("@modules/pedidos/servidor");
  const ahora = new Date();
  p.notas = `${p.notas ? `${p.notas}\n` : ""}${MARCA_EN_CAMINO} ${ahora.toISOString().slice(0, 10)}`;
  await db
    .update(pedidosOrdenes)
    .set({ estado: "enviado", notas: p.notas, updatedAt: ahora })
    .where(eq(pedidosOrdenes.id, p.id));
  const items = Array.isArray(p.items) ? (p.items as Array<{ titulo?: string }>) : [];
  const total = Number(p.total) || 0;
  if (p.contactId) {
    await sincronizarEtapaPipeline(p.contactId, "enviado", `${p.numeroOrden} · ${items[0]?.titulo ?? "Pedido Aliv"}`, total, p.id, p.dealId);
    await db.insert(activities).values({
      type: "note",
      description: `[ALICLIK] ${p.numeroOrden} en camino según AliClik (${numeroAliclik}: ${motivo}).`,
      contactId: p.contactId,
      dealId: p.dealId,
    });
  }
  if (p.dealId) {
    const { notificarCambioDealAlErp } = await import("@/lib/finanzas/notificar-erp");
    notificarCambioDealAlErp(p.dealId).catch(() => {});
  }
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

  const { notificarSupervisoresCritico } = await import("@/lib/alerts/supervisor-alerts");
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
  }).catch((err) => console.warn("[aliclik-sync] aviso:", err));
}

