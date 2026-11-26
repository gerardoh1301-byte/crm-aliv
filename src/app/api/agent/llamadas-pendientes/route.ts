import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { contacts } from "@/db/schema";
import { and, asc, eq, gte, sql } from "drizzle-orm";
import { pedidosOrdenes } from "../../../../../modules/pedidos/tabla";
import { autorizadoPorSecreto } from "@/lib/secreto-worker";
import {
  dentroHorarioLlamadaIA,
  MARCA_LLAMADA_IA_INICIADA,
  MARCA_LLAMADA_IA_PENDIENTE_HORARIO,
} from "@/lib/voice/llamar-pedido-reglas";
import { dispararLlamadaConfirmacionPedido } from "@/lib/voice/llamar-pedido";

export const dynamic = "force-dynamic";

/**
 * Barrido automático de llamadas pendientes de madrugada (llamado por barridos.ts cada 2 min).
 *
 * Solo actúa dentro del horario comercial de Perú (7:00 a. m. a 10:00 p. m.).
 * A las 7:00 a. m. recoge todos los pedidos web que ingresaron fuera de horario
 * (marcados con `[LLAMADA_IA_PENDIENTE_HORARIO]`), que sigan en `por_confirmar_cod`
 * y aún no tengan `[LLAMADA_IA_INICIADA]`, y dispara las llamadas de Sofía (máximo 5 por vuelta).
 */
export async function GET(req: NextRequest) {
  if (!autorizadoPorSecreto(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!dentroHorarioLlamadaIA()) {
    return NextResponse.json({
      ok: true,
      fueraDeHorario: true,
      revisados: 0,
      llamados: 0,
    });
  }

  // Últimas 24 horas para no revivir pedidos antiguos
  const desde = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const pendientes = await db
    .select({
      pedido: pedidosOrdenes,
      contactName: contacts.name,
      contactPhone: contacts.phone,
    })
    .from(pedidosOrdenes)
    .innerJoin(contacts, eq(contacts.id, pedidosOrdenes.contactId))
    .where(
      and(
        eq(pedidosOrdenes.estado, "por_confirmar_cod"),
        gte(pedidosOrdenes.createdAt, desde),
        sql`position(${MARCA_LLAMADA_IA_PENDIENTE_HORARIO} in coalesce(${pedidosOrdenes.notas}, '')) > 0`,
        sql`position(${MARCA_LLAMADA_IA_INICIADA} in coalesce(${pedidosOrdenes.notas}, '')) = 0`
      )
    )
    .orderBy(asc(pedidosOrdenes.createdAt))
    .limit(5);

  const resultados: Array<{ numeroOrden: string; ok: boolean; motivo?: string }> = [];
  let llamados = 0;

  for (const row of pendientes) {
    const p = row.pedido;
    const esAgencia = p.modalidadPago === "adelanto_agencia";
    const productosTexto =
      Array.isArray(p.items) && p.items.length > 0
        ? p.items.map((i) => `${i.cantidad}x ${i.titulo}`).join(", ")
        : "tu pedido de Aliv Perú";

    const res = await dispararLlamadaConfirmacionPedido({
      pedidoId: p.id,
      numeroOrden: p.numeroOrden,
      contactId: p.contactId,
      nombreCliente: row.contactName,
      telefono: row.contactPhone,
      productosTexto,
      totalSoles: Number(p.total) || 0,
      ciudad: p.ciudad,
      distrito: p.distrito,
      direccion: p.direccionEnvio,
      dni: p.dniCliente,
      esAgencia,
      modalidadEntregaTexto: esAgencia ? "Agencia Shalom (Provincia)" : "Contraentrega Domicilio",
    });

    if (res.ok) llamados++;
    resultados.push({
      numeroOrden: p.numeroOrden,
      ok: res.ok,
      motivo: res.motivo,
    });
  }

  return NextResponse.json({
    ok: true,
    fueraDeHorario: false,
    revisados: pendientes.length,
    llamados,
    resultados,
  });
}
