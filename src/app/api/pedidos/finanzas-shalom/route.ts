import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { activities, deals } from "@/db/schema";
import { eq } from "drizzle-orm";
import { requireAdmin } from "@/lib/api-auth";
import { displayName } from "@/lib/team";
import { pedidosOrdenes } from "@modules/pedidos/tabla";
import {
  construirTag,
  extraerFinanzasShalom,
  reemplazarTag,
} from "@/lib/finanzas/tags-shalom";

export const dynamic = "force-dynamic";

const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;
const CUENTAS = new Set(["BCP", "ALICLIK", "EFECTIVO"]);

function monto(v: unknown): number | null {
  if (v === undefined || v === null || v === "") return null;
  const n = Math.round(Number(v) * 100) / 100;
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function fecha(v: unknown): string {
  return typeof v === "string" && FECHA_RE.test(v) ? v : new Date().toISOString().slice(0, 10);
}

function cuenta(v: unknown): string {
  const c = String(v || "BCP").toUpperCase();
  return CUENTAS.has(c) ? c : "BCP";
}

/**
 * Registra el dinero real de un pedido Shalom: flete pagado a Shalom, adelanto y saldo
 * cobrado antes de entregar la clave. Lo guarda como etiquetas en las notas del pedido
 * y del deal, y avisa al ERP para que lo pase al Libro Diario.
 */
export async function POST(request: NextRequest) {
  const auth = await requireAdmin();
  if ("response" in auth) return auth.response;
  const { member } = auth;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const dealId = typeof body.dealId === "string" ? body.dealId : null;
  const pedidoId = typeof body.pedidoId === "string" ? body.pedidoId : null;

  const flete = monto(body.fleteShalom);
  const adelanto = monto(body.adelantoMonto);
  const saldo = monto(body.saldoMonto);
  if (flete === null && adelanto === null && saldo === null) {
    return NextResponse.json(
      { error: "Ingresa al menos el flete Shalom, el adelanto o el saldo cobrado" },
      { status: 400 }
    );
  }
  if (flete !== null && flete > 100) {
    return NextResponse.json({ error: "El flete Shalom parece demasiado alto (máx. S/ 100)" }, { status: 400 });
  }

  const tags = {
    SHALOM_FLETE:
      flete === null
        ? null
        : construirTag("SHALOM_FLETE", flete, {
            CUENTA: cuenta(body.fleteCuenta),
            FECHA: fecha(body.fleteFecha),
          }),
    ADELANTO_MONTO:
      adelanto === null
        ? null
        : construirTag("ADELANTO_MONTO", adelanto, {
            OP: String(body.adelantoOp || ""),
            FECHA: fecha(body.adelantoFecha),
            CUENTA: "BCP",
          }),
    SALDO_COBRADO:
      saldo === null
        ? null
        : construirTag("SALDO_COBRADO", saldo, {
            OP: String(body.saldoOp || ""),
            FECHA: fecha(body.saldoFecha),
            CUENTA: cuenta(body.saldoCuenta),
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
  if (pedidoId) {
    [pedidoRow] = await db.select().from(pedidosOrdenes).where(eq(pedidosOrdenes.id, pedidoId)).limit(1);
  }
  if (!pedidoRow && dealId) {
    [pedidoRow] = await db.select().from(pedidosOrdenes).where(eq(pedidosOrdenes.dealId, dealId)).limit(1);
  }

  let pedidoActualizado = null;
  if (pedidoRow) {
    [pedidoActualizado] = await db
      .update(pedidosOrdenes)
      .set({ notas: aplicar(pedidoRow.notas), updatedAt: new Date() })
      .where(eq(pedidosOrdenes.id, pedidoRow.id))
      .returning();
  }

  const targetDealId = dealId || pedidoRow?.dealId || null;
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
    return NextResponse.json({ error: "No se encontró el pedido ni el deal" }, { status: 404 });
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
      description: `[Dinero Shalom] ${displayName(member)} registró ${partes.join(", ")}`,
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
      numeroOrden: (typeof body.numeroOrden === "string" && body.numeroOrden) || pedidoRow?.numeroOrden,
      finanzasShalom: finanzas,
    }),
  }).catch(() => {});

  return NextResponse.json({ ok: true, finanzasShalom: finanzas });
}
