import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { deals, contacts, activities } from "@/db/schema";
import { pedidosOrdenes } from "../../../../../modules/pedidos/tabla";
import { and, desc, eq, gte, lt, ne, or } from "drizzle-orm";
import { getCurrentMember } from "@/lib/team";
import { sincronizarEtapaPipeline } from "../../../../../modules/pedidos/servidor";
import { sincronizarConGoogleDrive } from "@/lib/drive-sync";
import type { EstadoPedido } from "../../../../../modules/pedidos/tipos";
import { avisarFichaAliclik } from "@/lib/pedidos/ficha-aliclik";

export const dynamic = "force-dynamic";

function getInicioHoyLima(): Date {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Lima",
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(new Date());
  const year = parseInt(parts.find((p) => p.type === "year")?.value || "2026", 10);
  const month = parseInt(parts.find((p) => p.type === "month")?.value || "1", 10);
  const day = parseInt(parts.find((p) => p.type === "day")?.value || "1", 10);
  // 00:00:00 en America/Lima (UTC-5) -> 05:00:00 UTC
  return new Date(Date.UTC(year, month - 1, day, 5, 0, 0));
}

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

  let claveLimpia = claveRecojo ? String(claveRecojo).trim() : null;

  // Verificación de clave de retiro Shalom:
  // Si la clave ya fue utilizada anteriormente (en otro pedido reciente), se genera una advertencia
  // informativa para el asesor, pero NUNCA se bloquea el guardado ni el envío. Si el asesor
  // humano la está ingresando es porque se realizó el registro manual en la agencia con esa clave.
  let advertenciaClave: string | null = null;
  if (claveLimpia) {
    const inicioHoyLima = getInicioHoyLima();
    const sieteDiasAtras = new Date(inicioHoyLima.getTime() - 7 * 24 * 3600 * 1000);

    const [duplicadaAnterior] = await db
      .select({ id: pedidosOrdenes.id, numeroOrden: pedidosOrdenes.numeroOrden, updatedAt: pedidosOrdenes.updatedAt })
      .from(pedidosOrdenes)
      .where(
        and(
          eq(pedidosOrdenes.claveRecojo, claveLimpia),
          ne(pedidosOrdenes.id, pedido.id),
          gte(pedidosOrdenes.updatedAt, sieteDiasAtras)
        )
      )
      .orderBy(desc(pedidosOrdenes.updatedAt))
      .limit(1);

    if (duplicadaAnterior) {
      const esDiaAnterior = duplicadaAnterior.updatedAt < inicioHoyLima;
      advertenciaClave = esDiaAnterior
        ? `Aviso: La clave de retiro ${claveLimpia} ya fue utilizada en un día anterior en la orden ${duplicadaAnterior.numeroOrden}. Al ser ingresada manualmente por el asesor, se guardó correctamente.`
        : `Aviso: La clave ${claveLimpia} coincide con la orden ${duplicadaAnterior.numeroOrden} del mismo día. Guardada correctamente.`;
    }
  }

  const updates: Record<string, any> = {
    transportadora: transportadora || "Shalom",
    numeroGuia: guiaLimpia,
    codigoRastreo: codigoLimpio,
    claveRecojo: claveLimpia,
    updatedAt: new Date(),
  };

  if (agencia && String(agencia).trim()) {
    updates.direccionEnvio = String(agencia).trim();
  }

  if (body.total !== undefined && !isNaN(Number(body.total)) && Number(body.total) > 0) {
    updates.total = String(Number(body.total).toFixed(2));
  }

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

  // Si se modificó el total, sincronizar el valor del negocio en el pipeline
  if (actualizado.dealId && updates.total) {
    await db
      .update(deals)
      .set({
        value: Math.round(Number(actualizado.total) * 100),
        updatedAt: new Date(),
      })
      .where(eq(deals.id, actualizado.dealId));
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

  // Con preguía, código y clave cargados: ficha para registrarlo en AliClik y pagar los S/5.
  await avisarFichaAliclik(actualizado).catch((err) => console.warn("[seguimiento] ficha AliClik:", err));

  // Sincronizar respaldo en Google Drive
  await sincronizarConGoogleDrive().catch(() => {});

  return NextResponse.json({
    ok: true,
    pedido: actualizado,
    advertencia: advertenciaClave,
  });
}

