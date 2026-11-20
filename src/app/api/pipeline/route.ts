import { NextRequest, NextResponse } from "next/server";
import { setDealStage } from "@/lib/deals/stage";
import { db } from "@/db";
import { pipelineStages, pipelines, deals, contacts, teamMembers } from "@/db/schema";
import { pedidosOrdenes } from "../../../../modules/pedidos/tabla";
import { eq, asc } from "drizzle-orm";
import { requireMember } from "@/lib/api-auth";
import { ownerFilter, canAccessContactId } from "@/lib/team";
import { countDocumentsByContact } from "@/lib/documents";
import { extraerLiquidacionAliclik } from "@/app/api/pedidos/liquidar-aliclik/route";
import { extraerFinanzasShalom } from "@/lib/finanzas/tags-shalom";

export async function GET() {
  const auth = await requireMember();
  if ("response" in auth) return auth.response;

  const stages = await db
    .select()
    .from(pipelineStages)
    .orderBy(asc(pipelineStages.order));

  const allDeals = await db
    .select({
      id: deals.id,
      title: deals.title,
      value: deals.value,
      stageId: deals.stageId,
      contactId: deals.contactId,
      expectedClose: deals.expectedClose,
      probability: deals.probability,
      notes: deals.notes,
      createdAt: deals.createdAt,
      updatedAt: deals.updatedAt,
      contactName: contacts.name,
      contactPhone: contacts.phone,
      contactTags: contacts.tags,
      contactCustomFields: contacts.customFields,
      ownerId: contacts.ownerId,
      ownerName: teamMembers.name,
      ordenId: pedidosOrdenes.id,
      ordenNumero: pedidosOrdenes.numeroOrden,
      ordenItems: pedidosOrdenes.items,
      ordenTotal: pedidosOrdenes.total,
      ordenCiudad: pedidosOrdenes.ciudad,
      ordenDistrito: pedidosOrdenes.distrito,
      ordenDireccion: pedidosOrdenes.direccionEnvio,
      ordenTransportadora: pedidosOrdenes.transportadora,
      ordenNumeroGuia: pedidosOrdenes.numeroGuia,
      ordenCodigoRastreo: pedidosOrdenes.codigoRastreo,
      ordenClaveRecojo: pedidosOrdenes.claveRecojo,
      ordenModalidadPago: pedidosOrdenes.modalidadPago,
      ordenEstado: pedidosOrdenes.estado,
      ordenNotas: pedidosOrdenes.notas,
    })
    .from(deals)
    .leftJoin(contacts, eq(deals.contactId, contacts.id))
    .leftJoin(teamMembers, eq(contacts.ownerId, teamMembers.id))
    // A4: Unir el pedido con la operación únicamente por dealId para evitar duplicar tarjetas
    .leftJoin(pedidosOrdenes, eq(deals.id, pedidosOrdenes.dealId))
    .where(ownerFilter(auth.member));

  // Deduplicar por deal.id en caso de que un mismo dealId aparezca en más de una orden
  const seenDealIds = new Set<string>();
  const uniqueDeals = allDeals.filter((d) => {
    if (seenDealIds.has(d.id)) return false;
    seenDealIds.add(d.id);
    return true;
  });

  const docCounts = await countDocumentsByContact([...new Set(uniqueDeals.map((d) => d.contactId))]);

  const pipeline = stages.map((stage) => {
    const esConsulta =
      stage.key === "consulta_catalogo" ||
      stage.name.toLowerCase().includes("consulta");
    return {
      ...stage,
      deals: uniqueDeals
        .filter((d) => d.stageId === stage.id)
        .map((d) => {
          const custom = (d.contactCustomFields as Record<string, unknown> | null) ?? {};
          const notasCombinadas = [d.ordenNotas, d.notes].filter(Boolean).join("\n");
          const liq = extraerLiquidacionAliclik(notasCombinadas);
          return {
            ...d,
            stageKey: stage.key,
            stageName: stage.name,
            pedidoId: d.ordenId || null,
            transportadora: d.ordenTransportadora || null,
            numeroGuia: d.ordenNumeroGuia || (custom.guia_shalom as string) || null,
            codigoRastreo: d.ordenCodigoRastreo || (custom.codigo_rastreo as string) || null,
            claveRecojo: d.ordenClaveRecojo || (custom.clave_recojo as string) || null,
            estadoPedido: d.ordenEstado || null,
            ciudad: d.ordenCiudad || (custom.departamento_ciudad as string) || (custom.ciudad as string) || null,
            distrito: d.ordenDistrito || (custom.distrito as string) || null,
            direccion: d.ordenDireccion || (custom.direccion_envio as string) || (custom.agencia_shalom as string) || null,
            numeroOrden: d.ordenNumero || null,
            dniCliente: (custom.dni_ruc as string) || (custom.dni as string) || null,
            adelantoVerificado: Boolean(
              notasCombinadas.includes("[ADELANTO VERIFICADO]") ||
              stage.key === "adelanto_pagado" ||
              d.ordenModalidadPago === "adelanto_agencia"
            ),
            liquidacionAliclik: liq,
            finanzasShalom: extraerFinanzasShalom(notasCombinadas),
            // A5: Poner valor 0 a las consultas (leads sin pedido) para no inflar el valor del pipeline
            // Asegurar que el valor del deal siempre esté en centavos para formatCurrency (S/ total * 100)
            value: esConsulta && !d.ordenId
              ? 0
              : d.ordenTotal && Number(d.ordenTotal) > 0
                ? Math.round(Number(d.ordenTotal) * 100)
                : (d.value && d.value > 0 && d.value < 500 ? Math.round(d.value * 100) : (d.value || 0)),
            docCount: docCounts[d.contactId] ?? 0,
          };
        }),
    };
  });

  return NextResponse.json(pipeline);
}

