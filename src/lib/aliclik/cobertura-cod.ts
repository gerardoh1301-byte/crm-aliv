/**
 * Cobertura de contra entrega (COD) de AliClik fuera de Lima.
 *
 * AliClik no publica una lista de ciudades: se le pregunta por un punto con
 * `GET /integration/order/shipping/cost?warehouseId&lat&lng` (API de Integraciones,
 * documentada en admin.aliclik.app/conections/documentation). Si hay courier, ese
 * distrito tiene contra entrega; si responde 400 "Sin cobertura contraentrega…" o
 * `couriers: []`, no la tiene.
 *
 * Aquí no se escribe ninguna ciudad a mano: el texto del cliente se ubica en un punto
 * con el padrón de agencias Shalom (que trae coordenadas de todo el país) y ese punto
 * se consulta a la API. La respuesta se guarda en memoria 24 h por punto, así la
 * cobertura se actualiza sola una vez al día sin llamar a AliClik en cada mensaje.
 *
 * Token: `ALICLIK_COBERTURA_TOKEN` (la clave de "Registrar mi app" en AliClik). Es otra
 * clave que la del MCP de pedidos.
 */
import { fechaMinimaCod, lineasFechaCod, type EntregaCodProvincia } from "./entrega-fecha";

import agenciasConCoordenadas from "@/lib/agencias/shalom-agencias-569.json";
/** Almacén WANKLIC GROUP 2 (el mismo de ALICLIK_CATALOG en api-client). */
const ALMACEN_ID = Number(process.env.ALICLIK_WAREHOUSE_ID) || 373;

export type EstadoCobertura = "cubierto" | "sin_cobertura" | "desconocido";

export interface CoberturaPunto {
  estado: EstadoCobertura;
  departamento?: string;
  provincia?: string;
  distrito?: string;
  /** Lo que AliClik nos cobra por la entrega (no se le cobra al cliente: el envío es gratis). */
  costoEnvio?: number;
  /** Días adicionales de despacho que informa AliClik. */
  diasExtra?: number;
  motivo?: string;
}

export type ZonaEntrega = "lima" | "provincia_cod" | "provincia_shalom" | "desconocida";

export interface DecisionEntrega {
  zona: ZonaEntrega;
  /** Modalidad con que se crea el pedido. */
  modalidadPago: "contraentrega" | "adelanto_agencia";
  /** Lugar que se usó para decidir (distrito, provincia, departamento). */
  lugar?: string;
  cobertura?: CoberturaPunto;
}

const BASE_URL_DEFECTO = "https://api.aliclik-dev.com";
const HORA = 60 * 60 * 1000;

function ttlMs(estado: EstadoCobertura): number {
  if (estado === "desconocido") return 10 * 60 * 1000; // reintenta pronto si AliClik falló
  const horas = Number(process.env.ALICLIK_COBERTURA_TTL_HORAS);
  return (Number.isFinite(horas) && horas > 0 ? horas : 24) * HORA;
}

const cache = new Map<string, { hasta: number; valor: CoberturaPunto }>();

/** Solo para pruebas. */
export function limpiarCacheCobertura() {
  cache.clear();
}

function normalizar(t: string | null | undefined): string {
  return (t ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9ñ\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Consulta la API de AliClik para un punto. Usa la caché de 24 h. */
export async function consultarCoberturaCod(lat: number, lng: number): Promise<CoberturaPunto> {
  const clave = `${lat.toFixed(3)},${lng.toFixed(3)}`;
  const enCache = cache.get(clave);
  if (enCache && enCache.hasta > Date.now()) return enCache.valor;

  const valor = await consultarApi(lat, lng);
  cache.set(clave, { hasta: Date.now() + ttlMs(valor.estado), valor });
  return valor;
}

async function consultarApi(lat: number, lng: number): Promise<CoberturaPunto> {
  const token = (process.env.ALICLIK_COBERTURA_TOKEN ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return { estado: "desconocido", motivo: "Falta ALICLIK_COBERTURA_TOKEN" };

  const base = (process.env.ALICLIK_INTEGRATION_URL || BASE_URL_DEFECTO).replace(/\/+$/, "");
  const url =
    `${base}/integration/order/shipping/cost?warehouseId=${ALMACEN_ID}` +
    `&lat=${encodeURIComponent(String(lat))}&lng=${encodeURIComponent(String(lng))}`;

  try {
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "x-aliclik-origin": "aliclik-web",
      },
      signal: AbortSignal.timeout(6000),
    });
    const body = (await res.json().catch(() => null)) as Record<string, any> | null;

    if (res.ok && body) {
      const couriers: any[] = Array.isArray(body.couriers) ? body.couriers : [];
      const u = body.ubigeo ?? {};
      const base: CoberturaPunto = {
        estado: couriers.length > 0 ? "cubierto" : "sin_cobertura",
        departamento: u.department?.name,
        provincia: u.province?.name,
        distrito: u.district?.name,
      };
      if (couriers.length > 0) {
        const mejor = [...couriers].sort((a, b) => Number(a.deliveryCost) - Number(b.deliveryCost))[0];
        base.costoEnvio = Number(mejor.deliveryCost);
        base.diasExtra = Number(mejor.addDays);
      } else {
        base.motivo = typeof body.message === "string" ? body.message : "Sin couriers para el destino";
      }
      return base;
    }

    const mensaje = typeof body?.message === "string" ? body.message : `HTTP ${res.status}`;
    if (res.status === 400 && /sin cobertura/i.test(mensaje)) {
      // "Sin cobertura contraentrega en BAMBAMARCA (HUALGAYOC, CAJAMARCA): provincia Hualgayoc no tiene…"
      const m = mensaje.match(/en\s+(.+?)\s+\((.+?),\s*(.+?)\)/i);
      return {
        estado: "sin_cobertura",
        distrito: m?.[1],
        provincia: m?.[2],
        departamento: m?.[3],
        motivo: mensaje,
      };
    }
    return { estado: "desconocido", motivo: mensaje };
  } catch (err) {
    return { estado: "desconocido", motivo: err instanceof Error ? err.message : String(err) };
  }
}

