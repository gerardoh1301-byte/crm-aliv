import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { activities, deals } from "@/db/schema";
import { eq } from "drizzle-orm";
import { requireAdmin } from "@/lib/api-auth";
import { displayName } from "@/lib/team";
import { pedidosOrdenes } from "@modules/pedidos/tabla";

export const dynamic = "force-dynamic";

export interface LiquidacionAliclikInfo {
  montoNeto: number;
  montoBruto: number;
  costoEnvio: number;
  costoFulfillment: number;
  comisionPos: number;
  fecha: string;
  metodoCobro: string;
  nroOperacion: string;
}

export function extraerLiquidacionAliclik(
  notas?: string | null
): LiquidacionAliclikInfo | null {
  if (!notas) return null;
  const match = notas.match(/\[ALICLIK_LIQUIDADO_BCP:([^\]]+)\]/i);
  if (!match) return null;

  const partes = match[1].split("|");
  const montoNeto = parseFloat(partes[0]) || 0;
  const map: Record<string, string> = {};
  for (let i = 1; i < partes.length; i++) {
    const idx = partes[i].indexOf(":");
    if (idx > 0) {
      const k = partes[i].slice(0, idx).toUpperCase().trim();
      const v = partes[i].slice(idx + 1).trim();
      map[k] = v;
    }
  }

  return {
    montoNeto,
    montoBruto: parseFloat(map.BRUTO || "0") || montoNeto,
    costoEnvio: parseFloat(map.ENVIO || "13.50") || 0,
    costoFulfillment: parseFloat(map.FF || "3.00") || 0,
    comisionPos: parseFloat(map.POS || "0") || 0,
    fecha: map.FECHA || new Date().toISOString().slice(0, 10),
    metodoCobro: map.METODO || "EFECTIVO",
    nroOperacion: map.OP || "",
  };
}

function actualizarTagLiquidacion(
  textoActual: string | null | undefined,
  nuevoTag: string,
  resumenHumano: string
): string {
  const limpio = (textoActual || "")
    .replace(/\[ALICLIK_LIQUIDADO_BCP:[^\]]+\]/gi, "")
    .replace(/\[Liquidación AliClik BCP confirmada[^\n]*\]/gi, "")
    .trim();
  return [limpio, resumenHumano, nuevoTag].filter(Boolean).join("\n");
}

