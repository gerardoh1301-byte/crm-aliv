import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { deals, contacts, activities } from "@/db/schema";
import { pedidosOrdenes } from "../../../../../modules/pedidos/tabla";
import { eq, or } from "drizzle-orm";
import { getCurrentMember } from "@/lib/team";
import { sincronizarEtapaPipeline } from "../../../../../modules/pedidos/servidor";
import { sincronizarConGoogleDrive } from "@/lib/drive-sync";
import type { EstadoPedido } from "../../../../../modules/pedidos/tipos";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const member = await getCurrentMember();
  if (!member) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: "Cuerpo de solicitud inválido" }, { status: 400 });
  }

  const {
    pedidoId,
    dealId,
    numeroOrden,
    transportadora = "Shalom",
    numeroGuia,
    codigoRastreo,
    claveRecojo,
    estado,
    agencia,
  } = body;

  // Buscar el pedido correspondiente
  let pedido = null;
  if (pedidoId) {
    const [p] = await db
      .select()
      .from(pedidosOrdenes)
      .where(eq(pedidosOrdenes.id, pedidoId))
      .limit(1);
    pedido = p;
  }

  if (!pedido && dealId) {
    const [p] = await db
      .select()
      .from(pedidosOrdenes)
      .where(eq(pedidosOrdenes.dealId, dealId))
      .limit(1);
    pedido = p;
  }

  if (!pedido && numeroOrden) {
    const [p] = await db
      .select()
      .from(pedidosOrdenes)
      .where(
        or(
          eq(pedidosOrdenes.numeroOrden, numeroOrden),
          eq(pedidosOrdenes.numeroOrden, `#${numeroOrden.replace(/^#/, "")}`)
        )
      )
      .limit(1);
    pedido = p;
  }

  if (!pedido) {
    return NextResponse.json(
      { error: "No se encontró el pedido correspondiente" },
      { status: 404 }
    );
  }

  let guiaLimpia = numeroGuia ? String(numeroGuia).trim() : null;
  let codigoLimpio = codigoRastreo ? String(codigoRastreo).trim() : null;

  // Si vino con formato "103386936/7MJM" y no se envio codigo separado, desglosar
  if (guiaLimpia && guiaLimpia.includes("/") && !codigoLimpio) {
    const partes = guiaLimpia.split("/").map((s) => s.trim());
    guiaLimpia = partes[0] || null;
    codigoLimpio = partes[1] || null;
  }

  const updates: Record<string, any> = {
    transportadora: transportadora || "Shalom",
    numeroGuia: guiaLimpia,
    codigoRastreo: codigoLimpio,
    claveRecojo: claveRecojo ? String(claveRecojo).trim() : null,
    updatedAt: new Date(),
  };

  if (estado) {
    updates.estado = estado;
  }

  const [actualizado] = await db
    .update(pedidosOrdenes)
    .set(updates)
    .where(eq(pedidosOrdenes.id, pedido.id))
    .returning();

  // Si se actualizó el estado a 'enviado' o 'confirmado', sincronizar la etapa en el pipeline
  if (estado) {
    const primerProducto =
      (actualizado.items as any[])?.[0]?.titulo || "Pedido Aliv";
    await sincronizarEtapaPipeline(
      actualizado.contactId,
      estado as EstadoPedido,
      `${actualizado.numeroOrden} · ${primerProducto}`,
      Number(actualizado.total) || 0,
      actualizado.id,
      actualizado.dealId
    );
  }

  // Registrar actividad
  const guiaTxt = actualizado.numeroGuia ? ` (Guía Shalom: ${actualizado.numeroGuia})` : "";
  const claveTxt = actualizado.claveRecojo ? ` [Clave: ${actualizado.claveRecojo}]` : "";
  await db.insert(activities).values({
    type: "note",
    description: `Seguimiento de envío actualizado para orden ${actualizado.numeroOrden}${guiaTxt}${claveTxt}. Transportadora: ${actualizado.transportadora || "Shalom"}.`,
    contactId: actualizado.contactId,
    dealId: actualizado.dealId,
  });

  // Sincronizar respaldo en Google Drive
  await sincronizarConGoogleDrive().catch(() => {});

  return NextResponse.json({
    ok: true,
    pedido: actualizado,
  });
}
