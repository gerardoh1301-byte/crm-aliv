import "server-only";
import { db } from "@/db";
import { contacts, deals, pipelineStages, pipelines } from "@/db/schema";
import { pedidosOrdenes } from "../../../modules/pedidos/tabla";
import { eq } from "drizzle-orm";
import { emitAutomationEvent } from "@/lib/automations";
import type { DealStageChangedPayload } from "@/lib/automations/triggers";
import { cleanStr, esEtiquetaDeEtapa, obtenerEtiquetaDeEtapa, quitarLogisticaSiCierra } from "@/lib/tags";
import { sincronizarDealEnSheets } from "@/lib/sheets/envios-sync";
import { notificarCambioDealAlErp } from "@/lib/finanzas/notificar-erp";
import { crearOActualizarDealPostventa, cancelarDealPostventa } from "@/lib/postventa/engine";
import { aplicarReglaClaveEntregada } from "@/lib/finanzas/regla-clave-entregada";

/**
 * Mueve una operacion de etapa y emite `deal.stage_changed`.
 *
 * Es el UNICO camino: el drag del kanban (`PUT /api/pipeline`), la edicion de la
 * operacion (`PUT /api/deals/:id`) y la creacion (`POST /api/deals`, con
 * `previousStageId = null`: "lead colocado en el pipeline") pasan todos por aca. Si se
 * escribe `stageId` por otro lado, las automatizaciones no se enteran.
 */
