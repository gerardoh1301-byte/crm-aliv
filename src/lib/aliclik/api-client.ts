/**
 * Cliente oficial para Aliclik REST API Logistics & Fulfillment
 * Permite registrar pedidos en modalidad:
 * 1. Pago Anticipado Agencia con Alidriver + Servicio completo ("Lo hace AliClik", rotulado y guía en Shalom PRO)
 * 2. Contra Entrega a Provincia / Domicilio para las ciudades con cobertura.
 */

const BASE_URL = "https://aliclik-api-release-f6985904c9e2.herokuapp.com";

// Credenciales fijas de la tienda ALIVPERU (ERGONOVA / ID 57390)
const COMPANY_ID = 57390;
const USER_ID = 45168;
const COMPANY_PREFIX = "ERG";
const REFRESH_TOKEN =
  process.env.ALICLIK_REFRESH_TOKEN ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOjQ1MTY4LCJjb21wYW55SWQiOjU3MzkwLCJpYXQiOjE3OTQ5NDExMTEsImV4cCI6MTc5NTAyNzUxMX0.Eb7zQ7QWVqIuX9u2QFb5hHPs-TNXfkPKngxN3sIHqTs";

let cachedAccessToken: string | null = null;
let tokenExpiresAt = 0;

/**
 * Obtiene un Access Token vigente de la API de AliClik usando el Refresh Token.
 */
export async function getAliclikAccessToken(): Promise<string> {
  const now = Date.now();
  if (cachedAccessToken && now < tokenExpiresAt - 60000) {
    return cachedAccessToken;
  }

  const res = await fetch(`${BASE_URL}/auth/refresh`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://admin.aliclik.app",
      Referer: "https://admin.aliclik.app/",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      "X-Platform": "web",
      "X-Device": "Chrome/Windows",
      "x-aliclik-origin": "aliclik-web",
      "X-Device-Id": "0a9b5a6e-9dee-4ce4-b246-732988e4497d",
    },
    body: JSON.stringify({ refreshToken: REFRESH_TOKEN }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Error al autenticar con AliClik (${res.status}): ${errText}`);
  }

  const data = await res.json();
  cachedAccessToken = data.accessToken;
  // Expira en 15 minutos (900s)
  tokenExpiresAt = now + 14 * 60 * 1000;
  return cachedAccessToken!;
}

export interface CrearOrdenAgenciaParams {
  clienteNombre: string;
  clienteTelefono: string;
  clienteDni?: string;
  departamento?: string;
  provincia?: string;
  distrito?: string;
  agenciaShalomNombre: string; // ej. "SHALOM - PISCO CENTRO"
  productos: Array<{
    nombre: string;
    cantidad: number;
    precioUnitario: number;
  }>;
  total: number;
  nota?: string;
}

/**
 * Registra un pedido en AliClik con la opción:
 * - "¿Quién lleva mi paquete a Shalom u Olva?": Courier Alidriver (Recoge y lleva a la agencia)
 * - "¿Quién genera la guía?": Lo hace AliClik (Servicio completo)
 */
export async function crearOrdenAgenciaServicioCompleto(params: CrearOrdenAgenciaParams) {
  const token = await getAliclikAccessToken();
  const orderNumber = `${COMPANY_PREFIX}${String(Date.now()).slice(-7)}`;

  // Formato de productos para AliClik
  const productDetail = params.productos
    .map((p) => `${p.cantidad} ${p.nombre}`)
    .join(", ");

  const orderDetails = params.productos.map((p) => ({
    price: p.precioUnitario,
    quantity: p.cantidad,
    subtotal: p.cantidad * p.precioUnitario,
    skuId: 1, // SKU general
    warehouseId: 23, // WANKLIC GROUP
    companyId: COMPANY_ID,
    dropPrice: 0,
    storeCentralProductId: null,
  }));

  const payload = {
    assignedSellerId: void 0,
    orderNumber,
    userId: USER_ID,
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
    warehouseName: "WANKLIC GROUP 2",
    warehouseId: 23,
    customer: {
      companyId: COMPANY_ID,
      name: params.clienteNombre,
      lastName: "",
      phone: params.clienteTelefono.replace(/\D/g, ""),
    },
    orderDetails,
    shipping: {
      address1: params.agenciaShalomNombre,
      address2: "",
      reference: params.agenciaShalomNombre,
      countryName: "Perú",
      countryCode: "PER",
      firstName: params.clienteNombre,
      departmentName: params.departamento || null,
      provinceName: params.provincia || null,
      districtName: params.distrito || null,
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
      Origin: "https://admin.aliclik.app",
      Referer: "https://admin.aliclik.app/",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      "X-Platform": "web",
      "X-Device": "Chrome/Windows",
      "x-aliclik-origin": "aliclik-web",
      "X-Device-Id": "0a9b5a6e-9dee-4ce4-b246-732988e4497d",
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
    result,
  };
}
