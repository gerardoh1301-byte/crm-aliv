import { NextResponse } from "next/server";
import { syncAccountsFromZernio } from "@/lib/channels/sync";
import { requireAdmin } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

export async function POST() {
  const auth = await requireAdmin();
  if ("response" in auth) return auth.response;
  const result = await syncAccountsFromZernio();
  return NextResponse.json(result, { status: result.ok ? 200 : 502 });
}
