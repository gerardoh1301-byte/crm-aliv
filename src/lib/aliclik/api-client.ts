/**
 * Cliente oficial para Aliclik REST API Logistics & Fulfillment
 * Permite registrar pedidos en modalidad:
 * 1. Pago Anticipado Agencia con Alidriver + Servicio completo ("Lo hace AliClik", rotulado y guía en Shalom PRO)
 * 2. Contra Entrega a Provincia / Domicilio para las ciudades con cobertura.
 */

import { db } from "@/db";
import { crmSettings } from "@/db/schema";
import { eq } from "drizzle-orm";
import crypto from "crypto";

const BASE_URL = "https://aliclik-api-release-f6985904c9e2.herokuapp.com";

// Credenciales oficiales de la tienda ALIVPERU / ERGONOVA
export const ALICLIK_COMPANY_ID = 57390;
export const ALICLIK_USER_ID = 45168;
export const ALICLIK_COMPANY_PREFIX = "ERG";

// Token permanente de integración oficial de ERGONOVA en AliClik
const TOKEN_INTEGRATION_FALLBACK =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6NDUxNjgsImVtYWlsIjoiR0VSQVJET0gxMzAxIiwiY29tcGFueUlkIjo1NzM5MCwiY29kZSI6IkVSRyIsImNvbXBhbnlOYW1lIjoiRVJHT05PVkEiLCJjb21wYW55UGFyZW50SWQiOjEsImNvdW50cnkiOm51bGwsImN1cnJlbmN5Ijp7ImNvZGUiOiJQRU4iLCJuYW1lIjoiU09MRVMiLCJzeW1ib2wiOiJTLyJ9LCJpYXQiOjE3ODI4NTkyMjJ9.XWZ4w4IWfDRHlK_fNIVH7kVsyOMgXQu62GOJ-c_L-hw";

// Catálogo verificado de SKUs y Almacén en AliClik para ALIVPERU
export const ALICLIK_CATALOG = {
  NAC600: {
    skuId: 28460,
    productId: 22876,
    sku: "SABC1",
    warehouseId: 373,
    warehouseName: "WANKLIC GROUP 2",
    companyId: ALICLIK_COMPANY_ID,
  },
  TERMIX: {
    skuId: 28461,
    productId: 22877,
    sku: "SNSZ1",
    warehouseId: 373,
    warehouseName: "WANKLIC GROUP 2",
    companyId: ALICLIK_COMPANY_ID,
  },
};

export async function resolveAliclikToken(): Promise<string> {
  if (process.env.ALICLIK_TOKEN_INTEGRATION?.trim()) {
    return process.env.ALICLIK_TOKEN_INTEGRATION.trim();
  }
  try {
    const [row] = await db
      .select()
      .from(crmSettings)
      .where(eq(crmSettings.key, "aliclik.token_integration"))
      .limit(1);
    if (typeof row?.value === "string" && row.value.trim()) {
      return row.value.trim();
    }
  } catch (err) {
    console.warn("No se pudo leer aliclik.token_integration de crm_settings:", err);
  }
  return TOKEN_INTEGRATION_FALLBACK;
}

export interface CrearOrdenAgenciaParams {
  clienteNombre: string;
  clienteTelefono: string;
  clienteDni?: string;
  departamento?: string;
  provincia?: string;
  distrito?: string;
  agenciaShalomNombre: string; // ej. "Shalom Ica - Av. Cutervo"
  productos: Array<{
    nombre: string;
    cantidad: number;
    precioUnitario: number;
  }>;
  total: number;
  nota?: string;
}

/**
 * Resuelve el SKU y almacén oficial en AliClik según el nombre del producto
 */
export function resolverSkuAliclik(nombreProducto: string) {
  const norm = nombreProducto.toLowerCase();
  if (norm.includes("termix") || norm.includes("tobill")) {
    return ALICLIK_CATALOG.TERMIX;
  }
  // Default a NAC600
  return ALICLIK_CATALOG.NAC600;
}

/**
 * Registra un pedido en AliClik con la opción:
 * - "¿Quién lleva mi paquete a Shalom u Olva?": Courier Alidriver (Recoge y lleva a la agencia)
 * - "¿Quién genera la guía?": Lo hace AliClik (Servicio completo)
 */
