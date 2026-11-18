/**
 * Módulo de Sincronización Automática CRM Aliv -> Aliv Finanzas ERP & Kardex
 * Sincroniza pedidos, estados de entrega, kardex de unidades e ingresos en caja.
 * A9 & A2: Nunca sobrescribe colecciones vacías en Render; lee /api/load primero,
 * envía únicamente { pedidos } para combinar, usa costos reales (18 y 38.42) y calcula stock desde lotes.
 */

import "server-only";
import fs from "node:fs";
import { db } from "@/db";
import { contacts } from "@/db/schema";
import { pedidosOrdenes } from "../../../modules/pedidos/tabla";
import { desc, eq } from "drizzle-orm";

const ERP_LOCAL_PATH = "G:\\Mi unidad\\Aliv Finanzas\\aliv_database.json";
const ERP_BASE_URL = process.env.ALIV_ERP_URL || "https://aliv-finanzas-erp.onrender.com";

export interface ResumenFinanzasSync {
  ok: boolean;
  actualizados: number;
  nuevos: number;
  totalPedidosErp: number;
  entregadosMonto: number;
  transitoMonto: number;
  kardex: {
    lotesNac: number;
    entregadosNac: number;
    transitoNac: number;
    disponibleNac: number;
  };
  cloudSynced: boolean;
  error?: string;
}

export function calcularStockNacDesdeErp(erpDb: {
  lotes?: Record<string, { productoId?: string; cantidad?: number; costoUnit?: number }>;
  ajustes?: Record<string, { productoId?: string; delta?: number; cantidad?: number }>;
  pedidos?: Record<string, { productoId?: string; estado?: string; unidades?: number; anulado?: boolean }>;
}): {
  lotesNac: number;
  ajustesNac: number;
  entregadosNac: number;
  transitoNac: number;
  disponibleNac: number;
  costoUnitNac: number;
  costoUnitTermix: number;
} {
  const lotes = Object.values(erpDb.lotes || {});
  const lotesNacRows = lotes.filter((l) => l && l.productoId === "NAC600");
  const lotesTermixRows = lotes.filter((l) => l && l.productoId === "TERMIX");

  const lotesNac = lotesNacRows.reduce((acc, l) => acc + (Number(l.cantidad) || 0), 0);
  const ajustes = Object.values(erpDb.ajustes || {});
  const ajustesNac = ajustes
    .filter((a) => a && a.productoId === "NAC600")
    .reduce((acc, a) => acc + (Number(a.delta ?? a.cantidad) || 0), 0);

  const pedidos = Object.values(erpDb.pedidos || {}).filter((p) => p && !p.anulado);
  const entregadosNac = pedidos
    .filter((p) => p.productoId === "NAC600" && p.estado === "entregado")
    .reduce((acc, p) => acc + (Number(p.unidades) || 1), 0);
  const transitoNac = pedidos
    .filter((p) => p.productoId === "NAC600" && p.estado === "enviado")
    .reduce((acc, p) => acc + (Number(p.unidades) || 1), 0);

  const costoUnitNac = Number(lotesNacRows[0]?.costoUnit) || 18.0;
  const costoUnitTermix = Number(lotesTermixRows[0]?.costoUnit) || 38.42;

  return {
    lotesNac,
    ajustesNac,
    entregadosNac,
    transitoNac,
    disponibleNac: lotesNac + ajustesNac - entregadosNac - transitoNac,
    costoUnitNac,
    costoUnitTermix,
  };
}

