/**
 * Módulo de Sincronización Automática CRM Aliv -> Aliv Finanzas ERP & Kardex
 * Sincroniza pedidos, estados de entrega, kardex de unidades e ingresos en caja.
 */

import "server-only";
import fs from "node:fs";
import { db } from "@/db";
import { contacts, deals } from "@/db/schema";
import { pedidosOrdenes } from "../../../modules/pedidos/tabla";
import { desc, eq } from "drizzle-orm";

const ERP_LOCAL_PATH = "G:\\Mi unidad\\Aliv Finanzas\\aliv_database.json";
const ERP_RENDER_URL = "https://aliv-finanzas-erp.onrender.com/api/save";
const ERP_PIN = process.env.ADMIN_PIN || "aliv2026";

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

export async function sincronizarCrmConFinanzasErp(): Promise<ResumenFinanzasSync> {
  try {
    let erpDb: any = { pedidos: {}, lotes: {}, gastos: {}, publicidad: {} };

    // 1. Cargar base local de Drive si existe
    if (fs.existsSync(ERP_LOCAL_PATH)) {
      try {
        erpDb = JSON.parse(fs.readFileSync(ERP_LOCAL_PATH, "utf8"));
      } catch (e) {
        console.warn("[finanzas-sync] Error leyendo aliv_database.json local:", e);
      }
    }

    erpDb.pedidos = erpDb.pedidos || {};

    // 2. Obtener pedidos del CRM
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

      let erpDocId = Object.keys(erpDb.pedidos).find((id) => {
        const p = erpDb.pedidos[id];
        return String(p.num).replace(/\D/g, "") === rawNum;
      });

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
        const item0 = (crmOrd.items && crmOrd.items[0]) || {};
        const prodTitulo = (item0.titulo || "").toLowerCase();
        let prodId = "NAC600";
        if (prodTitulo.includes("termix") || prodTitulo.includes("tobillera")) prodId = "TERMIX";

        const dep = crmOrd.ciudad || "Lima";
        const isLima = dep.toLowerCase().includes("lima") || dep.toLowerCase().includes("callao");

        erpDocId = `crm-${rawNum}`;
        erpDb.pedidos[erpDocId] = {
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
          unidades: item0.cantidad || 1,
          precio: parseFloat(String(crmOrd.total)) || 0,
          costoUnit: prodId === "TERMIX" ? 32 : 17,
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

    // 3. Guardar en disco local Drive si existe
    if (fs.existsSync("G:\\Mi unidad\\Aliv Finanzas")) {
      try {
        fs.writeFileSync(ERP_LOCAL_PATH, JSON.stringify(erpDb, null, 2), "utf8");
      } catch (e) {
        console.warn("[finanzas-sync] No se pudo escribir localmente en Drive:", e);
      }
    }

    // 4. Enviar a Render ERP Finanzas (Nube)
    let cloudSynced = false;
    try {
      const res = await fetch(ERP_RENDER_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-aliv-pin": ERP_PIN,
        },
        body: JSON.stringify(erpDb),
        signal: AbortSignal.timeout(10000),
      });
      if (res.ok) {
        cloudSynced = true;
      }
    } catch (e) {
      console.warn("[finanzas-sync] Fallo al sincronizar Render ERP en nube:", e);
    }

    // Métricas finales
    const all = Object.values(erpDb.pedidos) as any[];
    const entregados = all.filter((p) => p.estado === "entregado");
    const enviados = all.filter((p) => p.estado === "enviado");

    const totalCobrado = entregados.reduce((acc, p) => acc + (p.precio || 0), 0);
    const totalTransito = enviados.reduce((acc, p) => acc + (p.precio || 0), 0);

    const entregadosNac = entregados.filter((p) => p.productoId === "NAC600").reduce((acc, p) => acc + (p.unidades || 1), 0);
    const transitoNac = enviados.filter((p) => p.productoId === "NAC600").reduce((acc, p) => acc + (p.unidades || 1), 0);

    return {
      ok: true,
      actualizados,
      nuevos,
      totalPedidosErp: all.length,
      entregadosMonto: totalCobrado,
      transitoMonto: totalTransito,
      kardex: {
        lotesNac: 200,
        entregadosNac,
        transitoNac,
        disponibleNac: 200 - entregadosNac - transitoNac,
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
      kardex: { lotesNac: 200, entregadosNac: 0, transitoNac: 0, disponibleNac: 200 },
      cloudSynced: false,
      error: err.message,
    };
  }
}