export async function crearOrdenAgenciaServicioCompleto(params: CrearOrdenAgenciaParams) {
  const token = await resolveAliclikToken();
  const orderNumber = `${ALICLIK_COMPANY_PREFIX}${String(Date.now()).slice(-7)}`;
  const idempotencyKey = crypto.randomUUID();

  // Formato descriptivo de productos para AliClik
  const productDetail = params.productos
    .map((p) => `${p.cantidad} ${p.nombre}`)
    .join(", ");

  // Mapear cada producto con su SKU y Almacén oficial verificado en AliClik
  const orderDetails = params.productos.map((p) => {
    const info = resolverSkuAliclik(p.nombre);
    return {
      price: p.precioUnitario,
      quantity: p.cantidad,
      subtotal: p.cantidad * p.precioUnitario,
      skuId: info.skuId,
      warehouseId: info.warehouseId,
      companyId: info.companyId,
      dropPrice: 0,
      storeCentralProductId: null,
    };
  });

  const primarySku = resolverSkuAliclik(params.productos[0]?.nombre || "NAC600");

  const payload = {
    assignedSellerId: void 0,
    orderNumber,
    userId: ALICLIK_USER_ID,
    total: params.total,
    prefixPhone: "51",
    note: params.nota || `Pedido registrado automáticamente desde CRM Aliv - Servicio Completo Shalom`,
    channel: "WhatsApp CRM",
    status: "PENDING_DELIVERY",
    commissionCod: 0,
    callStatus: "CONFIRMED",
    flagDeliveryExpress: false,
    additionalCostExpress: 0,
    currency: { code: "PEN", name: "SOLES", symbol: "S/" },
    isOrderAgency: true,
    trackingStatus: "TO_PREPARE",
    paymentType: "P",
    shippingCost: 0,
    managementType: "PARTNER",
    payAgency: 2, // Pago en destino o agencia
    flagAliShalom: true, // "Lo hace AliClik (Servicio completo)" -> Generan guía y rótulo Shalom PRO
    flagCourierToAgency: true, // "Courier Alidriver" -> Recoge en almacén y lleva a Shalom
    productDetail,
    warehouseName: primarySku.warehouseName,
    warehouseId: primarySku.warehouseId,
    customer: {
      companyId: ALICLIK_COMPANY_ID,
      name: params.clienteNombre,
      lastName: "",
      phone: params.clienteTelefono.replace(/\D/g, ""),
    },
    orderDetails,
    preOrderHistory: {},
    shipping: {
      address1: params.agenciaShalomNombre,
      address2: "",
      reference: params.agenciaShalomNombre,
      countryName: "Perú",
      countryCode: "PER",
      firstName: params.clienteNombre,
      firstLastName: "",
      secondLastName: "",
      departmentName: params.departamento || null,
      departmentCode: null,
      provinceName: params.provincia || null,
      provinceCode: null,
      districtName: params.distrito || null,
      districtCode: null,
      shippingByAgency: true,
      agencyName: "SHALOM",
      agencyAddress: params.agenciaShalomNombre,
      contactName: params.clienteNombre,
      contactPhone: params.clienteTelefono.replace(/\D/g, ""),
      contactDocumenType: "DNI",
      contactDocumentNumber: params.clienteDni || "",
      addressPickUp: params.agenciaShalomNombre,
      shippingCost: 0,
      senderContact: params.clienteDni || "",
      senderPhone: params.clienteTelefono.replace(/\D/g, ""),
    },
  };

  const res = await fetch(`${BASE_URL}/order/agency/create`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "idempotency-key": idempotencyKey,
      idempotencyKey: idempotencyKey,
      Origin: "https://admin.aliclik.app",
      Referer: "https://admin.aliclik.app/",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      "X-Platform": "web",
      "X-Device": "Chrome/Windows",
      "x-aliclik-origin": "aliclik-web",
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Error creando orden en AliClik (${res.status}): ${err}`);
  }

  const result = await res.json();
  return {
    ok: true,
    orderNumber,
    id: result?.id,
    result,
  };
}
