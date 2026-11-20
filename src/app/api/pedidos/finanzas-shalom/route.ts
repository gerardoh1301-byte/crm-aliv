import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api-auth";
import { displayName } from "@/lib/team";
import { registrarFinanzasShalom } from "@/lib/finanzas/registrar-shalom";

export const dynamic = "force-dynamic";

function monto(v: unknown): number | null {
  if (v === undefined || v === null || v === "") return null;
  const n = Math.round(Number(v) * 100) / 100;
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * Registra el dinero real de un pedido Shalom: flete pagado a Shalom, adelanto y saldo
 * cobrado antes de entregar la clave. La lógica vive en registrarFinanzasShalom (también
 * la usan las órdenes por WhatsApp del supervisor).
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

  const res = await registrarFinanzasShalom(
    {
      dealId: typeof body.dealId === "string" ? body.dealId : null,
      pedidoId: typeof body.pedidoId === "string" ? body.pedidoId : null,
      numeroOrden: typeof body.numeroOrden === "string" ? body.numeroOrden : null,
      fleteShalom: monto(body.fleteShalom),
      fleteCuenta: body.fleteCuenta,
      fleteFecha: body.fleteFecha,
      adelantoMonto: monto(body.adelantoMonto),
      adelantoOp: body.adelantoOp,
      adelantoFecha: body.adelantoFecha,
      saldoMonto: monto(body.saldoMonto),
      saldoOp: body.saldoOp,
      saldoFecha: body.saldoFecha,
      saldoCuenta: body.saldoCuenta,
    },
    displayName(member)
  );
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
  return NextResponse.json({ ok: true, finanzasShalom: res.finanzasShalom });
}
