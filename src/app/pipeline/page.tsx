import { Suspense } from "react";
import { db } from "@/db";
import { pipelines, pipelineStages, deals, contacts, teamMembers } from "@/db/schema";
import { pedidosOrdenes } from "../../../modules/pedidos/tabla";
import { eq, asc, or } from "drizzle-orm";
import { redirect } from "next/navigation";
import { getCurrentMember, ownerFilter } from "@/lib/team";
import { countDocumentsByContact } from "@/lib/documents";
import { PipelineWorkspace } from "@/components/pipeline/PipelineWorkspace";
import type { Pipeline, DealWithContact } from "@/types";

export const dynamic = "force-dynamic";

export default async function PipelinePage() {
  const member = await getCurrentMember();
  if (!member) redirect("/sin-acceso");

  const allPipelines = await db
    .select()
    .from(pipelines)
    .orderBy(asc(pipelines.order));

  const allStages = await db
    .select()
    .from(pipelineStages)
    .orderBy(asc(pipelineStages.order));

  const dealRows = await db
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
      contactEmail: contacts.email,
      contactTags: contacts.tags,
      contactOwnerId: contacts.ownerId,
      contactOwnerName: teamMembers.name,
      contactCustomFields: contacts.customFields,
      ordenId: pedidosOrdenes.id,
      ordenNumero: pedidosOrdenes.numeroOrden,
      ordenCiudad: pedidosOrdenes.ciudad,
      ordenDistrito: pedidosOrdenes.distrito,
      ordenDireccion: pedidosOrdenes.direccionEnvio,
      ordenDni: pedidosOrdenes.dniCliente,
      ordenTransportadora: pedidosOrdenes.transportadora,
      ordenNumeroGuia: pedidosOrdenes.numeroGuia,
      ordenCodigoRastreo: pedidosOrdenes.codigoRastreo,
      ordenClaveRecojo: pedidosOrdenes.claveRecojo,
      ordenEstado: pedidosOrdenes.estado,
      ordenItems: pedidosOrdenes.items,
      ordenTotal: pedidosOrdenes.total,
      ordenModalidadPago: pedidosOrdenes.modalidadPago,
    })
    .from(deals)
    .leftJoin(contacts, eq(deals.contactId, contacts.id))
    .leftJoin(teamMembers, eq(contacts.ownerId, teamMembers.id))
    .leftJoin(pedidosOrdenes, eq(deals.id, pedidosOrdenes.dealId))
    // Un asesor ve solo las operaciones de sus contactos.
    .where(ownerFilter(member));

  // A4: Garantizar 1 operación = 1 tarjeta
  const seenDealIds = new Set<string>();
  const uniqueDealRows = dealRows.filter((d) => {
    if (seenDealIds.has(d.id)) return false;
    seenDealIds.add(d.id);
    return true;
  });

  const docCounts = await countDocumentsByContact([...new Set(uniqueDealRows.map((d) => d.contactId))]);

  const pipelinesWithStages: Pipeline[] = allPipelines.map((p) => ({
    id: p.id,
    name: p.name,
    isDefault: p.isDefault,
    order: p.order,
    stages: allStages.filter((s) => s.pipelineId === p.id),
  }));

  const dealsForClient: DealWithContact[] = uniqueDealRows.map((d) => {
    const cf = (d.contactCustomFields || {}) as Record<string, any>;
    const ciudad = d.ordenCiudad || cf.departamento_ciudad || cf.ciudad || null;
    const distrito = d.ordenDistrito || cf.distrito || null;
    const direccion = cf.agencia_shalom || d.ordenDireccion || cf.direccion_envio || cf.direccion || null;
    const dni = cf.dni_ruc || d.ordenDni || cf.dni || null;
    const stage = allStages.find((s) => s.id === d.stageId);
    const esConsulta =
      stage?.key === "consulta_catalogo" ||
      Boolean(stage?.name && stage.name.toLowerCase().includes("consulta"));

    return {
      id: d.id,
      title: d.title,
      // A5: Leads en consulta sin pedido tienen valor 0
      // Asegurar que el valor del deal siempre esté en centavos para formatCurrency (S/ total * 100)
      value: esConsulta && !d.ordenId
        ? 0
        : d.ordenTotal && Number(d.ordenTotal) > 0
          ? Math.round(Number(d.ordenTotal) * 100)
          : (d.value && d.value > 0 && d.value < 500 ? Math.round(d.value * 100) : (d.value || 0)),
      stageId: d.stageId,
      contactId: d.contactId,
      expectedClose: d.expectedClose,
      probability: d.probability,
      notes: d.notes,
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
      contactName: d.contactName,
      contactPhone: d.contactPhone,
      contactEmail: d.contactEmail,
      docCount: docCounts[d.contactId] ?? 0,
      ciudad,
      distrito,
      direccion,
      referencia: cf.referencia || null,
      numeroOrden: d.ordenNumero,
      dniCliente: dni,
      stageKey: stage?.key || null,
      stageName: stage?.name || null,
      pedidoId: d.ordenId || null,
      transportadora: d.ordenTransportadora || null,
      numeroGuia: d.ordenNumeroGuia || null,
      codigoRastreo: d.ordenCodigoRastreo || null,
      claveRecojo: d.ordenClaveRecojo || null,
      estadoPedido: d.ordenEstado || null,
      ordenItems: d.ordenItems || null,
      ordenTotal: d.ordenTotal || null,
      ordenModalidadPago: d.ordenModalidadPago || null,
      ownerId: d.contactOwnerId || null,
      ownerName: d.contactOwnerName || null,
      tags: (d.contactTags || []) as string[],
    };
  });

  return (
    <Suspense fallback={<div className="p-8 text-center text-sm text-muted-foreground">Cargando pipeline...</div>}>
      <PipelineWorkspace
        pipelines={pipelinesWithStages}
        deals={dealsForClient}
      />
    </Suspense>
  );
}
