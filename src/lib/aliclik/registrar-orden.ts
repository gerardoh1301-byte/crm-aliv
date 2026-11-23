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

/** Nombre completo tal cual lo tiene el CRM (AliClik lo guarda en un solo campo «Nombres y Apellidos»). */
export function nombreParaAliclik(nombre: string | null | undefined): string {
  return (nombre || "").trim().replace(/\s+/g, " ");
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
  // Pide la acción: registrar, programar, agendar, subir, crear, cargar, ingresar, pasar, mandar, despachar.
  if (!/\b(reg[ií]str|program|agend|sub(e|ir|elo|irlo)\b|cre(a|ar)\b|carg(a|ar|alo|arlo)\b|ingres|pas(a|ar|alo|arlo)\b|mand(a|ar|alo|arlo)\b|despach)/.test(t)) return null;
  // Una pregunta por el estado («¿ya está registrado…?», «¿se registró…?») no es la orden.
  if (/\b(est[aá]|fue|qued[oó]|ya) (registrad|programad|agendad|subid|cread|cargad|ingresad)|\bse (registr|program|agend|subi|cre)[oó](?![a-záéíóúñ])/.test(t)) {
    return null;
  }
  const sinMarca = t.replace(/\bali\s*cli(c|k)k?\b/g, " ");
  const m =
    sinMarca.match(/\b([a-z]{2,5}-\d{2,6})\b/i) ??
    sinMarca.match(/#\s?(\d{3,6})\b/) ??
    sinMarca.match(/\b(9\d{8})\b/) ??
    sinMarca.match(/\b(\d{3,6})\b/);
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

/**
 * Referencia escrita por el cliente en un mensaje del chat («referencia: frente al parque»,
 * «al costado de la bodega…»). Devuelve el tramo útil, o "" si el mensaje no trae una.
 */
export function referenciaDeTexto(texto: string | null | undefined): string {
  const t = (texto || "").replace(/\s+/g, " ").trim();
  if (!t || /https?:\/\//i.test(t)) return "";
  const conEtiqueta = t.match(/\bref(?:erencia)?s?\b\.?\s*:?\s*(.{4,})/i);
  const libre = t.match(
    /\b(frente (?:a|al)\b.*|al (?:costado|lado|fondo) (?:de|del)\b.*|(?:a )?(?:espaldas?|detr[aá]s) (?:de|del)\b.*|cerca (?:de|del|al|a)\b.*|a una cuadra (?:de|del)\b.*|esquina (?:con|de)\b.*|a la altura (?:de|del)\b.*|altura (?:de|del)\b.*)/i
  );
  const r = (conEtiqueta?.[1] ?? libre?.[1] ?? "").replace(/^[\s:,.-]+|[\s.]+$/g, "");
  return r.length >= 4 ? r.slice(0, 140) : "";
}

/** Metros entre dos puntos (aproximado, suficiente para «a ~80 m»). */
export function distanciaMetros(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = (g: number) => (g * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(6371000 * 2 * Math.asin(Math.sqrt(h)));
}

const TIPOS_SIN_REFERENCIA = /^(route|street_address|premise|subpremise|plus_code|locality|political|postal_code|administrative_area)/;

/** Lugares que un motorizado reconoce (Places API, tabla A). Sin filtro, Google da talleres y casas. */
const TIPOS_REFERENCIA_PLACES = [
  "park", "school", "primary_school", "secondary_school", "university", "church", "supermarket",
  "grocery_store", "convenience_store", "market", "pharmacy", "drugstore", "bank", "gas_station",
  "hospital", "medical_clinic", "police", "fire_station", "bus_station", "bus_stop", "transit_station",
  "restaurant", "bakery", "hardware_store", "shopping_mall", "stadium", "sports_complex",
  "community_center", "city_hall", "library", "post_office", "hotel", "gym",
];

/** Quita emojis y comillas sobrantes del nombre que da Google. */
const limpiarNombreLugar = (n: string) =>
  n.replace(/[\p{Extended_Pictographic}\uFE0F]/gu, "").replace(/\s+/g, " ").trim();

/**
 * Referencia sugerida por Google Maps cuando el cliente no dio ninguna (AliClik la exige).
 * 1) Places API (lugares conocidos a menos de 300 m: parque, colegio, iglesia, bodega, mercado…).
 * 2) Si Places no está habilitado, el Geocoding inverso: paradero o lugar de interés cercano.
 * 3) Si tampoco, la urbanización o zona. Nunca inventa: si Google no da nada, devuelve null.
 */
export async function referenciaCercana(
  lat: number,
  lng: number
): Promise<{ referencia: string; origen: "places" | "geocoding" } | null> {
  const clave = (process.env.GOOGLE_MAPS_API_KEY ?? "").trim();
  if (!clave) return null;
  const punto = { lat, lng };
  const conDistancia = (nombre: string, l?: { lat: number; lng: number }) =>
    l && Number.isFinite(l.lat) && Number.isFinite(l.lng)
      ? `${nombre} (a ~${Math.max(10, Math.round(distanciaMetros(punto, l) / 10) * 10)} m)`
      : nombre;

  try {
    const res = await fetch("https://places.googleapis.com/v1/places:searchNearby", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": clave,
        "X-Goog-FieldMask": "places.displayName,places.primaryType,places.location",
      },
      body: JSON.stringify({
        includedTypes: TIPOS_REFERENCIA_PLACES,
        locationRestriction: { circle: { center: { latitude: lat, longitude: lng }, radius: 300 } },
        rankPreference: "DISTANCE",
        maxResultCount: 6,
        languageCode: "es",
      }),
      signal: AbortSignal.timeout(6000),
    });
    if (res.ok) {
      const body = (await res.json().catch(() => null)) as { places?: Array<Record<string, any>> } | null;
      const lugares = (body?.places ?? [])
        .filter((x) => typeof x.displayName?.text === "string" && !TIPOS_SIN_REFERENCIA.test(String(x.primaryType ?? "")))
        .slice(0, 2)
        .map((x) =>
          conDistancia(limpiarNombreLugar(String(x.displayName.text)), { lat: Number(x.location?.latitude), lng: Number(x.location?.longitude) })
        );
      if (lugares.length) return { referencia: `Cerca de ${lugares.join(" y ")}`, origen: "places" };
    }
  } catch {
    // Places no disponible: seguimos con el Geocoding (misma clave).
  }

  try {
    const tipos = "transit_station|point_of_interest|park|school|establishment|neighborhood|sublocality";
    const url =
      "https://maps.googleapis.com/maps/api/geocode/json" +
      `?latlng=${lat},${lng}&language=es&result_type=${encodeURIComponent(tipos)}&key=${encodeURIComponent(clave)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
    const body = (await res.json().catch(() => null)) as Record<string, any> | null;
    if (!res.ok || body?.status !== "OK") return null;
    const resultados = (body.results ?? []) as Array<Record<string, any>>;
    const nombre = (r: Record<string, any>) => String(r.address_components?.[0]?.long_name ?? "").trim();
    const ubic = (r: Record<string, any>) => ({ lat: Number(r.geometry?.location?.lat), lng: Number(r.geometry?.location?.lng) });
    const paradero = resultados.find((r) => r.types?.includes("transit_station") && /[a-z]/i.test(nombre(r)));
    if (paradero) return { referencia: `Cerca del paradero ${conDistancia(nombre(paradero), ubic(paradero))}`, origen: "geocoding" };
    const lugar = resultados.find(
      (r) =>
        (r.types?.includes("park") || r.types?.includes("school") || r.types?.includes("point_of_interest")) &&
        /[a-z]{3}/i.test(nombre(r))
    );
    if (lugar) return { referencia: `Cerca de ${conDistancia(nombre(lugar), ubic(lugar))}`, origen: "geocoding" };
    const zona = resultados.find((r) => r.types?.includes("neighborhood") || r.types?.includes("sublocality"));
    if (zona && nombre(zona)) return { referencia: `Zona ${nombre(zona)}`, origen: "geocoding" };
    return null;
  } catch {
    return null;
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
