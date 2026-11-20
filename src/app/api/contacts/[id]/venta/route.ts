import { NextRequest, NextResponse } from "next/server";
import { generarNumeroChat } from "@/lib/pedidos/numeracion";
import { db } from "@/db";
import { activities, contacts, deals, pipelineStages, pipelines } from "@/db/schema";
import { pedidosOrdenes } from "@modules/pedidos/tabla";
import { and, desc, eq } from "drizzle-orm";
import { requireMember } from "@/lib/api-auth";
import { canAccessContact } from "@/lib/team";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireMember();
  if ("response" in auth) return auth.response;
  const { id } = await params;

  const [contact] = await db
    .select()
    .from(contacts)
    .where(eq(contacts.id, id))
    .limit(1);

  if (!contact || !canAccessContact(auth.member, contact)) {
    return NextResponse.json({ error: "Contacto no encontrado" }, { status: 404 });
  }

  // Buscar pedido reciente
  const [pedido] = await db
    .select()
    .from(pedidosOrdenes)
    .where(eq(pedidosOrdenes.contactId, id))
    .orderBy(desc(pedidosOrdenes.createdAt))
    .limit(1);

  // Buscar deal reciente
  const [deal] = await db
    .select()
    .from(deals)
    .where(eq(deals.contactId, id))
    .orderBy(desc(deals.createdAt))
    .limit(1);

  const custom = (contact.customFields as Record<string, unknown> | null) ?? {};
  const items = Array.isArray(pedido?.items) ? pedido.items : [];
  const primerItem = items[0] as { titulo?: string; cantidad?: number } | undefined;

  const producto = primerItem?.titulo || (custom.producto_interes as string) || null;
  const cantidad = primerItem?.cantidad || Number(custom.cantidad_producto) || 1;
  const total = pedido
    ? Number(pedido.total)
    : deal?.value
      ? deal.value > 500
        ? deal.value / 100
        : deal.value
      : Number(custom.total_venta) || 0;
  const adelanto = Number(custom.adelanto_pagado) || 20;
  const saldo = Math.max(0, total - adelanto);

  return NextResponse.json({
    ok: true,
    tieneVenta: Boolean(pedido || (deal && deal.value > 0)),
    producto,
    cantidad,
    total,
    adelanto,
    saldo,
    numeroOrden: pedido?.numeroOrden || null,
    pedidoId: pedido?.id || null,
    dealId: deal?.id || null,
  });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireMember();
  if ("response" in auth) return auth.response;
  const { id } = await params;

  let body: {
    producto?: string;
    cantidad?: number;
    total?: number;
    adelanto?: number;
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const producto = (body.producto || "").trim();
  const cantidad = Math.max(1, Number(body.cantidad) || 1);
  const total = Number(body.total);
  const adelanto = body.adelanto !== undefined ? Number(body.adelanto) : 20;

  if (!producto) {
    return NextResponse.json({ error: "Debes seleccionar o ingresar un producto" }, { status: 400 });
  }
  if (isNaN(total) || total <= 0) {
    return NextResponse.json({ error: "El monto total debe ser mayor a 0" }, { status: 400 });
  }

  const [contact] = await db
    .select()
    .from(contacts)
    .where(eq(contacts.id, id))
    .limit(1);

  if (!contact || !canAccessContact(auth.member, contact)) {
    return NextResponse.json({ error: "Contacto no encontrado" }, { status: 404 });
  }

  const saldo = Math.max(0, total - adelanto);
  const customActuales = (contact.customFields as Record<string, unknown> | null) ?? {};

  // 1. Normalizar etiquetas de interés
  const tagsActuales = contact.tags || [];
  const esTermix = /termix|tobillera/i.test(producto);
  const esNac = /nac|nad/i.test(producto);

  const tagsNuevos = [...tagsActuales];
  if (esTermix && !tagsNuevos.some((t) => t.toLowerCase() === "interes:termix")) {
    tagsNuevos.push("interes:termix");
  }
  if (esNac && !tagsNuevos.some((t) => t.toLowerCase() === "interes:nac600")) {
    tagsNuevos.push("interes:nac600");
  }

  // 2. Actualizar campos del contacto
  const customActualizados: Record<string, unknown> = {
    ...customActuales,
    producto_interes: producto,
    cantidad_producto: cantidad,
    total_venta: total.toFixed(2),
    adelanto_pagado: adelanto.toFixed(2),
    saldo_cobrar: saldo.toFixed(2),
  };

  await db
    .update(contacts)
    .set({
      tags: tagsNuevos,
      customFields: customActualizados,
      updatedAt: new Date(),
    })
    .where(eq(contacts.id, id));

  // 3. Buscar o crear Deal en Pipeline
  let [deal] = await db
    .select()
    .from(deals)
    .where(eq(deals.contactId, id))
    .orderBy(desc(deals.createdAt))
    .limit(1);

  const dealTitle = `${contact.name || "Cliente"} · ${cantidad}x ${producto}`;

  if (deal) {
    const [dActualizado] = await db
      .update(deals)
      .set({
        title: dealTitle,
        value: Math.round(total * 100),
        updatedAt: new Date(),
      })
      .where(eq(deals.id, deal.id))
      .returning();
    deal = dActualizado;
  } else {
    // Buscar pipeline default
    const [pipeline] = await db
      .select({ id: pipelines.id })
      .from(pipelines)
      .where(eq(pipelines.isDefault, true))
      .limit(1);

    if (pipeline) {
      // Buscar etapa correspondiente: si tiene etiqueta adelanto pagado, buscar stage adelanto_pagado
      const tieneAdelanto = tagsNuevos.some((t) => t.toLowerCase() === "adelanto pagado");
      const [stageTarget] = await db
        .select({ id: pipelineStages.id })
        .from(pipelineStages)
        .where(
          and(
            eq(pipelineStages.pipelineId, pipeline.id),
            tieneAdelanto
              ? eq(pipelineStages.key, "adelanto_pagado")
              : eq(pipelineStages.order, 0)
          )
        )
        .limit(1);

      if (stageTarget) {
        const [dNuevo] = await db
          .insert(deals)
          .values({
            title: dealTitle,
            value: Math.round(total * 100),
            stageId: stageTarget.id,
            contactId: id,
          })
          .returning();
        deal = dNuevo;
      }
    }
  }

  // 4. Buscar o crear Pedido en pedidos_ordenes
  const [pedidoExistente] = await db
    .select()
    .from(pedidosOrdenes)
    .where(eq(pedidosOrdenes.contactId, id))
    .orderBy(desc(pedidosOrdenes.createdAt))
    .limit(1);

  const sku = esTermix ? "TERMIX-TOB" : "NAC600";
  const items = [
    {
      sku,
      titulo: producto,
      cantidad,
      precioUnitario: Number((total / cantidad).toFixed(2)),
    },
  ];

  let pedidoId = pedidoExistente?.id;
  let numeroOrden = pedidoExistente?.numeroOrden;

  const ciudad =
    (customActualizados.departamento_ciudad as string) ||
    (customActualizados.ciudad as string) ||
    "";
  const direccion =
    (customActualizados.agencia_shalom as string) ||
    (customActualizados.direccion_envio as string) ||
    "";
  const dni =
    (customActualizados.dni_ruc as string) ||
    (customActualizados.dni as string) ||
    "";

  const esProvincia =
    Boolean(ciudad) &&
    !ciudad.toLowerCase().includes("lima") &&
    !ciudad.toLowerCase().includes("callao");

  const tieneTagAdelanto = tagsNuevos.some((t) => t.toLowerCase() === "adelanto pagado");

  // Provincia con contra entrega de AliClik: sin adelanto, igual que Lima. Si eligió
  // agencia Shalom, o AliClik no responde, se queda en adelanto_agencia.
  const eligioShalom = /shalom/i.test(String(customActualizados.agencia_shalom || "")) ||
    /shalom/i.test(String(customActualizados.modalidad_entrega || ""));
  let modalidadPago: "contraentrega" | "adelanto_agencia" = esProvincia ? "adelanto_agencia" : "contraentrega";
  if (esProvincia && !eligioShalom) {
    try {
      const { decidirEntrega } = await import("@/lib/aliclik/cobertura-cod");
      const decision = await decidirEntrega({
        ciudad,
        distrito: (customActualizados.distrito as string) || null,
        direccion: (customActualizados.direccion_envio as string) || null,
      });
      modalidadPago = decision.modalidadPago;
    } catch (err) {
      console.warn("[confirmar-venta] No se pudo consultar la cobertura AliClik:", err);
    }
  }

  if (pedidoExistente) {
    const [pAct] = await db
      .update(pedidosOrdenes)
      .set({
        items,
        total: total.toFixed(2),
        dealId: deal?.id ?? pedidoExistente.dealId,
        estado: tieneTagAdelanto && pedidoExistente.estado === "por_confirmar_cod" ? "adelanto_pagado" : pedidoExistente.estado,
        updatedAt: new Date(),
      })
      .where(eq(pedidosOrdenes.id, pedidoExistente.id))
      .returning();
    pedidoId = pAct.id;
    numeroOrden = pAct.numeroOrden;
  } else {
    // Venta cerrada por chat o llamada: serie propia CHAT-0001 (la serie "#1148" es de Shopify).
    numeroOrden = await generarNumeroChat();

    const [pNuevo] = await db
      .insert(pedidosOrdenes)
      .values({
        id: crypto.randomUUID(),
        numeroOrden,
        contactId: id,
        dealId: deal?.id ?? null,
        estado: tieneTagAdelanto ? "adelanto_pagado" : "confirmado",
        modalidadPago,
        items,
        total: total.toFixed(2),
        moneda: "PEN",
        ciudad: ciudad || null,
        direccionEnvio: direccion || null,
        dniCliente: dni || null,
        notas: `Venta confirmada por asesor humano (${auth.member.name || auth.member.email}).`,
      })
      .returning();
    pedidoId = pNuevo.id;
  }

  // 5. Registrar nota de auditoría en actividades
  try {
    await db.insert(activities).values({
      type: "note",
      description: `[CONFIRMACIÓN DE VENTA] Asesor confirmó: ${cantidad}x ${producto} por S/ ${total.toFixed(2)} (Adelanto S/ ${adelanto.toFixed(2)} | Saldo restante S/ ${saldo.toFixed(2)}).`,
      contactId: id,
    });
  } catch (actErr) {
    console.warn("[confirmar-venta] Error registrando actividad:", actErr);
  }

  return NextResponse.json({
    ok: true,
    producto,
    cantidad,
    total,
    adelanto,
    saldo,
    numeroOrden,
    dealId: deal?.id ?? null,
    pedidoId,
  });
}