export async function setDealStage(input: {
  dealId: string;
  stageId: string;
  /** Solo para la creacion: la fila ya tiene la etapa, no hay que actualizarla. */
  justCreated?: boolean;
}): Promise<{ ok: boolean; error?: string; changed: boolean }> {
  const [deal] = await db
    .select({
      id: deals.id,
      title: deals.title,
      stageId: deals.stageId,
      contactId: deals.contactId,
    })
    .from(deals)
    .where(eq(deals.id, input.dealId))
    .limit(1);
  if (!deal) return { ok: false, error: "Deal no encontrado", changed: false };

  const [stage] = await db
    .select()
    .from(pipelineStages)
    .where(eq(pipelineStages.id, input.stageId))
    .limit(1);
  if (!stage) return { ok: false, error: "Etapa no encontrada", changed: false };

  const previousStageId = input.justCreated ? null : deal.stageId;
  if (!input.justCreated && previousStageId === input.stageId) {
    return { ok: true, changed: false };
  }

  if (!input.justCreated) {
    await db
      .update(deals)
      .set({ stageId: input.stageId, updatedAt: new Date() })
      .where(eq(deals.id, deal.id));

    // Si este deal está vinculado a una orden COD, mantener sincronizado el estado del pedido
    const MAPA_ETAPA_A_ESTADO: Record<string, string> = {
      carrito_armado: "por_confirmar_cod",
      agendar_entrega: "confirmado",
      adelanto_pagado: "preparando",
      en_reparto: "enviado",
      entregado: "entregado",
      cancelado_rechazado: "cancelado",
    };
    const stageKey = stage.key || "";
    const nuevoEstado = stageKey ? MAPA_ETAPA_A_ESTADO[stageKey] : undefined;
    if (nuevoEstado) {
      await db
        .update(pedidosOrdenes)
        .set({ estado: nuevoEstado, updatedAt: new Date() })
        .where(eq(pedidosOrdenes.dealId, deal.id));
    }

    if ((stageKey === "entregado" || nuevoEstado === "entregado") && deal.contactId) {
      try {
        // Una tarjeta de posventa arrastrada a "Entregado" no crea otra posventa encima.
        if (!/^postventa\b/i.test(deal.title || "")) {
          await crearOActualizarDealPostventa(deal.contactId, deal.title);
        }
      } catch (postventaErr) {
        console.warn("[stage] error al vincular postventa:", postventaErr);
      }
    }

    if ((stageKey === "cancelado_rechazado" || nuevoEstado === "cancelado") && deal.contactId) {
      try {
        await cancelarDealPostventa(deal.contactId);
      } catch (cancelErr) {
        console.warn("[stage] error al desvincular postventa:", cancelErr);
      }
    }

    // Regla: tarjeta Shalom en "Entregado y Cobrado" = clave entregada = saldo ya depositado (ese día)
    const nombreEtapa = (stage.name || "").toLowerCase();
    const etapaEntregado = stageKey === "entregado" || nuevoEstado === "entregado" ||
      nombreEtapa.includes("entregado") || nombreEtapa.includes("cobrado");
    try {
      await aplicarReglaClaveEntregada(deal.id, etapaEntregado);
    } catch (reglaErr) {
      console.warn("[stage] error al aplicar la regla de clave entregada:", reglaErr);
    }
  }

  // Sincronizar etiqueta de la conversación/contacto en el chat según la etapa del pipeline
  if (deal.contactId) {
    const nuevaEtiqueta = obtenerEtiquetaDeEtapa(stage);
    if (nuevaEtiqueta) {
      const [contactoFila] = await db
        .select({ id: contacts.id, tags: contacts.tags })
        .from(contacts)
        .where(eq(contacts.id, deal.contactId))
        .limit(1);

      if (contactoFila) {
        const tagsActuales: string[] = contactoFila.tags ?? [];

        // Si ya tiene "Agendar entrega" y la nueva etapa mapeada es "Pendiente de adelanto",
        // no sobreescribir ni degradar "Agendar entrega"
        const tieneAgendarEntrega = tagsActuales.some((t) => cleanStr(t) === "agendar entrega");
        if (tieneAgendarEntrega && cleanStr(nuevaEtiqueta) === "pendiente de adelanto") {
          // Mantener "Agendar entrega" intacta
        } else {
          const sinEtapas = quitarLogisticaSiCierra(
            tagsActuales.filter((t) => !esEtiquetaDeEtapa(t)),
            nuevaEtiqueta
          );
          const actualizadas = [...sinEtapas, nuevaEtiqueta];
          await db
            .update(contacts)
            .set({ tags: actualizadas, updatedAt: new Date() })
            .where(eq(contacts.id, contactoFila.id));
        }
      }
    }
  }

  const [pipeline] = await db
    .select({ name: pipelines.name })
    .from(pipelines)
    .where(eq(pipelines.id, stage.pipelineId))
    .limit(1);
  const [previous] = previousStageId
    ? await db
        .select({ name: pipelineStages.name })
        .from(pipelineStages)
        .where(eq(pipelineStages.id, previousStageId))
        .limit(1)
    : [];
  const [contact] = await db
    .select({ name: contacts.name })
    .from(contacts)
    .where(eq(contacts.id, deal.contactId))
    .limit(1);

  const payload: DealStageChangedPayload = {
    dealId: deal.id,
    dealTitle: deal.title,
    contactName: contact?.name ?? "",
    pipelineId: stage.pipelineId,
    pipelineName: pipeline?.name ?? "",
    stageId: stage.id,
    stageName: stage.name,
    previousStageId,
    previousStageName: previous?.name ?? null,
  };

  await emitAutomationEvent({
    trigger: "deal.stage_changed",
    contactId: deal.contactId,
    payload: payload as unknown as Record<string, unknown>,
  });

  // Si entra a "en_reparto" (En camino/Despachado), o cambia de estado estando despachado,
  // respaldar automáticamente en Google Sheets
  if (stage.key === "en_reparto" || stage.isWon || (previous && "key" in previous && previous.key === "en_reparto")) {
    sincronizarDealEnSheets(deal.id).catch((err) =>
      console.error("[setDealStage] Error sincronizando con Google Sheets:", err)
    );
  }

  // Sincronización 100% automática y en tiempo real hacia el ERP Finanzas
  notificarCambioDealAlErp(deal.id).catch((err) =>
    console.error("[setDealStage] Error notificando cambio al ERP:", err)
  );

  return { ok: true, changed: true };
}
