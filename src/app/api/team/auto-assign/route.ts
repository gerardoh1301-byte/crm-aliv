import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, requireMember } from "@/lib/api-auth";
import {
  getAutoAssignConfig,
  saveAutoAssignConfig,
} from "@/lib/team/auto-assign";
import { listMembers } from "@/lib/team";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireMember();
  if ("response" in auth) return auth.response;

  const [config, members] = await Promise.all([
    getAutoAssignConfig(),
    listMembers(),
  ]);

  return NextResponse.json({
    config,
    advisors: members.filter((m) => m.active),
  });
}

export async function PUT(request: NextRequest) {
  const auth = await requireAdmin();
  if ("response" in auth) return auth.response;

  try {
    const body = (await request.json()) as {
      enabled: boolean;
      memberId?: string | null;
      mode?: "all_inbound" | "unassigned_only";
    };

    if (body.enabled && !body.memberId) {
      return NextResponse.json(
        { error: "Debes seleccionar un asesor de venta para activar la asignación automática." },
        { status: 400 }
      );
    }

    const updated = await saveAutoAssignConfig({
      enabled: Boolean(body.enabled),
      memberId: body.memberId ?? null,
      mode: body.mode ?? "all_inbound",
    });

    return NextResponse.json({ ok: true, config: updated });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Error guardando configuración" },
      { status: 500 }
    );
  }
}