export async function PUT(request: NextRequest) {
  const auth = await requireMember();
  if ("response" in auth) return auth.response;

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON invalido" }, { status: 400 });
  }

  // Sincronizar pipeline y etapas según config/cliente.ts
  if (body.syncPipeline) {
    const { sincronizarPipeline } = await import("@/lib/pipeline/sincronizar");
    const r = await sincronizarPipeline();
    return NextResponse.json({ ok: true, ...r });
  }

  // Sincronizar etiquetas de contactos según etapa de su deal
  if (body.syncTags) {
    const { sincronizarEtiquetasDesdePipeline } = await import("@/lib/pipeline/sincronizar");
    const r = await sincronizarEtiquetasDesdePipeline();
    return NextResponse.json({ ok: true, actualizados: r.actualizados });
  }

  // Update a single deal's stage (drag and drop)
  if (body.dealId && body.stageId) {
    const existingRows = await db.select().from(deals).where(eq(deals.id, body.dealId)).limit(1);
    const existing = existingRows[0];
    if (!existing || !(await canAccessContactId(auth.member, existing.contactId))) {
      return NextResponse.json({ error: "Deal no encontrado" }, { status: 404 });
    }

    // Unico camino de cambio de etapa: emite `deal.stage_changed`.
    const moved = await setDealStage({ dealId: body.dealId, stageId: body.stageId });
    if (!moved.ok) {
      return NextResponse.json({ error: moved.error }, { status: 400 });
    }
    const [result] = await db
      .select()
      .from(deals)
      .where(eq(deals.id, body.dealId))
      .limit(1);

    // Notificar al ERP para que actualice los ingresos/egresos de esta etapa en tiempo real
    const erpUrl = process.env.ALIV_ERP_URL || "https://aliv-finanzas-erp.onrender.com";
    const erpPin = process.env.ALIV_FINANZAS_PIN || process.env.ALIV_PIN || "";
    fetch(`${erpUrl}/api/crm/sync-now`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(erpPin ? { "x-aliv-pin": erpPin } : {}),
      },
      body: JSON.stringify({
        origen: "crm-stage-change",
        dealId: body.dealId,
        stageId: body.stageId,
      }),
    }).catch(() => {});

    return NextResponse.json(result);
  }

  // Bulk update stages (from /setup or /customize) - solo admin
  if (body.stages && Array.isArray(body.stages)) {
    if (auth.member.role !== "admin") {
      return NextResponse.json({ error: "Solo administradores pueden reordenar etapas" }, { status: 403 });
    }
    // Delete existing stages (only if no deals reference them)
    const existingDeals = await db.select().from(deals);
    if (existingDeals.length > 0) {
      return NextResponse.json(
        {
          error:
            "No se pueden reemplazar etapas cuando hay deals activos. Elimina los deals primero.",
        },
        { status: 400 }
      );
    }

    // Legacy path used by /customize and /setup skills.
    // Replaces stages on the default pipeline. Prefer /api/stages for new UIs.
    const defaultPipelineRows = await db
      .select({ id: pipelines.id })
      .from(pipelines)
      .where(eq(pipelines.isDefault, true))
      .limit(1);
    const defaultPipelineId = defaultPipelineRows[0]?.id;

    if (!defaultPipelineId) {
      return NextResponse.json(
        { error: "No hay pipeline default configurado" },
        { status: 400 }
      );
    }

    await db
      .delete(pipelineStages)
      .where(eq(pipelineStages.pipelineId, defaultPipelineId));

    for (const stage of body.stages) {
      await db.insert(pipelineStages).values({
        pipelineId: defaultPipelineId,
        name: stage.name,
        order: stage.order,
        color: stage.color || "#64748b",
        isWon: stage.isWon || false,
        isLost: stage.isLost || false,
      });
    }

    const updated = await db
      .select()
      .from(pipelineStages)
      .orderBy(asc(pipelineStages.order));

    return NextResponse.json(updated);
  }

  return NextResponse.json({ error: "Request invalido" }, { status: 400 });
}
