import "server-only";
import { db } from "@/db";
import { contacts, teamMembers } from "@/db/schema";
import { and, eq, gte, sql, type SQL } from "drizzle-orm";
import { pedidosOrdenes } from "../../../modules/pedidos/tabla";
import type { PedidoCentro } from "./centro-control-reglas";

/** Días que trae el Centro de Control; el componente filtra 7 / 30 en el navegador. */
export const DIAS_CENTRO = 30;

const noSimulador = sql`not (${contacts.tags} @> array['simulador']::text[])`;

export async function pedidosCentroControl(soloMios: SQL | undefined): Promise<PedidoCentro[]> {
  const desde = new Date(Date.now() - DIAS_CENTRO * 86_400_000);
  const filas = await db
    .select({
      id: pedidosOrdenes.id,
      numero: pedidosOrdenes.numeroOrden,
      fecha: sql<string>`to_char(${pedidosOrdenes.createdAt} at time zone 'America/Lima', 'YYYY-MM-DD')`,
      estado: pedidosOrdenes.estado,
      total: pedidosOrdenes.total,
      modalidadPago: pedidosOrdenes.modalidadPago,
      transportadora: pedidosOrdenes.transportadora,
      numeroGuia: pedidosOrdenes.numeroGuia,
      notas: pedidosOrdenes.notas,
      contactId: pedidosOrdenes.contactId,
      nombre: contacts.name,
      telefono: contacts.phone,
      asesor: teamMembers.name,
    })
    .from(pedidosOrdenes)
    .innerJoin(contacts, eq(pedidosOrdenes.contactId, contacts.id))
    .leftJoin(teamMembers, eq(contacts.ownerId, teamMembers.id))
    .where(and(soloMios, noSimulador, gte(pedidosOrdenes.createdAt, desde)));

  return filas.map((f) => ({
    ...f,
    numero: String(f.numero),
    total: Number(f.total) || 0,
    nombre: f.nombre ?? "Sin nombre",
    // Al navegador solo viajan las marcas que usan las reglas, no las notas completas.
    notas: ["[ALICLIK_ORDEN", "[AVISO_LLEGADA_ENVIADO"].filter((m) => (f.notas ?? "").includes(m)).join(" ") || null,
  }));
}
