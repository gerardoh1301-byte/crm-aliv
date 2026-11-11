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
    })
    .from(deals)
    .leftJoin(contacts, eq(deals.contactId, contacts.id))
    .leftJoin(teamMembers, eq(contacts.ownerId, teamMembers.id))
    .leftJoin(pedidosOrdenes, or(eq(deals.id, pedidosOrdenes.dealId), eq(deals.contactId, pedidosOrdenes.contactId)))
    // Un asesor ve solo las operaciones de sus contactos.
    .where(ownerFilter(member));

  const docCounts = await countDocumentsByContact([...new Set(dealRows.map((d) => d.contactId))]);

  const pipelinesWithStages: Pipeline[] = allPipelines.map((p) => ({
    id: p.id,
    name: p.name,
    isDefault: p.isDefault,
    order: p.order,
    stages: allStages.filter((s) => s.pipelineId === p.id),
  }));

  const dealsForClient: DealWithContact[] = dealRows.map((d) => {
    const cf = (d.contactCustomFields || {}) as Record<string, any>;
    const ciudad = d.ordenCiudad || cf.departamento_ciudad || cf.ciudad || null;
    const distrito = d.ordenDistrito || cf.distrito || null;
    const direccion = d.ordenDireccion || cf.direccion_envio || cf.direccion || null;
    const dni = d.ordenDni || cf.dni_ruc || cf.dni || null;
    const stage = allStages.find((s) => s.id === d.stageId);

    return {
      id: d.id,
      title: d.title,
      value: d.value,
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
      ownerId: d.contactOwnerId || null,
      ownerName: d.contactOwnerName || null,
    };
  });

  return (
    <PipelineWorkspace
      pipelines={pipelinesWithStages}
      deals={dealsForClient}
    />
  );
}
