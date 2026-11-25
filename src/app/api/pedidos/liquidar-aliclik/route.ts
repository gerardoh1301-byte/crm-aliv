import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api-auth";
import { displayName } from "@/lib/team";
import { registrarLiquidacionAliclik, type DatosLiquidacionAliclik } from "@/lib/aliclik/liquidacion";

export const dynamic = "force-dynamic";

export { extraerLiquidacionAliclik, type LiquidacionAliclikInfo } from "@/lib/aliclik/liquidacion";

export async function POST(request: NextRequest) {
  // R6: Solo administradores pueden registrar o alterar liquidaciones contables
  const auth = await requireAdmin();
  if ("response" in auth) return auth.response;
  const { member } = auth;

  let body: DatosLiquidacionAliclik;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const r = await registrarLiquidacionAliclik(body, displayName(member));
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
  return NextResponse.json(r);
}
