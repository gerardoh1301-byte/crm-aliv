import "server-only";
import { db } from "@/db";
import { contacts, teamMembers } from "@/db/schema";
import { and, eq, gte, sql } from "drizzle-orm";
import { ownerFilter, type TeamMember } from "@/lib/team";
import { pedidosOrdenes } from "../../modules/pedidos/tabla";
import { fleteShalomDeNotas } from "@/lib/metricas-operacion";
import type { PedidoReporte } from "./reportes-operacion-reglas";

/** Cuatro meses: alcanza para comparar el mes actual con los tres anteriores. */
export const DIAS_REPORTE_OPERACION = 120;

export async function pedidosReporteOperacion(member: TeamMember): Promise<PedidoReporte[]> {
  const desde = new Date(Date.now() - DIAS_REPORTE_OPERACION * 86_400_000);
  const p = pedidosOrdenes;
  const filas = await db
    .select({
      fecha: sql<string>`to_char(${p.createdAt} at time zone 'America/Lima', 'YYYY-MM-DD')`,
      estado: p.estado,
      total: p.total,
      unidades: sql<number>`(select coalesce(sum((i->>'cantidad')::int), 0) from jsonb_array_elements(${p.items}) i)::int`,
      producto: sql<string | null>`${p.items}->0->>'titulo'`,
      modalidad_pago: p.modalidadPago,
      transportadora: p.transportadora,
      despachado: sql<boolean>`(${p.numeroGuia} is not null or ${p.estado} in ('enviado', 'entregado')
        or position('[ALICLIK_ORDEN' in coalesce(${p.notas}, '')) > 0
        or position('[AVISO_LLEGADA_ENVIADO' in coalesce(${p.notas}, '')) > 0)`,
      notas: p.notas,
      // Canal: web (Shopify), bot (dejó la actividad «[IA] Pedido N…») o el asesor del contacto.
      esWeb: sql<boolean>`${p.shopifyOrderId} is not null`,
      esBot: sql<boolean>`exists (select 1 from activities a where a.contact_id = ${p.contactId}
        and a.description like '[IA] Pedido ' || ${p.numeroOrden} || ' %')`,
      asesor: teamMembers.name,
    })
    .from(p)
    .innerJoin(contacts, eq(p.contactId, contacts.id))
    .leftJoin(teamMembers, eq(contacts.ownerId, teamMembers.id))
    .where(
      and(
        ownerFilter(member),
        sql`not (${contacts.tags} @> array['simulador']::text[])`,
        gte(p.createdAt, desde)
      )
    );

  return filas.map((f) => ({
    fecha: f.fecha,
    estado: f.estado,
    total: Number(f.total) || 0,
    unidades: Number(f.unidades) || 0,
    producto: f.producto,
    modalidad_pago: f.modalidad_pago,
    transportadora: f.transportadora,
    despachado: Boolean(f.despachado),
    flete_shalom: fleteShalomDeNotas(f.notas),
    canal: f.esWeb ? "Web" : f.esBot ? "Bot" : f.asesor ? `Asesor: ${f.asesor}` : "Sin asesor",
  }));
}
