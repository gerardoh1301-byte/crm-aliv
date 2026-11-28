import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { verificarYNotificarLlegadasShalom } from "@/lib/agencias/notificar-llegada-shalom";
import { leerReporteEstados } from "@/lib/agencias/estados-externos-shalom";
import { autorizadoPorSecreto } from "@/lib/secreto-worker";
import { requireAdmin } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

/**
 * POST /api/shalom/reportar-estados
 *
 * Recibe los estados que la revisión diaria (10:00) leyó en la web de Shalom con la sesión
 * de Gerardo y corre la misma cadencia del barrido: aviso de «envío confirmado» a Gerardo,
 * aviso de llegada al cliente por el bot (si tiene ventana de 24 h), aviso a la vendedora
 * para que llame (si no la tiene) y paso a Entregado.
 *
 * Cuerpo: { estados: [{ guia, estado | texto, desde?, agenciaDestino? }], forzarReenvio? }
 * estado: no_confirmado | en_origen | en_transito | demora | en_destino | entregado
 */
export async function POST(req: NextRequest) {
  if (!autorizadoPorSecreto(req)) {
    const auth = await requireAdmin();
    if ("response" in auth) return auth.response;
  }
  try {
    const body = await req.json().catch(() => ({}));
    const { estados, rechazados } = leerReporteEstados(body);
    if (estados.size === 0) {
      return NextResponse.json({ ok: false, error: "Sin estados válidos", rechazados }, { status: 400 });
    }
    const resultado = await verificarYNotificarLlegadasShalom({
      estadosExternos: estados,
      forzarReenvio: Boolean((body as { forzarReenvio?: boolean }).forzarReenvio),
    });
    return NextResponse.json({ ok: true, recibidos: estados.size, rechazados, data: resultado });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[api-shalom-reportar-estados] Error:", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
