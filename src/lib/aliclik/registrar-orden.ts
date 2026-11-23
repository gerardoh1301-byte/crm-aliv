/**
 * Registro de pedidos CONTRA ENTREGA en AliClik por la API de Integraciones (23/11).
 *
 * Gerardo lo pide por WhatsApp («registra el 1171 en AliClik»); el CRM arma la orden, le
 * muestra el resumen con el costo de envío y solo la crea cuando él responde «SI 1171».
 * Los pedidos por agencia Shalom con adelanto NO pasan por aquí: siguen como siempre.
 *
 * - `POST /integration/order`: crea la orden. AliClik resuelve el distrito con lat/lng.
 * - `GET /integration/order/shipping/cost`: da el courier y el costo (obligatorios).
 * - Coordenadas: primero la ubicación que el cliente mandó por WhatsApp; si no la mandó,
 *   la dirección convertida con Google Maps (`GOOGLE_MAPS_API_KEY`).
 * - Token: `ALICLIK_COBERTURA_TOKEN` (la misma app privada de la cobertura).
 */

import type { ItemPedido } from "@modules/pedidos/tabla";

const BASE_URL_DEFECTO = "https://api.aliclik-dev.com";
const ALMACEN_ID = Number(process.env.ALICLIK_WAREHOUSE_ID) || 373;

/** Productos de Aliv en el catálogo de AliClik (almacén WANKLIC GROUP 2). */
export const PRODUCTOS_ALICLIK: Array<{ patron: RegExp; nombre: string; ean: string; sku: string }> = [
  { patron: /nac\s*-?\s*600/i, nombre: "NAC600", ean: "1400091740516", sku: "SABC1" },
  { patron: /termix|tobillera/i, nombre: "TERMIX TOBILLERA", ean: "1400035195600", sku: "SNSZ1" },
];

export interface Coordenadas {
  lat: number;
  lng: number;
  /** De dónde salieron, para decírselo a Gerardo. */
  fuente: "ubicacion_whatsapp" | "google_maps";
  /** Solo Google: ROOFTOP / RANGE_INTERPOLATED son exactas; el resto, aproximadas. */
  precision?: string;
  direccionGoogle?: string;
}

export interface CourierAliclik {
  transportId: number;
  transportName?: string;
  deliveryCost: number;
  returnCost: number;
  addDays: number;
  schedule: string | null;
  scheduleExpressStart: string | null;
  scheduleExpressEnd: string | null;
  flagDeliveryExpress: boolean;
}

export interface OrdenAliclik {
  note?: string;
  channel: string;
  delivery: number;
  customer: { name: string; lastName?: string; phone: string; address?: string };
  shipping: { address1: string; address2?: string; lat: string; lng: string; reference?: string };
  products: Array<{ ean: string; sku: string; quantity: number; price: number }>;
  courier: Omit<CourierAliclik, "transportName">;
}

// ---------------------------------------------------------------------------
// Datos del pedido (funciones puras, con pruebas)

const enPeru = (lat: number, lng: number) => lat >= -18.5 && lat <= 0 && lng >= -82 && lng <= -68;

/** Coordenadas del texto que guarda el CRM cuando el cliente manda su ubicación. */
export function coordenadasDeTexto(texto: string | null | undefined): { lat: number; lng: number } | null {
  const t = texto || "";
  const m =
    t.match(/lat\s*(-?\d{1,2}\.\d+)\s*,\s*lng\s*(-?\d{1,3}\.\d+)/i) ??
    t.match(/[?&](?:q|query|ll)=(-?\d{1,2}\.\d+),\s*(-?\d{1,3}\.\d+)/i) ??
    t.match(/@(-?\d{1,2}\.\d+),(-?\d{1,3}\.\d+)/);
  if (!m) return null;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  return enPeru(lat, lng) ? { lat, lng } : null;
}

