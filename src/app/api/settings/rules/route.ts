import { NextRequest, NextResponse } from "next/server";
import { getBusinessRules, saveBusinessRules, type BusinessRulesData } from "@/lib/settings/rules";
import { requireMember } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireMember();
  if ("response" in auth) return auth.response;

  const rules = await getBusinessRules();
  return NextResponse.json(rules);
}

export async function PUT(request: NextRequest) {
  const auth = await requireMember();
  if ("response" in auth) return auth.response;

  try {
    const body: BusinessRulesData = await request.json();
    await saveBusinessRules(body);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: "Error al guardar reglas", details: String(err) }, { status: 400 });
  }
}
