import { NextResponse } from "next/server";
import { and, desc, inArray, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { contacts } from "@/db/schema";
import { requireMember } from "@/lib/api-auth";
import { ownerFilter } from "@/lib/team";
import { pedidosOrdenes } from "@modules/pedidos/tabla";

export const dynamic = "force-dynamic";

/** Minúsculas y sin tildes, igual en SQL y en JS. */
const sinTildes = (col: typeof contacts.name) =>
  sql`translate(lower(coalesce(${col}, '')), 'áéíóúüñ', 'aeiouun')`;

function normalizar(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/**
 * Buscador de la barra superior (27/11: antes no buscaba nada). Encuentra clientes por nombre
 * (cada palabra, en cualquier orden y sin tildes), celular o número de pedido. Un vendedor
 * solo ve sus clientes.
 */
export async function GET(req: Request) {
  const auth = await requireMember();
  if ("response" in auth) return auth.response;

  const q = (new URL(req.url).searchParams.get("q") ?? "").trim().slice(0, 80);
  if (q.length < 2) return NextResponse.json({ resultados: [] });

  const palabras = normalizar(q).split(/\s+/).filter((p) => p.length >= 2).slice(0, 5);
  const digitos = q.replace(/\D/g, "");

  const condiciones: SQL[] = [];
  if (palabras.length) {
    const porNombre = and(...palabras.map((p) => sql`${sinTildes(contacts.name)} like ${`%${p}%`}`));
    if (porNombre) condiciones.push(porNombre);
  }
  if (digitos.length >= 6) {
    condiciones.push(sql`regexp_replace(coalesce(${contacts.phone}, ''), '[^0-9]', '', 'g') like ${`%${digitos}%`}`);
  }
  if (digitos.length >= 3 && digitos.length <= 6) {
    const conPedido = db
      .select({ id: pedidosOrdenes.contactId })
      .from(pedidosOrdenes)
      .where(sql`regexp_replace(${pedidosOrdenes.numeroOrden}, '[^0-9]', '', 'g') = ${digitos}`);
    condiciones.push(inArray(contacts.id, conPedido));
  }
  if (!condiciones.length) return NextResponse.json({ resultados: [] });

  const filas = await db
    .select({ id: contacts.id, name: contacts.name, phone: contacts.phone })
    .from(contacts)
    .where(and(or(...condiciones), ownerFilter(auth.member)))
    .orderBy(desc(contacts.updatedAt))
    .limit(8);

  const pedidos = filas.length
    ? await db
        .select({ contactId: pedidosOrdenes.contactId, numeroOrden: pedidosOrdenes.numeroOrden, createdAt: pedidosOrdenes.createdAt })
        .from(pedidosOrdenes)
        .where(inArray(pedidosOrdenes.contactId, filas.map((f) => f.id)))
        .orderBy(desc(pedidosOrdenes.createdAt))
    : [];

  return NextResponse.json({
    resultados: filas.map((f) => ({
      ...f,
      pedido: pedidos.find((p) => p.contactId === f.id)?.numeroOrden ?? null,
    })),
  });
}
