import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { requireAdmin } from "@/lib/api-auth";
import { agruparPorDia, type EnvioPlantilla } from "@/lib/finanzas/plantillas-enviadas";

/**
 * GET /api/erp/plantillas-enviadas?desde=2026-11-01&hasta=2026-11-25
 * Plantillas de WhatsApp enviadas por día (Lima), con su categoría, para el costo en el ERP.
 */
export async function GET(req: NextRequest) {
  const auth = await requireAdmin();
  if ("response" in auth) return auth.response;

  const iso = /^\d{4}-\d{2}-\d{2}$/;
  const desde = req.nextUrl.searchParams.get("desde") ?? "2026-11-01";
  const hasta = req.nextUrl.searchParams.get("hasta") ?? new Intl.DateTimeFormat("en-CA", { timeZone: "America/Lima" }).format(new Date());
  if (!iso.test(desde) || !iso.test(hasta)) return NextResponse.json({ error: "fecha_invalida" }, { status: 400 });

  const filas = await db.execute(sql`
    select m.template_name as plantilla,
           t.category as categoria,
           m.status as estado,
           coalesce(m.sent_at, m.created_at) as enviado_en,
           exists (
             select 1 from messages i
             where i.conversation_id = m.conversation_id and i.direction = 'in'
               and i.created_at <= coalesce(m.sent_at, m.created_at)
               and i.created_at > coalesce(m.sent_at, m.created_at) - interval '24 hours'
           ) as en_ventana
    from messages m
    left join lateral (
      select category from whatsapp_templates wt where wt.name = m.template_name order by wt.updated_at desc limit 1
    ) t on true
    where m.template_name is not null and m.direction = 'out'
      and (coalesce(m.sent_at, m.created_at) at time zone 'America/Lima')::date between ${desde}::date and ${hasta}::date
  `);
  const rows = (Array.isArray(filas) ? filas : (filas as { rows: unknown[] }).rows) as Record<string, unknown>[];
  const envios: EnvioPlantilla[] = rows.map((r) => ({
    plantilla: String(r.plantilla),
    categoria: (r.categoria as string | null) ?? null,
    estado: String(r.estado ?? ""),
    enviadoEn: r.enviado_en as string,
    enVentana: Boolean(r.en_ventana),
  }));
  return NextResponse.json({ desde, hasta, dias: agruparPorDia(envios) });
}
