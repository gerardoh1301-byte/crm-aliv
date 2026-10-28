import { NextResponse } from "next/server";
import { sincronizarConGoogleDrive } from "@/lib/drive-sync";

export const dynamic = "force-dynamic";

export async function GET() {
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

export async function POST() {
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