// ---------------------------------------------------------------------------
// Ubicar el texto del cliente en un punto (sin tabla de cobertura a mano)
// ---------------------------------------------------------------------------

interface PuntoReferencia {
  departamento: string;
  provincia: string;
  distrito: string;
  lat: number;
  lng: number;
  nombres: string[]; // distrito, zona y coincidencias normalizados
}

let puntos: PuntoReferencia[] | null = null;

function cargarPuntos(): PuntoReferencia[] {
  if (puntos) return puntos;
  const lista = agenciasConCoordenadas as Array<Record<string, any>>;
  puntos = lista
    .filter(
      (a) =>
        typeof a.latitud === "number" &&
        typeof a.longitud === "number" &&
        a.latitud < 0 && a.latitud > -19 && a.longitud < -68 && a.longitud > -82 &&
        !/aeropuerto|^caja |prueba|area shalom|^puerto |cambio_de_nombre/i.test(String(a.distrito))
    )
    .map((a) => ({
      departamento: normalizar(a.departamento),
      provincia: normalizar(a.provincia),
      // En este padrón `zona` es el distrito real y `distrito` la etiqueta de la sede.
      distrito: normalizar(a.zona || a.distrito),
      lat: a.latitud,
      lng: a.longitud,
      nombres: [a.distrito, a.zona, ...(Array.isArray(a.coincidencias) ? a.coincidencias : [])]
        .map((n) => normalizar(String(n ?? "")))
        .filter((n) => n.length >= 4),
    }));
  return puntos;
}

function contienePalabra(texto: string, frase: string): boolean {
  if (!frase) return false;
  return ` ${texto} `.includes(` ${frase} `);
}

/**
 * Busca un punto de referencia para la ubicación que dio el cliente.
 * Puntúa distrito > provincia > departamento; ante empate gana Lima (la mayoría de clientes).
 */
export function ubicarEnPunto(params: {
  ciudad?: string | null;
  distrito?: string | null;
  direccion?: string | null;
}): PuntoReferencia | null {
  const distritoDado = normalizar(params.distrito);
  const ciudadDada = normalizar(params.ciudad);
  const texto = normalizar([params.ciudad, params.distrito, params.direccion].filter(Boolean).join(" "));
  if (!texto) return null;

  let mejor: { p: PuntoReferencia; puntaje: number } | null = null;
  for (const p of cargarPuntos()) {
    let puntaje = 0;
    // Un nombre de distrito igual al de su provincia o departamento ("Piura", "Trujillo")
    // no cuenta como distrito: así "Trujillo, La Esperanza" se queda en La Esperanza.
    const nombresPropios = p.nombres.filter((n) => n !== p.provincia && n !== p.departamento);
    if (distritoDado && (p.distrito === distritoDado || p.nombres.includes(distritoDado))) puntaje += 6;
    if (nombresPropios.some((n) => contienePalabra(texto, n))) puntaje += 4;
    if (contienePalabra(texto, p.provincia)) puntaje += 2;
    if (contienePalabra(texto, p.departamento)) puntaje += 1;
    if (puntaje === 0) continue;
    // Si el cliente dio explícitamente su ciudad ("Cusco"), la provincia/departamento que coincide
    // con `ciudad` recibe un bono fuerte (+5) para que una calle con nombre de pueblo en otra
    // provincia ("Jr. Vilcabamba 109" en Cusco) no lo desvíe a La Convención (caso #1190, 26/11).
    if (ciudadDada && (p.provincia === ciudadDada || p.departamento === ciudadDada || p.distrito === ciudadDada)) {
      puntaje += 5;
    }
    // Solo dio la ciudad: se usa la capital (distrito con el mismo nombre que la provincia).
    if (p.distrito === p.provincia) puntaje += 1;
    if (p.departamento === "lima" || p.departamento === "callao") puntaje += 0.1;
    if (!mejor || puntaje > mejor.puntaje) mejor = { p, puntaje };
  }
  return mejor?.p ?? null;
}

const RE_LIMA = /\b(lima|callao)\b/;