export async function POST(request: NextRequest) {
  // R6: Solo administradores pueden registrar o alterar liquidaciones contables
  const auth = await requireAdmin();
  if ("response" in auth) return auth.response;
  const { member } = auth;

  let body: {
    dealId?: string;
    pedidoId?: string | null;
    contactId?: string | null;
    numeroOrden?: string | null;
    montoNeto?: number | string;
    montoBruto?: number | string;
    costoEnvio?: number | string;
    costoFulfillment?: number | string;
    comisionPos?: number | string;
    metodoCobro?: string;
    fechaLiquidacion?: string;
    nroOperacion?: string;
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const montoNeto = Math.round((Number(body.montoNeto) || 0) * 100) / 100;
  if (montoNeto <= 0) {
    return NextResponse.json(
      { error: "El monto neto liquidado debe ser mayor a S/ 0.00" },
      { status: 400 }
    );
  }

  const montoBruto = Math.round((Number(body.montoBruto) || montoNeto) * 100) / 100;
  const costoEnvio = Math.round((Number(body.costoEnvio) || 0) * 100) / 100;
  const costoFulfillment = Math.round((Number(body.costoFulfillment) || 0) * 100) / 100;
  const comisionPos = Math.round((Number(body.comisionPos) || 0) * 100) / 100;
  const metodoCobro = (body.metodoCobro || (comisionPos > 0 ? "POS" : "EFECTIVO")).toUpperCase();
  const fecha =
    body.fechaLiquidacion && /^\d{4}-\d{2}-\d{2}$/.test(body.fechaLiquidacion)
      ? body.fechaLiquidacion
      : new Date().toISOString().slice(0, 10);
  const nroOperacion = (body.nroOperacion || "").replace(/[|\]]/g, "").trim();

  const quien = displayName(member);
  const tag = `[ALICLIK_LIQUIDADO_BCP:${montoNeto.toFixed(2)}|BRUTO:${montoBruto.toFixed(2)}|ENVIO:${costoEnvio.toFixed(2)}|FF:${costoFulfillment.toFixed(2)}|POS:${comisionPos.toFixed(2)}|FECHA:${fecha}|METODO:${metodoCobro}|OP:${nroOperacion}]`;
  const resumen = `[Liquidación AliClik BCP confirmada por ${quien} el ${fecha}: Neto S/ ${montoNeto.toFixed(2)} depositado en BCP (Cobrado: S/ ${montoBruto.toFixed(2)} - Envío: S/ ${costoEnvio.toFixed(2)} - FF: S/ ${costoFulfillment.toFixed(2)}${comisionPos > 0 ? ` - POS: S/ ${comisionPos.toFixed(2)}` : ""})]`;

  let pedidoActualizado = null;
  let dealActualizado = null;

  // 1. Buscar y actualizar pedido en pedidos_ordenes
  let pedidoRow = null;
  if (body.pedidoId) {
    const [p] = await db
      .select()
      .from(pedidosOrdenes)
      .where(eq(pedidosOrdenes.id, body.pedidoId))
      .limit(1);
    pedidoRow = p ?? null;
  }
  if (!pedidoRow && body.dealId) {
    const [p] = await db
      .select()
      .from(pedidosOrdenes)
      .where(eq(pedidosOrdenes.dealId, body.dealId))
      .limit(1);
    pedidoRow = p ?? null;
  }

  if (pedidoRow) {
    const nuevasNotas = actualizarTagLiquidacion(pedidoRow.notas, tag, resumen);
    const [act] = await db
      .update(pedidosOrdenes)
      .set({
        notas: nuevasNotas,
        updatedAt: new Date(),
      })
      .where(eq(pedidosOrdenes.id, pedidoRow.id))
      .returning();
    pedidoActualizado = act;
  }

  // 2. Actualizar deal en deals
  const targetDealId = body.dealId || pedidoRow?.dealId;
  if (targetDealId) {
    const [dealRow] = await db
      .select()
      .from(deals)
      .where(eq(deals.id, targetDealId))
      .limit(1);
    if (dealRow) {
      const nuevasNotasDeal = actualizarTagLiquidacion(dealRow.notes, tag, resumen);
      const [dAct] = await db
        .update(deals)
        .set({
          notes: nuevasNotasDeal,
          updatedAt: new Date(),
        })
        .where(eq(deals.id, dealRow.id))
        .returning();
      dealActualizado = dAct;
    }
  }

  // 3. Registrar actividad en el historial
  const contactIdFinal = body.contactId || pedidoRow?.contactId || dealActualizado?.contactId;
  if (contactIdFinal) {
    await db.insert(activities).values({
      type: "note",
      description: `${resumen}`,
      contactId: contactIdFinal,
      dealId: targetDealId || null,
    });
  }

  // 4. Notificar en segundo plano al ERP Finanzas para sincronizar Libro Diario de inmediato
  const erpUrl = process.env.ALIV_ERP_URL || "https://aliv-finanzas-erp.onrender.com";
  const erpPin = process.env.ALIV_FINANZAS_PIN || process.env.ALIV_PIN || "";
  fetch(`${erpUrl}/api/crm/sync-now`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(erpPin ? { "x-aliv-pin": erpPin } : {}),
    },
    body: JSON.stringify({
      origen: "crm-liquidacion-aliclik",
      dealId: targetDealId,
      pedidoId: pedidoRow?.id,
      numeroOrden: body.numeroOrden || pedidoRow?.numeroOrden,
      liquidacion: {
        montoNeto,
        montoBruto,
        costoEnvio,
        costoFulfillment,
        comisionPos,
        fecha,
        metodoCobro,
        nroOperacion,
      },
    }),
  }).catch(() => {});

  return NextResponse.json({
    ok: true,
    liquidacion: {
      montoNeto,
      montoBruto,
      costoEnvio,
      costoFulfillment,
      comisionPos,
      fecha,
      metodoCobro,
      nroOperacion,
    },
    pedido: pedidoActualizado,
    deal: dealActualizado,
  });
}
