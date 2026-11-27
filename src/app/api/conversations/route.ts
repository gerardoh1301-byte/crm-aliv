import { NextRequest, NextResponse } from "next/server";
import { firmaBandeja, listConversations } from "@/lib/conversations";
import { isChannel } from "@/lib/channels/types";
import { requireMember } from "@/lib/api-auth";
import { visibleOwnerId } from "@/lib/team";
import { cuentasVisiblesPara } from "@/lib/channels/numeros";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = await requireMember();
  if ("response" in auth) return auth.response;

  const ownerId = visibleOwnerId(auth.member);
  // La bandeja se pide cada 12 s: si nada cambió desde la última vez, no se reenvía (204).
  const accountIds = await cuentasVisiblesPara(auth.member);
  const firma = await firmaBandeja(ownerId, accountIds);
  if (firma && request.nextUrl.searchParams.get("firma") === firma) {
    return new NextResponse(null, { status: 204, headers: { "x-firma": firma } });
  }

  const channel = request.nextUrl.searchParams.get("channel");
  const items = await listConversations({
    channel: isChannel(channel) ? channel : undefined,
    ownerId,
    accountIds,
  });
  return NextResponse.json(items, { headers: { "x-firma": firma } });
}