function esLimaMetropolitana(p: { departamento?: string; provincia?: string }): boolean {
  const dep = normalizar(p.departamento);
  const prov = normalizar(p.provincia);
  return dep === "callao" || prov === "callao" || (dep === "lima" && prov === "lima");
}

/**
 * Decide cómo se vende a este cliente:
 * - Lima Metropolitana y Callao: contra entrega.
 * - Provincia con cobertura COD de AliClik: contra entrega sin adelanto.
 * - Provincia sin cobertura (o si AliClik no responde): Shalom con adelanto de S/ 20.
 * - Sin ubicación: "desconocida" (el bot debe preguntar la ciudad).
 */
export async function decidirEntrega(params: {
  ciudad?: string | null;
  distrito?: string | null;
  direccion?: string | null;
  lat?: number | null;
  lng?: number | null;
}): Promise<DecisionEntrega> {
  let lat = params.lat ?? null;
  let lng = params.lng ?? null;
  let lugar: string | undefined;

  if (lat == null || lng == null) {
    const punto = ubicarEnPunto(params);
    if (!punto) {
      const texto = normalizar([params.ciudad, params.distrito, params.direccion].filter(Boolean).join(" "));
      if (RE_LIMA.test(texto)) return { zona: "lima", modalidadPago: "contraentrega", lugar: "Lima" };
      return { zona: "desconocida", modalidadPago: "contraentrega" };
    }
    if (esLimaMetropolitana(punto)) {
      return { zona: "lima", modalidadPago: "contraentrega", lugar: punto.departamento === "callao" ? "Callao" : "Lima" };
    }
    lat = punto.lat;
    lng = punto.lng;
    lugar = [punto.distrito, punto.provincia, punto.departamento].map(titulo).join(", ");
  }

  const cobertura = await consultarCoberturaCod(lat, lng);
  if (cobertura.distrito) {
    lugar = [cobertura.distrito, cobertura.provincia, cobertura.departamento].filter(Boolean).map(titulo).join(", ");
  }
  if (esLimaMetropolitana(cobertura)) {
    return { zona: "lima", modalidadPago: "contraentrega", lugar, cobertura };
  }
  if (cobertura.estado === "cubierto") {
    return { zona: "provincia_cod", modalidadPago: "contraentrega", lugar, cobertura };
  }
  return { zona: "provincia_shalom", modalidadPago: "adelanto_agencia", lugar, cobertura };
}

function titulo(t: string | undefined): string {
  return (t ?? "")
    .toLowerCase()
    .replace(/(^|\s)\S/g, (c) => c.toUpperCase());
}

/** Encabezado del bloque de contra entrega en provincia (el guion de venta lo detecta). */
export const MARCA_COD_PROVINCIA = "## ENTREGA: CONTRA ENTREGA EN";

/** Bloque para el system prompt del bot según la decisión. Vacío si no aplica. */
/** Lugar y fecha más pronta de una entrega contra entrega en provincia (null si no aplica). */
export function entregaCodProvincia(d: DecisionEntrega | null, ahora: Date = new Date()): EntregaCodProvincia | null {
  if (!d || d.zona !== "provincia_cod") return null;
  const fecha = fechaMinimaCod(d.cobertura?.diasExtra, ahora);
  return fecha ? { lugar: titulo(d.lugar) || "tu ciudad", fecha } : null;
}

export function renderBloqueCobertura(d: DecisionEntrega, ahora: Date = new Date()): string {
  if (d.zona === "provincia_cod") {
    const dias = d.cobertura?.diasExtra != null ? ` (llega en unos ${d.cobertura.diasExtra + 1} días hábiles)` : "";
    const entrega = entregaCodProvincia(d, ahora);
    return (
      `${MARCA_COD_PROVINCIA} ${(d.lugar || "su ciudad").toUpperCase()} (cobertura AliClik verificada)\n` +
      `- Este cliente está en provincia, pero su ciudad TIENE contra entrega a domicilio${dias}.\n` +
      "- Véndele IGUAL QUE EN LIMA: paga al recibir, en efectivo, Yape o tarjeta. SIN adelanto de S/20, SIN agencia Shalom y SIN clave de retiro.\n" +
      "- ESTÁ PROHIBIDO pedirle el adelanto de S/20, el DNI para guía o proponerle una agencia Shalom.\n" +
      "- Pide solo: nombre completo, dirección exacta con número y referencia, distrito y día de entrega. Pídele también que comparta su UBICACIÓN por WhatsApp (📎 → Ubicación) para que el motorizado llegue exacto.\n" +
      "- Si el cliente prefiere recoger en agencia Shalom, también se puede, pero entonces sí aplica el adelanto de S/20." +
      (entrega ? `\n${lineasFechaCod(entrega)}` : "")
    );
  }
  if (d.zona === "provincia_shalom") {
    return (
      `## ENTREGA: AGENCIA SHALOM EN ${(d.lugar || "provincia").toUpperCase()}\n` +
      "- Su ciudad no tiene contra entrega a domicilio: aplica el flujo de provincia de siempre (agencia Shalom, adelanto de S/20 por Yape y saldo antes de la clave de retiro)."
    );
  }
  return "";
}
