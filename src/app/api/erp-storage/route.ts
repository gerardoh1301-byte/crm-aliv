import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { crmSettings } from "@/db/schema";
import { eq } from "drizzle-orm";
import { requireMember } from "@/lib/api-auth";
import { autorizadoPorSecreto } from "@/lib/secreto-worker";

export const dynamic = "force-dynamic";

const ERP_DB_KEY = "erp.database_json";

async function estaAutorizado(request: NextRequest): Promise<boolean> {
  if (autorizadoPorSecreto(request)) return true;
  const auth = await requireMember();
  return !("response" in auth);
}

export async function GET(request: NextRequest) {
  if (!(await estaAutorizado(request))) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  try {
    const [row] = await db
      .select()
      .from(crmSettings)
      .where(eq(crmSettings.key, ERP_DB_KEY))
      .limit(1);

    if (!row?.value) {
      return NextResponse.json({ ok: true, data: null });
    }
    const parsed = JSON.parse(row.value);
    return NextResponse.json({
      ok: true,
      data: parsed,
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Error leyendo respaldo ERP" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  if (!(await estaAutorizado(request))) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  try {
    const body = await request.json();
    if (!body || typeof body !== "object") {
      return NextResponse.json({ ok: false, error: "Payload inválido" }, { status: 400 });
    }
    const serialized = JSON.stringify(body);
    await db
      .insert(crmSettings)
      .values({
        key: ERP_DB_KEY,
        value: serialized,
      })
      .onConflictDoUpdate({
        target: crmSettings.key,
        set: {
          value: serialized,
        },
      });
    return NextResponse.json({ ok: true, savedAt: new Date().toISOString() });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Error guardando respaldo ERP" },
      { status: 500 }
    );
  }
}
