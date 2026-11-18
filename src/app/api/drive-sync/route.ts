import { NextRequest, NextResponse } from "next/server";
import { sincronizarConGoogleDrive } from "@/lib/drive-sync";
import { autorizadoPorSecreto } from "@/lib/secreto-worker";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!autorizadoPorSecreto(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  try {
    const res = await sincronizarConGoogleDrive();
    return NextResponse.json(res);
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Error sincronizando con Drive" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  if (!autorizadoPorSecreto(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  try {
    const res = await sincronizarConGoogleDrive();
    return NextResponse.json(res);
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Error sincronizando con Drive" },
      { status: 500 }
    );
  }
}
