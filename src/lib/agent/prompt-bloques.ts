/**
 * Prompt por bloques: ahorro de tokens sin perder reglas.
 *
 * El prompt del bot (~60 mil caracteres) se enviaba completo en cada llamada a Gemini.
 * Las secciones que solo sirven en ciertos chats van marcadas en el template con
 *
 *   [[si:provincia]] ... [[/si:provincia]]   envío por Shalom, adelanto, clave de retiro
 *   [[si:nac600]]    ... [[/si:nac600]]      ficha, cotización y fotos de NAC600
 *   [[si:termix]]    ... [[/si:termix]]      ficha, cotización y fotos de Termix
 *   [[si:venta]]     ... [[/si:venta]]       método de cierre y objeciones (no hace falta en posventa)
 *
 * y solo se incluyen cuando el chat las necesita. Regla de oro: ante la duda se incluye.
 * Sin señales (vista previa en Ajustes, simulador sin datos) se incluye todo.
 */

export interface SenalesPrompt {
  provincia: boolean;
  nac600: boolean;
  termix: boolean;
  venta: boolean;
}

export const TODAS_LAS_SENALES: SenalesPrompt = { provincia: true, nac600: true, termix: true, venta: true };

const BLOQUE = /\[\[si:(\w+)\]\]([\s\S]*?)\[\[\/si:\1\]\]/g;

/** Quita los bloques cuya señal está apagada y borra las marcas de los que quedan. */
export function aplicarBloques(texto: string, senales: SenalesPrompt = TODAS_LAS_SENALES): string {
  let actual = texto;
  // Repetir permite bloques de distinto tipo anidados (por ejemplo, provincia dentro de venta).
  for (let i = 0; i < 4; i++) {
    const siguiente = actual.replace(BLOQUE, (_m, clave: string, cuerpo: string) => {
      const activa = (senales as unknown as Record<string, boolean | undefined>)[clave];
      return activa === false ? "" : cuerpo;
    });
    if (siguiente === actual) break;
    actual = siguiente;
  }
  // Marcas sueltas (mal cerradas) nunca deben llegar al modelo; el texto se conserva.
  return actual
    .replace(/\[\[\/?si:\w+\]\]/g, "")
    .replace(/\n{3,}/g, "\n\n");
}

// Departamentos y ciudades fuera de Lima Metropolitana y Callao (incluye zonas de Lima provincias).
const LUGARES_PROVINCIA =
  /\b(amazonas|[aá]ncash|apur[ií]mac|arequipa|ayacucho|cajamarca|cusco|cuzco|huancavelica|hu[aá]nuco|ica|jun[ií]n|la libertad|lambayeque|loreto|madre de dios|moquegua|pasco|piura|puno|san mart[ií]n|tacna|tumbes|ucayali|trujillo|chiclayo|chimbote|huancayo|iquitos|pucallpa|tarapoto|juliaca|cajamarca|huaraz|sullana|paita|talara|chincha|pisco|nazca|nasca|tarma|ja[eé]n|chota|cutervo|moyobamba|abancay|andahuaylas|huacho|huaral|barranca|ca[nñ]ete|mala|chancay|huaura|oxapampa|la merced|satipo|tingo mar[ií]a|bagua|chachapoyas|ilo|puerto maldonado|yurimaguas|sechura|catacaos|ferre[nñ]afe|pacasmayo|chep[eé]n|casma|huarmey|caraz|chulucanas|tumbes|zarumilla|camana|caman[aá]|mollendo|majes|sicuani|quillabamba|juanjui|tocache|aguayt[ií]a|yarinacocha|huanta|vraem|pichanaki|jauja|la oroya|cerro de pasco|ayaviri|azangaro|ilave|yunguyo|huamachuco|otuzco|virú|viru|cajabamba|celend[ií]n|san ignacio|lamas|rioja|nueva cajamarca|tumbes)\b/i;

const PROVINCIA_EN_CLIENTE =
  /\b(provincia|shalom|agencia|adelanto|departamento|interior del pa[ií]s|fuera de lima|clave de (retiro|recojo)|gu[ií]a)\b/i;
const PROVINCIA_EN_BOT = /\b(shalom|agencia|adelanto de s\/ ?20|gu[ií]a de remisi[oó]n|clave de (retiro|recojo))\b/i;
const LIMA = /\b(lima|callao)\b/i;

const NAC = /\b(nac ?600|nac\b|nad\+?|c[aá]psulas?|frascos?|glutati[oó]n|h[ií]gado|antioxidante)/i;
const TERMIX = /\b(termix|tobiller\w*|tobillos?|grafeno|masajeador)/i;

export interface EntradaSenales {
  historial: Array<{ role: string; content: unknown }>;
  camposContacto?: Record<string, unknown> | null;
  etiquetas?: string[] | null;
  productoAnuncio?: "nac600" | "termix" | null;
  tienePedidoReciente?: boolean;
  /** Ciudad, notas o dirección del último pedido, si existe. */
  textoPedido?: string | null;
  /** Etapa del guion de venta (guion-venta.ts). */
  etapa?: string | null;
}

function txt(c: unknown): string {
  if (typeof c === "string") return c;
  if (Array.isArray(c)) return c.map((p) => (typeof p === "object" && p && "text" in p ? String((p as { text: unknown }).text) : "")).join(" ");
  return "";
}

/** Decide qué bloques necesita este chat. Ante la duda, incluye. */
export function detectarSenalesPrompt(e: EntradaSenales): SenalesPrompt {
  const delCliente = e.historial.filter((m) => m.role === "user").map((m) => txt(m.content)).join("\n");
  const delBot = e.historial.filter((m) => m.role === "assistant").map((m) => txt(m.content)).join("\n");
  const campos = e.camposContacto ?? {};
  const camposTxt = Object.values(campos).filter((v) => typeof v === "string").join(" ");
  const ciudad = String(campos.departamento_ciudad ?? "");
  const etiquetas = (e.etiquetas ?? []).join(" ").toLowerCase();

  const provincia =
    PROVINCIA_EN_CLIENTE.test(delCliente) ||
    LUGARES_PROVINCIA.test(delCliente) ||
    PROVINCIA_EN_BOT.test(delBot) ||
    /shalom|provincia/i.test(String(campos.modalidad_entrega ?? "")) ||
    (ciudad.trim() !== "" && !LIMA.test(ciudad)) ||
    LUGARES_PROVINCIA.test(camposTxt) ||
    /shalom|adelanto/.test(etiquetas) ||
    (e.textoPedido ? /shalom|agencia/i.test(e.textoPedido) || LUGARES_PROVINCIA.test(e.textoPedido) : false) ||
    e.etapa === "datos_provincia" ||
    e.etapa === "adelanto";

  const todo = `${delCliente}\n${delBot}\n${camposTxt}\n${etiquetas}\n${e.textoPedido ?? ""}`;
  let nac600 = e.productoAnuncio === "nac600" || NAC.test(todo) || /interes:nac600/.test(etiquetas);
  let termix = e.productoAnuncio === "termix" || TERMIX.test(todo) || /interes:termix/.test(etiquetas);
  if (!nac600 && !termix) {
    nac600 = true;
    termix = true;
  }

  return { provincia, nac600, termix, venta: !e.tienePedidoReciente };
}