export async function sincronizarCrmConFinanzasErp(): Promise<ResumenFinanzasSync> {
  try {
    const erpPin = process.env.ALIV_FINANZAS_PIN?.trim() || "";
    let erpDb: any = null;
    let sessionToken = "";

    // 1. Intentar autenticar y leer primero la base en vivo desde /api/load del ERP
    if (erpPin) {
      try {
        const loginRes = await fetch(`${ERP_BASE_URL}/api/auth/login`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pin: erpPin }),
          signal: AbortSignal.timeout(8000),
        });
        if (loginRes.ok) {
          const loginData = (await loginRes.json().catch(() => ({}))) as { token?: string };
          sessionToken = loginData.token || "";
        }
        const headers: Record<string, string> = {};
        if (sessionToken) headers["Authorization"] = `Bearer ${sessionToken}`;
        else headers["x-aliv-pin"] = erpPin;

        const loadRes = await fetch(`${ERP_BASE_URL}/api/load`, {
          headers,
          signal: AbortSignal.timeout(8000),
        });
        if (loadRes.ok) {
          erpDb = await loadRes.json();
        }
      } catch (e) {
        console.warn("[finanzas-sync] No se pudo cargar /api/load remoto:", e);
      }
    }

    // 2. Fallback a archivo local solo si existe en disco
    if (!erpDb && fs.existsSync(ERP_LOCAL_PATH)) {
      try {
        erpDb = JSON.parse(fs.readFileSync(ERP_LOCAL_PATH, "utf8"));
      } catch (e) {
        console.warn("[finanzas-sync] Error leyendo aliv_database.json local:", e);
      }
    }

    // A9: Si no se pudo cargar la base existente ni de /api/load ni de disco, abortar para NUNCA pisar datos
    if (!erpDb || typeof erpDb !== "object") {
      return {
        ok: false,
        actualizados: 0,
        nuevos: 0,
        totalPedidosErp: 0,
        entregadosMonto: 0,
        transitoMonto: 0,
        kardex: { lotesNac: 0, entregadosNac: 0, transitoNac: 0, disponibleNac: 0 },
        cloudSynced: false,
        error: "No se pudo leer la base existente del ERP (/api/load). Sincronización abortada por seguridad.",
      };
    }

    erpDb.pedidos = erpDb.pedidos || {};
    const kardexBase = calcularStockNacDesdeErp(erpDb);

    // 3. Obtener pedidos del CRM
    const crmOrders = await db
      .select({
        id: pedidosOrdenes.id,
        numeroOrden: pedidosOrdenes.numeroOrden,
        estado: pedidosOrdenes.estado,
        total: pedidosOrdenes.total,
        items: pedidosOrdenes.items,
        ciudad: pedidosOrdenes.ciudad,
        distrito: pedidosOrdenes.distrito,
        numeroGuia: pedidosOrdenes.numeroGuia,
        claveRecojo: pedidosOrdenes.claveRecojo,
        createdAt: pedidosOrdenes.createdAt,
        updatedAt: pedidosOrdenes.updatedAt,
        contactName: contacts.name,
        contactPhone: contacts.phone,
      })
      .from(pedidosOrdenes)
      .leftJoin(contacts, eq(pedidosOrdenes.contactId, contacts.id))
      .orderBy(desc(pedidosOrdenes.createdAt));

    let actualizados = 0;
    let nuevos = 0;
    const nowIso = new Date().toISOString();

    for (const crmOrd of crmOrders) {
      const rawNum = String(crmOrd.numeroOrden || "").replace(/\D/g, "");
      if (!rawNum) continue;
      const crmPhone = String(crmOrd.contactPhone || "").replace(/\D/g, "").slice(-9);

      // C3: Buscar por número de orden o teléfono, prefiriendo siempre el registro de Shopify (sh-...) si existe
      const matchingIds = Object.keys(erpDb.pedidos).filter((id) => {
        const p = erpDb.pedidos[id];
        if (!p || p.anulado) return false;
        const pNum = String(p.num || "").replace(/\D/g, "");
        const pPhone = String(p.wa || "").replace(/\D/g, "").slice(-9);
        return pNum === rawNum || (crmPhone.length === 9 && pPhone === crmPhone && pNum === rawNum);
      });

      const erpDocId =
        matchingIds.find((id) => id.startsWith("sh-")) || matchingIds[0] || null;

      const estadoCrm = crmOrd.estado;
      let estadoErp = "pendiente";
      if (estadoCrm === "enviado") estadoErp = "enviado";
      else if (estadoCrm === "entregado") estadoErp = "entregado";
      else if (estadoCrm === "confirmado") estadoErp = "confirmado";
      else if (estadoCrm === "cancelado") estadoErp = "cancelado";

      const fechaCreacion = (crmOrd.createdAt ? new Date(crmOrd.createdAt).toISOString() : nowIso).slice(0, 10);
      const fechaActualizacion = (crmOrd.updatedAt ? new Date(crmOrd.updatedAt).toISOString() : nowIso).slice(0, 10);

      if (erpDocId) {
        const p = erpDb.pedidos[erpDocId];
        if (p.estado !== estadoErp) {
          p.estado = estadoErp;
          if (estadoErp === "enviado") {
            p.fEnvio = p.fEnvio || fechaActualizacion;
          } else if (estadoErp === "entregado") {
            p.fEnvio = p.fEnvio || fechaCreacion;
            p.fEntrega = p.fEntrega || fechaActualizacion;
          } else if (estadoErp === "confirmado") {
            p.fConfirm = p.fConfirm || fechaActualizacion;
          } else if (estadoErp === "cancelado") {
            p.fCancel = p.fCancel || fechaActualizacion;
          }

          if (crmOrd.numeroGuia) p.guiaShalom = crmOrd.numeroGuia;
          if (crmOrd.claveRecojo) p.claveShalom = crmOrd.claveRecojo;

          p.log = p.log || [];
          p.log.push({
            t: nowIso,
            txt: `Sincronizado CRM: ${estadoErp} (Guía: ${crmOrd.numeroGuia || "-"})`,
          });
          actualizados++;
        }
      } else {
        const itemsArr = Array.isArray(crmOrd.items) ? (crmOrd.items as any[]) : [];
        const item0 = itemsArr[0] || {};
        const prodTitulo = String(item0.titulo || "").toLowerCase();
        let prodId = "NAC600";
        if (prodTitulo.includes("termix") || prodTitulo.includes("tobillera")) prodId = "TERMIX";

        const dep = crmOrd.ciudad || "Lima";
        const isLima = dep.toLowerCase().includes("lima") || dep.toLowerCase().includes("callao");
        const unidadesTotales =
          itemsArr.reduce((acc, it) => acc + (Number(it?.cantidad) || 0), 0) || 1;

        const newDocId = `crm-${rawNum}`;
        erpDb.pedidos[newDocId] = {
          num: parseInt(rawNum, 10) || rawNum,
          src: "crm-aliv",
          productoId: prodId,
          fPedido: fechaCreacion,
          cliente: crmOrd.contactName || "Cliente CRM",
          wa: crmOrd.contactPhone || "",
          dep: dep,
          ciudad: crmOrd.distrito || dep,
          zona: isLima ? "lima" : "prov",
          canal: "whatsapp",
          medio: "cod",
          unidades: unidadesTotales,
          precio: parseFloat(String(crmOrd.total)) || 0,
          costoUnit:
            prodId === "TERMIX"
              ? kardexBase.costoUnitTermix
              : kardexBase.costoUnitNac,
          fleteIda: isLima ? 12 : 16,
          fleteRetorno: 0,
          empaque: 3,
          estado: estadoErp,
          fEnvio: estadoErp === "enviado" || estadoErp === "entregado" ? fechaActualizacion : undefined,
          fEntrega: estadoErp === "entregado" ? fechaActualizacion : undefined,
          guiaShalom: crmOrd.numeroGuia || undefined,
          claveShalom: crmOrd.claveRecojo || undefined,
          creado: nowIso,
          log: [{ t: nowIso, txt: `Importado desde CRM Aliv (#${rawNum})` }],
        };
        nuevos++;
      }
    }

    // 4. Guardar en disco local Drive solo si la carpeta existe
    if (fs.existsSync("G:\\Mi unidad\\Aliv Finanzas")) {
      try {
        fs.writeFileSync(ERP_LOCAL_PATH, JSON.stringify(erpDb, null, 2), "utf8");
      } catch (e) {
        console.warn("[finanzas-sync] No se pudo escribir localmente en Drive:", e);
      }
    }

    // 5. Enviar ÚNICAMENTE { pedidos } a Render ERP Finanzas para combinar sin pisar lotes, gastos ni publicidad
    let cloudSynced = false;
    if (erpPin && (actualizados > 0 || nuevos > 0)) {
      try {
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
        };
        if (sessionToken) headers["Authorization"] = `Bearer ${sessionToken}`;
        else headers["x-aliv-pin"] = erpPin;

        const res = await fetch(`${ERP_BASE_URL}/api/save`, {
          method: "POST",
          headers,
          body: JSON.stringify({ pedidos: erpDb.pedidos }),
          signal: AbortSignal.timeout(10000),
        });
        if (res.ok) {
          cloudSynced = true;
        }
      } catch (e) {
        console.warn("[finanzas-sync] Fallo al sincronizar Render ERP en nube:", e);
      }
    }

    const all = Object.values(erpDb.pedidos) as any[];
    const entregados = all.filter((p) => p && !p.anulado && p.estado === "entregado");
    const enviados = all.filter((p) => p && !p.anulado && p.estado === "enviado");

    const totalCobrado = entregados.reduce((acc, p) => acc + (Number(p.precio) || 0), 0);
    const totalTransito = enviados.reduce((acc, p) => acc + (Number(p.precio) || 0), 0);
    const kardexFinal = calcularStockNacDesdeErp(erpDb);

    return {
      ok: true,
      actualizados,
      nuevos,
      totalPedidosErp: all.length,
      entregadosMonto: totalCobrado,
      transitoMonto: totalTransito,
      kardex: {
        lotesNac: kardexFinal.lotesNac,
        entregadosNac: kardexFinal.entregadosNac,
        transitoNac: kardexFinal.transitoNac,
        disponibleNac: kardexFinal.disponibleNac,
      },
      cloudSynced,
    };
  } catch (err: any) {
    return {
      ok: false,
      actualizados: 0,
      nuevos: 0,
      totalPedidosErp: 0,
      entregadosMonto: 0,
      transitoMonto: 0,
      kardex: { lotesNac: 0, entregadosNac: 0, transitoNac: 0, disponibleNac: 0 },
      cloudSynced: false,
      error: err.message,
    };
  }
}
