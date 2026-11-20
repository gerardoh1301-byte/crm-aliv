import "server-only";
import { db } from "@/db";
import { activities, deals } from "@/db/schema";
import { eq } from "drizzle-orm";
import { pedidosOrdenes } from "@modules/pedidos/tabla";
import {
  construirTag,
  extraerFinanzasShalom,
  reemplazarTag,
  type FinanzasShalom,
} from "@/lib/finanzas/tags-shalom";

const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;
const CUENTAS = new Set(["BCP", "ALICLIK", "EFECTIVO"]);

export function fechaLimaHoy(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Lima" }).format(new Date());
}

function fecha(v: unknown): string {
  return typeof v === "string" && FECHA_RE.test(v) ? v : fechaLimaHoy();
}

function cuenta(v: unknown): string {
  const c = String(v || "BCP").toUpperCase();
  return CUENTAS.has(c) ? c : "BCP";
}

export interface DatosFinanzasShalom {
  dealId?: string | null;
  pedidoId?: string | null;
  numeroOrden?: string | null;
  fleteShalom?: number | null;
  fleteCuenta?: unknown;
  fleteFecha?: unknown;
  adelantoMonto?: number | null;
  adelantoOp?: unknown;
  adelantoFecha?: unknown;
  saldoMonto?: number | null;
  saldoOp?: unknown;
  saldoFecha?: unknown;
  saldoCuenta?: unknown;
}

export type ResultadoFinanzasShalom =
  | { ok: true; finanzasShalom: FinanzasShalom | null }
  | { ok: false; error: string; status: number };

/**
 * Registra el dinero real de un pedido Shalom (flete pagado a Shalom, adelanto y saldo
 * cobrado) como etiquetas en las notas del pedido y del deal, deja la actividad y avisa
 * al ERP. Lo usan el panel del CRM y las órdenes por WhatsApp del supervisor.
 */
export async function registrarFinanzasShalom(
  datos: DatosFinanzasShalom,
  autor: string
): Promise<ResultadoFinanzasShalom> {
  const flete = datos.fleteShalom ?? null;
  const adelanto = datos.adelantoMonto ?? null;
  const saldo = datos.saldoMonto ?? null;
  if (flete === null && adelanto === null && saldo === null) {
    return { ok: false, status: 400, error: "Ingresa al menos el flete Shalom, el adelanto o el saldo cobrado" };
  }
  if (flete !== null && flete > 100) {
    return { ok: false, status: 400, error: "El flete Shalom parece demasiado alto (máx. S/ 100)" };
  }

  const tags = {
    SHALOM_FLETE:
      flete === null
        ? null
        : construirTag("SHALOM_FLETE", flete, { CUENTA: cuenta(datos.fleteCuenta), FECHA: fecha(datos.fleteFecha) }),
    ADELANTO_MONTO:
      adelanto === null
        ? null
        : construirTag("ADELANTO_MONTO", adelanto, {
            OP: String(datos.adelantoOp || ""),
            FECHA: fecha(datos.adelantoFecha),
            CUENTA: "BCP",
          }),
    SALDO_COBRADO:
      saldo === null
        ? null
        : construirTag("SALDO_COBRADO", saldo, {
            OP: String(datos.saldoOp || ""),
            FECHA: fecha(datos.saldoFecha),
            CUENTA: cuenta(datos.saldoCuenta),
          }),
  } as const;

  const aplicar = (notas: string | null | undefined) => {
    let n = notas || "";
    // Solo se reemplazan las etiquetas que llegan; las demás se conservan.
    for (const [nombre, tag] of Object.entries(tags)) {
      if (tag) n = reemplazarTag(n, nombre as keyof typeof tags, tag);
    }
    return n;
  };

  let pedidoRow = null;
  if (datos.pedidoId) {
    [pedidoRow] = await db.select().from(pedidosOrdenes).where(eq(pedidosOrdenes.id, datos.pedidoId)).limit(1);
  }
  if (!pedidoRow && datos.dealId) {
    [pedidoRow] = await db.select().from(pedidosOrdenes).where(eq(pedidosOrdenes.dealId, datos.dealId)).limit(1);
  }

  let pedidoActualizado = null;
  if (pedidoRow) {
    [pedidoActualizado] = await db
      .update(pedidosOrdenes)
      .set({ notas: aplicar(pedidoRow.notas), updatedAt: new Date() })
      .where(eq(pedidosOrdenes.id, pedidoRow.id))
      .returning();
  }

  const targetDealId = datos.dealId || pedidoRow?.dealId || null;
  let dealActualizado = null;
  if (targetDealId) {
    const [dealRow] = await db.select().from(deals).where(eq(deals.id, targetDealId)).limit(1);
    if (dealRow) {
      [dealActualizado] = await db
        .update(deals)
        .set({ notes: aplicar(dealRow.notes), updatedAt: new Date() })
        .where(eq(deals.id, dealRow.id))
        .returning();
    }
  }

  if (!pedidoActualizado && !dealActualizado) {
    return { ok: false, status: 404, error: "No se encontró el pedido ni el deal" };
  }

  const finanzas = extraerFinanzasShalom(
    [pedidoActualizado?.notas, dealActualizado?.notes].filter(Boolean).join("\n")
  );

  const partes = [
    flete !== null ? `flete Shalom S/ ${flete.toFixed(2)}` : null,
    adelanto !== null ? `adelanto S/ ${adelanto.toFixed(2)}` : null,
    saldo !== null ? `saldo cobrado S/ ${saldo.toFixed(2)}` : null,
  ].filter(Boolean);
  const contactId = pedidoRow?.contactId || dealActualizado?.contactId || null;
  if (contactId) {
    await db.insert(activities).values({
      type: "note",
      description: `[Dinero Shalom] ${autor} registró ${partes.join(", ")}`,
      contactId,
      dealId: targetDealId,
    });
  }

  // Aviso inmediato al ERP (si falla, la sincronización cada 15 min lo recoge de las notas).
  const erpUrl = process.env.ALIV_ERP_URL || "https://aliv-finanzas-erp.onrender.com";
  const erpPin = process.env.ALIV_FINANZAS_PIN || process.env.ALIV_PIN || "";
  fetch(`${erpUrl}/api/crm/sync-now`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(erpPin ? { "x-aliv-pin": erpPin } : {}),
    },
    body: JSON.stringify({
      origen: "crm-finanzas-shalom",
      dealId: targetDealId,
      numeroOrden: datos.numeroOrden || pedidoRow?.numeroOrden,
      finanzasShalom: finanzas,
    }),
  }).catch(() => {});

  return { ok: true, finanzasShalom: finanzas };
}
