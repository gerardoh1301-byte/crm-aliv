import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { verificarYNotificarLlegadasShalom } from "@/lib/agencias/notificar-llegada-shalom";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const forzar = searchParams.get("forzar") === "true";
    const contactId = searchParams.get("contactId") || undefined;

    const resultado = await verificarYNotificarLlegadasShalom({
      forzarReenvio: forzar,
      contactIdEspecifico: contactId,
    });

    return NextResponse.json({
      ok: true,
      data: resultado,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[api-shalom-verificar] Error:", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const forzar = Boolean(body.forzarReenvio);
    const contactId = body.contactIdEspecifico || undefined;

    const resultado = await verificarYNotificarLlegadasShalom({
      forzarReenvio: forzar,
      contactIdEspecifico: contactId,
    });

    return NextResponse.json({
      ok: true,
      data: resultado,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[api-shalom-verificar] Error:", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
