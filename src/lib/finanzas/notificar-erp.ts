/**
 * Notificador en tiempo real CRM Pipeline -> Aliv Finanzas ERP
 * Ante cualquier cambio de etapa en el pipeline, creación/actualización de pedido o
 * confirmación de adelanto, envía el deal actualizado al webhook del ERP (< 2s).
 */

import "server-only";
import { db } from "@/db";
import {
  contacts,
  crmSettings,
  deals,
  pipelineStages,
  teamMembers,
} from "@/db/schema";
import { pedidosOrdenes } from "../../../modules/pedidos/tabla";
import { eq } from "drizzle-orm";

const ERP_BASE_URL = (
  process.env.ALIV_ERP_URL || "https://aliv-finanzas-erp.onrender.com"
).replace(/\/$/, "");

let cachedErpToken: string | null = null;
let cachedErpTokenExp = 0;

async function leerErpPin(): Promise<string | null> {
  if (process.env.ALIV_FINANZAS_PIN?.trim()) {
    return process.env.ALIV_FINANZAS_PIN.trim();
  }
  try {
    const [row] = await db
      .select()
      .from(crmSettings)
      .where(eq(crmSettings.key, "auth.erp_pin"))
      .limit(1);
    if (typeof row?.value === "string" && row.value.trim()) {
      return row.value.trim();
    }
  } catch {
    // ignorar error de lectura
  }
  return null;
}

async function obtenerTokenErp(forceRefresh = false): Promise<string | null> {
  if (!forceRefresh && cachedErpToken && Date.now() < cachedErpTokenExp - 60_000) {
    return cachedErpToken;
  }
  const pin = await leerErpPin();
  if (!pin) return null;

  try {
    const res = await fetch(`${ERP_BASE_URL}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin }),
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return null;
    const data = (await res.json().catch(() => null)) as {
      ok?: boolean;
      token?: string;
      expiresAt?: number;
    } | null;
    if (data?.ok && data.token) {
      cachedErpToken = data.token;
      cachedErpTokenExp = data.expiresAt || Date.now() + 6 * 3600 * 1000;
      return cachedErpToken;
    }
  } catch (err) {
    console.warn("[notificar-erp] Error autenticando con ERP:", err);
  }
  return null;
}

export async function notificarCambioDealAlErp(
  dealId: string
): Promise<{ ok: boolean; status?: number; error?: string }> {
  if (!dealId) return { ok: false, error: "dealId vacío" };

  try {
    const [row] = await db
      .select({
        id: deals.id,
        title: deals.title,
        value: deals.value,
        stageId: deals.stageId,
        contactId: deals.contactId,
        notes: deals.notes,
        createdAt: deals.createdAt,
        updatedAt: deals.updatedAt,
        stageKey: pipelineStages.key,
        stageName: pipelineStages.name,
        contactName: contacts.name,
        contactPhone: contacts.phone,
        contactTags: contacts.tags,
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
      })
      .from(deals)
      .leftJoin(pipelineStages, eq(deals.stageId, pipelineStages.id))
      .leftJoin(contacts, eq(deals.contactId, contacts.id))
      .leftJoin(teamMembers, eq(contacts.ownerId, teamMembers.id))
      .leftJoin(pedidosOrdenes, eq(deals.id, pedidosOrdenes.dealId))
      .where(eq(deals.id, dealId))
      .limit(1);

    if (!row) return { ok: false, error: "Deal no encontrado" };

    // Solo notificar si hay número de orden o si está en una etapa operativa/comercial
    const stagePayload = {
      id: row.stageId,
      key: row.stageKey || "",
      name: row.stageName || "",
    };

    const dealPayload = {
      id: row.id,
      title: row.title,
      value: row.value,
      stageId: row.stageId,
      contactId: row.contactId,
      notes: row.notes,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      contactName: row.contactName,
      contactPhone: row.contactPhone,
      contactTags: row.contactTags || [],
      ownerName: row.ownerName,
      ordenId: row.ordenId,
      ordenNumero: row.ordenNumero,
      ordenItems: row.ordenItems,
      ordenTotal: row.ordenTotal,
      ordenCiudad: row.ordenCiudad,
      ordenDistrito: row.ordenDistrito,
      ordenDireccion: row.ordenDireccion,
      ordenTransportadora: row.ordenTransportadora,
      ordenNumeroGuia: row.ordenNumeroGuia,
      ordenCodigoRastreo: row.ordenCodigoRastreo,
      ordenClaveRecojo: row.ordenClaveRecojo,
      ordenModalidadPago: row.ordenModalidadPago,
      ordenEstado: row.ordenEstado,
    };

    let token = await obtenerTokenErp(false);
    if (!token) {
      return { ok: false, error: "No se pudo obtener token de sesión ERP" };
    }

    const enviar = async (tok: string) =>
      fetch(`${ERP_BASE_URL}/api/crm/webhook`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${tok}`,
        },
        body: JSON.stringify({
          event: "deal.updated",
          stage: stagePayload,
          deal: dealPayload,
        }),
        signal: AbortSignal.timeout(12_000),
      });

    let resp = await enviar(token);
    if (resp.status === 401) {
      token = await obtenerTokenErp(true);
      if (token) {
        resp = await enviar(token);
      }
    }

    if (!resp.ok) {
      return { ok: false, status: resp.status, error: `ERP respondió ${resp.status}` };
    }

    return { ok: true, status: resp.status };
  } catch (err) {
    console.warn("[notificar-erp] Error enviando actualización en tiempo real:", err);
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
