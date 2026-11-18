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

/**
 * Calcula la fecha de envío más cercana activa para Alidriver / Shalom Drop.
 * Horario de corte Drop Shalom en Almacén WANKLIC GROUP 2: 12:00h (mediodía hora Perú).
 * Si la hora actual en Lima es >= 12:00 o domingo, avanza al día hábil siguiente en formato DD/MM/YYYY.
 */
export function calcularFechaEnvioShalom(): string {
  const ahora = new Date();
  // Hora local Perú (UTC-5)
  const offsetPeru = -5 * 60;
  const fechaPeru = new Date(
    ahora.getTime() + (ahora.getTimezoneOffset() + offsetPeru) * 60000
  );
  const hora = fechaPeru.getHours();

  const fechaEnvio = new Date(fechaPeru);
  if (hora >= 12) {
    fechaEnvio.setDate(fechaEnvio.getDate() + 1);
  }
  // Si cae domingo (0), pasar a lunes
  if (fechaEnvio.getDay() === 0) {
    fechaEnvio.setDate(fechaEnvio.getDate() + 1);
  }

  const dd = String(fechaEnvio.getDate()).padStart(2, "0");
  const mm = String(fechaEnvio.getMonth() + 1).padStart(2, "0");
  const yyyy = fechaEnvio.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

/**
 * Normaliza y resuelve la denominación oficial de la agencia Shalom y su DropShalomId
 * para AliClik y Shalom PRO a partir de nombres coloquiales o referencias.
 */
export function normalizarAgenciaShalomAliclik(
  texto: string,
  depto?: string | null
): {
  dropShalomId: number | null;
  agencyDestination: string;
  agencyAddress: string;
  departmentName: string;
  provinceName: string;
  districtName: string;
} {
  const norm = (texto || "").toLowerCase().trim();
  const normDepto = (depto || "").toLowerCase().trim();

  // Caso especial crítico: Ica Av. Cutervo -> Denominación oficial Shalom: ICA AV. JJ ELIAS (DropShalomId: 405)
  if (
    (norm.includes("cutervo") || norm.includes("elias")) &&
    (norm.includes("ica") || normDepto.includes("ica"))
  ) {
    return {
      dropShalomId: 405,
      agencyDestination: "ICA / ICA / ICA / ICA AV. JJ ELIAS",
      agencyAddress:
        "MANZANA B, SUB-LOTE 02 DEL FUNDO LA PALMA ICA, REF. CRUCE DE AV. CUTERVO CON AV. J.J ELIAS",
      departmentName: "ICA",
      provinceName: "ICA",
      districtName: "ICA",
    };
  }

  // Huancayo Jr. Ica (DropShalomId: 2147)
  if (
    norm.includes("huancayo") ||
    (norm.includes("ica") && (normDepto.includes("huancayo") || normDepto.includes("junin")))
  ) {
    return {
      dropShalomId: 2147,
      agencyDestination: "JUNIN / HUANCAYO / HUANCAYO / HUANCAYO JR. ICA",
      agencyAddress:
        "JR. ICA Nº 1143 - HUANCAYO, REFERENCIA: ENTRE EL JR. ICA Y EL JR. TACNA",
      departmentName: "JUNIN",
      provinceName: "HUANCAYO",
      districtName: "HUANCAYO",
    };
  }

  // Pisco Centro
  if (norm.includes("pisco")) {
    return {
      dropShalomId: 404,
      agencyDestination: "ICA / PISCO / PISCO / PISCO CENTRO",
      agencyAddress: "AV. SAN MARTIN 450 PISCO",
      departmentName: "ICA",
      provinceName: "PISCO",
      districtName: "PISCO",
    };
  }

  // Chincha
  if (norm.includes("chincha")) {
    return {
      dropShalomId: 406,
      agencyDestination: "ICA / CHINCHA / CHINCHA ALTA / CHINCHA",
      agencyAddress: "AV. OSCAR R. BENAVIDES 620",
      departmentName: "ICA",
      provinceName: "CHINCHA",
      districtName: "CHINCHA ALTA",
    };
  }

  // Arequipa Parra
  if (norm.includes("arequipa") && (norm.includes("parra") || norm.includes("centro"))) {
    return {
      dropShalomId: 410,
      agencyDestination: "AREQUIPA / AREQUIPA / AREQUIPA / AV PARRA 379",
      agencyAddress: "AV. PARRA 379 AREQUIPA",
      departmentName: "AREQUIPA",
      provinceName: "AREQUIPA",
      districtName: "AREQUIPA",
    };
  }

  // Fallback genérico manteniendo el texto recibido
  return {
    dropShalomId: null,
    agencyDestination: texto,
    agencyAddress: texto,
    departmentName: depto || "PROVINCIA",
    provinceName: depto || "PROVINCIA",
    districtName: depto || "PROVINCIA",
  };
}

export interface CrearOrdenAgenciaParams {
  clienteNombre: string;
  clienteTelefono: string;
  clienteDni?: string;
  departamento?: string;
  provincia?: string;
  distrito?: string;
  agenciaShalomNombre: string; // ej. "ICA / ICA / ICA / ICA AV. JJ ELIAS"
  agenciaShalomDireccion?: string;
  dropShalomId?: number;
  fechaEnvio?: string; // ej. "19/11/2026"
  tipoMercancia?: string; // ej. "Caja Paquete XS"
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

  // 1. Normalizar agencia Shalom e ID oficial
  const agenciaNormalizada = normalizarAgenciaShalomAliclik(
    params.agenciaShalomNombre,
    params.departamento
  );
  const dropShalomIdFinal = params.dropShalomId || agenciaNormalizada.dropShalomId || 405;
  const agenciaDestinoFinal = agenciaNormalizada.agencyDestination;
  const agenciaDireccionFinal =
    params.agenciaShalomDireccion || agenciaNormalizada.agencyAddress;
  const departamentoFinal = params.departamento || agenciaNormalizada.departmentName;
  const provinciaFinal = params.provincia || agenciaNormalizada.provinceName;
  const distritoFinal = params.distrito || agenciaNormalizada.districtName;

  // 2. Fecha de envío más cercana activa (si no se proporciona)
  const fechaEnvioTexto = params.fechaEnvio || calcularFechaEnvioShalom();
  // Formato ISO requerido por el backend de AliClik
  let scheduleDateIso = fechaEnvioTexto;
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(fechaEnvioTexto)) {
    const [d, m, y] = fechaEnvioTexto.split("/");
    scheduleDateIso = `${y}-${m}-${d}T00:00:00.000Z`;
  } else if (/^\d{4}-\d{2}-\d{2}$/.test(fechaEnvioTexto)) {
    scheduleDateIso = `${fechaEnvioTexto}T00:00:00.000Z`;
  }

  // 3. Tipo de mercancía (por defecto "Caja Paquete XS" para frascos NAC600)
  const tipoMercanciaFinal = params.tipoMercancia || "Caja Paquete XS";

  // 4. Calcular cantidades y subtotales asegurando que sumen exactamente el total
  const cantidadTotal = params.productos.reduce((acc, p) => acc + (p.cantidad || 1), 0);
  const precioUnitarioProrrateado =
    cantidadTotal > 0
      ? Math.round((params.total / cantidadTotal) * 100) / 100
      : params.total;

  // Formato descriptivo de productos para AliClik (ej. "3 NAC600")
  const productDetail = params.productos
    .map((p) => `${p.cantidad} ${p.nombre}`)
    .join(", ");

  // Mapear cada producto con su SKU y Almacén oficial verificado en AliClik
  let subtotalAcumulado = 0;
  const orderDetails = params.productos.map((p, idx) => {
    const info = resolverSkuAliclik(p.nombre);
    const esUltimo = idx === params.productos.length - 1;
    const subtotal = esUltimo
      ? params.total - subtotalAcumulado
      : Math.round(p.cantidad * precioUnitarioProrrateado * 100) / 100;
    subtotalAcumulado += subtotal;

    return {
      price: precioUnitarioProrrateado,
      quantity: p.cantidad,
      subtotal,
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
    note:
      params.nota ||
      `Pedido registrado automáticamente desde CRM Aliv - Servicio Completo Shalom (${tipoMercanciaFinal})`,
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
    merchandiseShalom: tipoMercanciaFinal, // "Caja Paquete XS" en raíz
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
      scheduleDate: scheduleDateIso, // Formato ISO requerido por el backend de AliClik
      DropShalomId: dropShalomIdFinal, // ID numérico de la agencia (ej. 405)
      agencyDestination: String(dropShalomIdFinal), // En AliClik agencyDestination almacena el ID como string ('405')
      agencySelected: agenciaDestinoFinal, // Nombre oficial (ej. 'ICA / ICA / ICA / ICA AV. JJ ELIAS')
      agencyAddress: agenciaDireccionFinal, // Dirección oficial del Fundo La Palma
      addressPickUp: agenciaDestinoFinal,
      address1: agenciaDestinoFinal,
      address2: "",
      reference: agenciaDireccionFinal,
      countryName: "Perú",
      countryCode: "PER",
      firstName: params.clienteNombre,
      firstLastName: "",
      secondLastName: "",
      departmentName: departamentoFinal,
      departmentCode: null,
      provinceName: provinciaFinal,
      provinceCode: null,
      districtName: distritoFinal,
      districtCode: null,
      shippingByAgency: true,
      agencyName: "SHALOM",
      contactName: params.clienteNombre,
      contactPhone: params.clienteTelefono.replace(/\D/g, ""),
      contactDocumenType: "DNI",
      contactDocumentNumber: params.clienteDni || "",
      shippingCost: 0,
      senderContact: params.clienteDni || "",
      senderPhone: params.clienteTelefono.replace(/\D/g, ""),
      merchandiseShalom: tipoMercanciaFinal, // "Caja Paquete XS" dentro de shipping
      keyCode: "0000",
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
    fechaEnvio: fechaEnvioTexto,
    tipoMercancia: tipoMercanciaFinal,
    agenciaDestino: agenciaDestinoFinal,
    result,
  };
}