/** Separa «Av. X 123 (Ref: frente al parque)» en dirección y referencia. */
export function separarReferencia(direccion: string | null | undefined): { direccion: string; referencia: string } {
  const d = (direccion || "").trim();
  const m = d.match(/^(.*?)\s*[(\-–,]?\s*\bref(?:erencia)?\b\.?\s*:?\s*(.+?)\)?\s*$/i);
  if (!m || !m[1].trim()) return { direccion: d, referencia: "" };
  return { direccion: m[1].replace(/[\s,(–-]+$/, "").trim(), referencia: m[2].trim() };
}

/** Celular peruano con código de país, sin «+»: 51 + 9 dígitos. */
export function telefonoAliclik(phone: string | null | undefined): string | null {
  const d = (phone || "").replace(/\D/g, "");
  const nueve = d.length === 11 && d.startsWith("51") ? d.slice(2) : d.length === 9 ? d : null;
  return nueve && nueve.startsWith("9") ? `51${nueve}` : null;
}

export function separarNombre(nombre: string | null | undefined): { name: string; lastName: string } {
  const partes = (nombre || "").trim().split(/\s+/).filter(Boolean);
  if (partes.length <= 1) return { name: partes[0] || "", lastName: "" };
  const corte = partes.length >= 4 ? 2 : 1;
  return { name: partes.slice(0, corte).join(" "), lastName: partes.slice(corte).join(" ") };
}

/**
 * Productos para AliClik con precios que suman el total del pedido (lo que cobra el
 * motorizado). Si un ítem no es de AliClik, lo devuelve en `desconocidos`.
 */
export function productosParaAliclik(
  items: ItemPedido[],
  total: number
): { productos: OrdenAliclik["products"]; desconocidos: string[]; cobrar: number } {
  const productos: OrdenAliclik["products"] = [];
  const desconocidos: string[] = [];
  const brutos: number[] = [];
  for (const it of items || []) {
    const ref = PRODUCTOS_ALICLIK.find((p) => p.patron.test(`${it.titulo} ${it.sku}`));
    const cantidad = Math.max(1, Math.round(Number(it.cantidad) || 1));
    if (!ref) {
      desconocidos.push(it.titulo || it.sku || "producto sin nombre");
      continue;
    }
    const existente = productos.find((p) => p.ean === ref.ean);
    const bruto = (Number(it.precioUnitario) || 0) * cantidad;
    if (existente) {
      existente.quantity += cantidad;
      brutos[productos.indexOf(existente)] += bruto;
    } else {
      productos.push({ ean: ref.ean, sku: ref.sku, quantity: cantidad, price: 0 });
      brutos.push(bruto);
    }
  }
  if (!productos.length) return { productos, desconocidos, cobrar: 0 };

  // Reparte el total del pedido (con descuentos de pack) en proporción a cada línea.
  const sumaBruta = brutos.reduce((a, b) => a + b, 0);
  let restante = Math.round(total * 100);
  productos.forEach((p, i) => {
    const ultimo = i === productos.length - 1;
    const parte = ultimo
      ? restante
      : Math.round(sumaBruta > 0 ? (total * 100 * brutos[i]) / sumaBruta : (total * 100) / productos.length);
    restante -= parte;
    p.price = Math.round(parte / p.quantity) / 100;
  });
  const cobrar = Math.round(productos.reduce((a, p) => a + p.price * p.quantity, 0) * 100) / 100;
  return { productos, desconocidos, cobrar };
}

/** El courier estándar más barato (el express exige estar dentro de su horario). */
export function elegirCourier(couriers: unknown[]): CourierAliclik | null {
  const lista = (Array.isArray(couriers) ? couriers : [])
    .filter((c): c is Record<string, any> => Boolean(c) && typeof c === "object")
    .map((c) => ({
      transportId: Number(c.transportId),
      transportName: typeof c.transportName === "string" ? c.transportName : undefined,
      deliveryCost: Number(c.deliveryCost) || 0,
      returnCost: Number(c.returnCost) || 0,
      addDays: Number(c.addDays) || 0,
      schedule: typeof c.schedule === "string" ? c.schedule : null,
      scheduleExpressStart: typeof c.scheduleExpressStart === "string" ? c.scheduleExpressStart : null,
      scheduleExpressEnd: typeof c.scheduleExpressEnd === "string" ? c.scheduleExpressEnd : null,
      flagDeliveryExpress: c.flagDeliveryExpress === true,
    }))
    .filter((c) => Number.isFinite(c.transportId));
  const estandar = lista.filter((c) => !c.flagDeliveryExpress);
  const candidatos = estandar.length ? estandar : lista;
  return candidatos.sort((a, b) => a.deliveryCost - b.deliveryCost)[0] ?? null;
}

/**
 * «registra 1171 en aliclik», «sube el #1171 a AliClik», «crear orden aliclik LEG-1066»:
 * devuelve el pedido. Solo órdenes que EMPIEZAN con el verbo (una pregunta como «¿ya está
 * registrado el 1171 en aliclik?» no cuenta).
 */
export function pedidoParaRegistroAliclik(texto: string | null | undefined): string | null {
  const t = (texto || "").trim().toLowerCase();
  if (!/\bali\s*cli(c|k)k?\b/.test(t)) return null;
  if (!/^(por favor\s+|porfa\s+)?(reg[ií]str(a|ar|alo|ame)|sub(e|ir|elo)|cre(a|ar)|carg(a|ar|alo)|ingres(a|ar|alo)|pas(a|ar|alo))\b/.test(t)) return null;
  const sinMarca = t.replace(/\bali\s*cli(c|k)k?\b/g, " ");
  const m =
    sinMarca.match(/\b([a-z]{2,5}-\d{2,6})\b/i) ?? sinMarca.match(/\b(9\d{8})\b/) ?? sinMarca.match(/#?\b(\d{3,6})\b/);
  return m ? m[1].toUpperCase() : null;
}

/** Marca que se deja en las notas del pedido al registrarlo (evita registrarlo dos veces). */
export function ordenAliclikRegistrada(notas: string | null | undefined): string | null {
  return (notas || "").match(/\[ALICLIK_ORDEN:([^\]]+)\]/i)?.[1]?.trim() ?? null;
}

// ---------------------------------------------------------------------------
// Llamadas externas

function token(): string {
  return (process.env.ALICLIK_COBERTURA_TOKEN ?? "").replace(/^Bearer\s+/i, "").trim();
}

function baseUrl(): string {
  return (process.env.ALICLIK_INTEGRATION_URL || BASE_URL_DEFECTO).replace(/\/+$/, "");
}

function cabeceras(): Record<string, string> {
  return {
    Authorization: `Bearer ${token()}`,
    "Content-Type": "application/json",
    "x-aliclik-origin": "aliclik-web",
  };
}

function mensajeError(body: any, status: number): string {
  const m = body?.message;
  if (Array.isArray(m)) return m.join("; ");
  if (typeof m === "string") return status === 401 ? `${m} (revisa ALICLIK_COBERTURA_TOKEN)` : m;
  return `HTTP ${status}`;
}

/** Dirección → coordenadas con la Geocoding API de Google (solo Perú). */
export async function geocodificarDireccion(partes: {
  direccion: string;
  distrito?: string | null;
  ciudad?: string | null;
}): Promise<{ ok: true; coordenadas: Coordenadas } | { ok: false; error: string }> {
  const clave = (process.env.GOOGLE_MAPS_API_KEY ?? "").trim();
  if (!clave) return { ok: false, error: "falta GOOGLE_MAPS_API_KEY" };
  const texto = [partes.direccion, partes.distrito, partes.ciudad || "Lima", "Perú"].filter(Boolean).join(", ");
  const url =
    "https://maps.googleapis.com/maps/api/geocode/json" +
    `?address=${encodeURIComponent(texto)}&region=pe&components=country:PE&language=es&key=${encodeURIComponent(clave)}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    const body = (await res.json().catch(() => null)) as Record<string, any> | null;
    const r = body?.results?.[0];
    if (!res.ok || body?.status !== "OK" || !r) {
      return { ok: false, error: `Google Maps no encontró la dirección (${body?.status ?? res.status})` };
    }
    const lat = Number(r.geometry?.location?.lat);
    const lng = Number(r.geometry?.location?.lng);
    if (!enPeru(lat, lng)) return { ok: false, error: "Google Maps devolvió un punto fuera de Perú" };
    return {
      ok: true,
      coordenadas: {
        lat,
        lng,
        fuente: "google_maps",
        precision: String(r.geometry?.location_type ?? ""),
        direccionGoogle: typeof r.formatted_address === "string" ? r.formatted_address : undefined,
      },
    };
  } catch (err) {
    return { ok: false, error: `Google Maps no respondió (${err instanceof Error ? err.message : "error"})` };
  }
}

export async function cotizarEnvio(
  lat: number,
  lng: number
): Promise<{ ok: true; courier: CourierAliclik; distrito?: string } | { ok: false; error: string }> {
  if (!token()) return { ok: false, error: "falta ALICLIK_COBERTURA_TOKEN" };
  const url = `${baseUrl()}/integration/order/shipping/cost?warehouseId=${ALMACEN_ID}&lat=${lat}&lng=${lng}`;
  try {
    const res = await fetch(url, { headers: cabeceras(), signal: AbortSignal.timeout(8000) });
    const body = (await res.json().catch(() => null)) as Record<string, any> | null;
    if (!res.ok || !body) return { ok: false, error: mensajeError(body, res.status) };
    const courier = elegirCourier(body.couriers);
    if (!courier) return { ok: false, error: "AliClik no tiene courier para ese punto" };
    const u = body.ubigeo ?? {};
    const distrito = [u.district?.name, u.province?.name].filter(Boolean).join(", ") || undefined;
    return { ok: true, courier, distrito };
  } catch (err) {
    return { ok: false, error: `AliClik no respondió (${err instanceof Error ? err.message : "error"})` };
  }
}

export async function crearOrdenAliclik(
  orden: OrdenAliclik
): Promise<{ ok: true; orderNumber: string } | { ok: false; error: string }> {
  if (!token()) return { ok: false, error: "falta ALICLIK_COBERTURA_TOKEN" };
  try {
    const res = await fetch(`${baseUrl()}/integration/order`, {
      method: "POST",
      headers: cabeceras(),
      body: JSON.stringify(orden),
      signal: AbortSignal.timeout(15000),
    });
    const body = (await res.json().catch(() => null)) as Record<string, any> | null;
    const orderNumber = body?.orderNumber ?? body?.data?.orderNumber;
    if (res.ok && typeof orderNumber === "string" && orderNumber) return { ok: true, orderNumber };
    return { ok: false, error: mensajeError(body, res.status) };
  } catch (err) {
    // Sin respuesta no sabemos si se creó: se avisa para revisar antes de reintentar.
    return { ok: false, error: `AliClik no respondió (${err instanceof Error ? err.message : "error"}); revisa en AliClik si la orden se creó antes de reintentar` };
  }
}
