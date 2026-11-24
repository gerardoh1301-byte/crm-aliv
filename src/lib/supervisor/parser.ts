/**
 * Intérprete de las órdenes que el supervisor de pagos escribe por WhatsApp
 * ("Jaime pagó 179", "flete 1142 10", "clave 1140", "SI 1140"...).
 *
 * Es puro (sin base de datos) para poder probarlo. Si el texto no es una orden,
 * devuelve null y el mensaje sigue al bot de ventas como chat de prueba.
 *
 * Los números quedan como tokens: si "1140" es el pedido o el monto lo decide quien
 * ejecuta, consultando qué pedidos existen. Un token con # o prefijo (LEG-, CHAT-)
 * siempre es pedido; uno con decimales siempre es monto.
 */

export type TipoComando =
  | "ayuda"
  | "confirmar"
  | "cancelar"
  | "enviar_clave"
  | "clave"
  | "flete"
  | "pago"
  | "entregado"
  | "estado"
  | "guia"
  | "adelanto"
  // Consultas generales (varios pedidos) y cambios en el CRM (siempre con «SI <pedido>»).
  | "consulta"
  | "cancelar_pedido"
  | "cambiar_estado"
  | "dni"
  | "direccion"
  | "clave_nueva"
  | "total"
  | "nota";

export type TipoConsulta =
  | "resumen"
  | "deben"
  | "adelantos"
  | "agendar"
  | "por_enviar"
  | "en_camino"
  | "por_confirmar";
export type Periodo = "hoy" | "ayer" | "semana" | "mes";

/** Estados a los que se pasa un pedido con «pasa 1140 a …» (entregado y cancelado tienen su propia orden). */
export type EstadoDestino = "por_confirmar_cod" | "confirmado" | "preparando" | "enviado";

export interface TokenNumero {
  /** Texto tal cual, sin el #: "1140", "LEG-1049", "179.50". */
  texto: string;
  /** Tiene # o prefijo de serie: es seguro un número de pedido. */
  esPedido: boolean;
  /** Tiene decimales o venía después de "S/": es seguro un monto. */
  esMonto: boolean;
  valor: number;
}

export interface Comando {
  tipo: TipoComando;
  numeros: TokenNumero[];
  /** Palabras que parecen nombre del cliente ("jaime gaspar"), o null. */
  nombre: string | null;
  /** "pago completo" / "pagó todo": cubre el saldo sin decir el monto. */
  completo: boolean;
  /**
   * Número de orden Shalom (8-10 cifras) y código alfanumérico. En la orden «guia» son
   * la guía nueva; en las demás identifican el pedido («clave guía Shalom 104493022»).
   */
  guia?: string | null;
  codigo?: string | null;
  /** Celular del cliente (9 cifras que empiezan con 9): identifica el pedido. */
  celular?: string | null;
  /** Dato nuevo de un cambio: DNI, dirección, clave, estado destino, texto de la nota o motivo. */
  valor?: string | null;
  /** Consulta general: qué lista o resumen pide y de qué periodo. */
  consulta?: TipoConsulta;
  periodo?: Periodo;
}

const PALABRAS_RELLENO = new Set([
  "pago", "pagos", "pagado", "pagada", "pagaron", "pagar", "paga", "pague", "completo", "completa",
  "total", "todo", "saldo", "flete", "shalom", "clave", "retiro", "recojo", "estado", "envio",
  "pedido", "orden", "cliente", "el", "la", "los", "las", "de", "del", "ya", "con", "por", "s",
  "soles", "sol", "yape", "yapeo", "plin", "me", "le", "dio", "mando", "en", "a", "y", "que",
  "su", "mi", "al", "es", "fue", "entregado", "entregada", "entrego", "recogio", "recibio",
  "enviar", "envia", "mandale", "dame", "pasame", "como", "va", "donde", "esta", "monto", "por",
  "favor", "porfa", "pls", "ok", "hoy", "agencia", "pagalo", "deposito", "transfirio", "cobrado",
  "cobre", "cobro", "n", "nro", "numero", "guia", "adelanto", "confirma", "confirmar", "confirmo",
  "confirmado", "confirmada", "valida", "validar", "validado", "verifica", "verificar", "verificado",
  "recibido", "recibi", "llego", "aprueba", "aprobado",
  // Pedidos de información en lenguaje libre: «dame la clave de recojo del pedido a
  // nombre de Carlos…». Si quedaran, la búsqueda por nombre exigiría «nombre» en el contacto.
  "nombre", "nombres", "recoger", "recojer", "retirar", "necesito", "quiero", "saber", "dime",
  "datos", "dato", "informacion", "info", "cual", "cuales", "cuanto", "cuanta", "debe", "falta",
  "manda", "mandame", "brindame", "dar", "darme", "tiene", "tienes", "puedes", "podrias", "hola",
  "buenas", "gracias", "para", "este", "esta", "ese", "esa", "telefono", "celular", "dni",
  "direccion", "codigo", "seguimiento", "tracking", "senor", "senora", "sra", "cuenta", "muestrame",
  "consulta", "consultar", "busca", "buscar", "revisa", "revisar", "ver", "tambien", "sobre",
  "detalle", "detalles", "resumen", "situacion", "numeros", "uno", "una", "hay", "producto",
  "productos", "pedidos", "ordenes",
]);

export function normalizarTexto(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[¿?¡!,;:()"'*_~]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function extraerNumeros(normalizado: string): TokenNumero[] {
  const out: TokenNumero[] = [];
  const re = /(s\/\s*)?(#)?\b((?:leg|chat|aliv)-)?(\d+(?:[.,]\d{1,2})?)\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(normalizado))) {
    const [, soles, almohadilla, prefijo, cifra] = m;
    const decimales = /[.,]/.test(cifra);
    const valor = Number(cifra.replace(",", "."));
    if (!Number.isFinite(valor)) continue;
    out.push({
      texto: (prefijo ? prefijo.toUpperCase() : "") + cifra.replace(",", "."),
      esPedido: Boolean(almohadilla || prefijo),
      esMonto: Boolean(soles || decimales),
      valor,
    });
  }
  return out;
}

/** Palabras de las órdenes de cambio que nunca son parte del nombre del cliente. */
const RE_PALABRAS_CAMBIO =
  /\b(confirmado|confirmada|preparando|preparacion|enviado|despachado|camino|cancelado|anulado|rechazado|como|nuevo|nueva|cambia|cambiar|pasa|pasar|marca|marcar|pon|poner|mueve|mover|anula|anular|cancela|cancelar|registra|registrar|corrige|corregir|actualiza|actualizar|porque|motivo|dni|direccion|nota|anota|agrega|guarda)\b/g;

function extraerNombre(normalizado: string): string | null {
  const palabras = normalizado
    .replace(RE_PALABRAS_CAMBIO, " ")
    .replace(/s\/\s*\d+(?:[.,]\d{1,2})?/g, " ")
    .replace(/#?\b(?:(?:leg|chat|aliv)-)?\d+(?:[.,]\d{1,2})?\b/g, " ")
    .replace(/[^a-zñ\s]/g, " ")
    .split(/\s+/)
    .filter((p) => p.length >= 3 && !PALABRAS_RELLENO.has(p));
  return palabras.length ? palabras.slice(0, 3).join(" ") : null;
}

function esCelular(t: TokenNumero): boolean {
  return !t.esPedido && !t.esMonto && /^(?:51)?9\d{8}$/.test(t.texto);
}

/** Guía Shalom: 8-10 cifras que no son un celular. */
export function esGuiaShalom(t: TokenNumero): boolean {
  return !t.esPedido && !t.esMonto && /^\d{8,10}$/.test(t.texto) && !esCelular(t);
}

/** Código de rastreo Shalom: 4 caracteres con letras y cifras («3KJP»), o el que sigue a «código». */
function extraerCodigo(n: string): string | null {
  const tras = n.match(/\bcodigo\s+([a-z0-9]{4})\b/)?.[1];
  if (tras) return tras.toUpperCase();
  return n.split(" ").find((w) => /^[a-z0-9]{4}$/.test(w) && /[a-z]/.test(w) && /\d/.test(w))?.toUpperCase() ?? null;
}

function comando(tipo: TipoComando, n: string, completo = false): Comando {
  const todos = extraerNumeros(n);
  // La guía Shalom y el celular identifican el pedido: no son montos ni números de pedido.
  const guia = todos.find(esGuiaShalom) ?? null;
  const celular = todos.find(esCelular) ?? null;
  return {
    tipo,
    numeros: todos.filter((t) => t !== guia && t !== celular),
    nombre: extraerNombre(n),
    completo,
    guia: guia?.texto ?? null,
    codigo: guia ? extraerCodigo(n) : null,
    celular: celular ? celular.texto.slice(-9) : null,
  };
}

/** Pregunta por información de un pedido («cuál es la guía de Carlos», «cuánto debe 1140»). */
const RE_CONSULTA =
  /^(?:hola |buenas |por favor |porfa )?(cual|cuales|cuanto|cuanta|que|donde|dame|dime|pasame|muestrame|necesito|quiero|consulta|busca|buscar|revisa|ver)\b/;
const RE_DATO_PEDIDO =
  /\b(pedido|orden|guia|codigo|dni|direccion|telefono|celular|agencia|saldo|debe|falta|estado|datos|informacion|info|detalle|resumen|flete|seguimiento)\b/;

// ---------------------------------------------------------------------------
// Consultas generales (varios pedidos; solo lectura)

const PERIODOS: [Periodo, RegExp][] = [
  ["ayer", /\bayer\b/],
  ["semana", /\bsemana\b/],
  ["mes", /\bmes\b/],
];

const CONSULTAS: [TipoConsulta, RegExp][] = [
  // Antes que «por enviar»: «listos para enviar» también es esta consulta. Pide «listos»,
  // «pedidos» o «por/sin/falta agendar» para no confundir «agenda la entrega de Carlos».
  [
    "agendar",
    /\b(listos? para|por agendar|sin agendar|falta(n)? agendar|pendientes? de agendar|que (pedidos )?(se pueden |puedo |hay que )?agendar)\b|\bpedidos\b.*\b(agendar|agendad[oa]s?|programar)\b/,
  ],
  [
    "deben",
    /\b(quien(es)?( me)? deben?|quien(es)?( me)? falta(n)? pagar|saldos? pendientes?|por cobrar|deudas?|deudores|falta(n)? cobrar|cuanto me deben)\b/,
  ],
  [
    "adelantos",
    /\b(adelantos?( pendientes?| sin verificar| por verificar| por confirmar| que faltan?)|falta(n)? (el )?adelanto|sin adelanto)\b/,
  ],
  [
    "por_enviar",
    /\b(por enviar|por despachar|sin guia|falta(n)? (enviar|despachar)|pendientes? de (envio|despacho)|para (enviar|despachar))\b/,
  ],
  ["en_camino", /\b(en camino|en agencia|por recoger|sin recoger|en transito|no (han )?recogido)\b/],
  ["por_confirmar", /\bpedidos (por|sin) confirmar\b|\bfalta(n)? confirmar\b/],
  [
    "resumen",
    /^(resumen|reporte|balance|ventas)\b|\b(cuantos pedidos|cuanto (hemos |he )?vendido|cuanto vendimos|como (vamos|va el dia|van las ventas)|pedidos de (hoy|ayer|la semana|este mes)|ventas de (hoy|ayer|la semana|este mes))\b/,
  ],
];

/**
 * Consulta sobre varios pedidos («quién me debe», «resumen de hoy», «qué falta enviar»).
 * Solo si el mensaje no nombra un pedido concreto (número, guía o celular).
 */
export function interpretarConsultaGeneral(n: string): { consulta: TipoConsulta; periodo: Periodo } | null {
  if (/#|\b((leg|chat|aliv)-)?\d{3,}\b/.test(n)) return null;
  const consulta = CONSULTAS.find(([, re]) => re.test(n))?.[0];
  if (!consulta) return null;
  return { consulta, periodo: PERIODOS.find(([, re]) => re.test(n))?.[0] ?? "hoy" };
}

// ---------------------------------------------------------------------------
// Cambios en el CRM (todos piden «SI <pedido>» antes de aplicarse)

const ESTADOS_DESTINO: [EstadoDestino | "entregado" | "cancelado", RegExp][] = [
  ["por_confirmar_cod", /\bpor confirmar\b/],
  ["preparando", /\b(preparando|en preparacion|preparacion)\b/],
  ["enviado", /\b(enviado|enviada|en camino|despachado|despachada)\b/],
  ["entregado", /\b(entregado|entregada)\b/],
  ["cancelado", /\b(cancelado|cancelada|anulado|anulada|rechazado|rechazada)\b/],
  ["confirmado", /\b(confirmado|confirmada)\b/],
];

/** Texto libre que sigue al número de pedido («direccion 1140 a Av. Lima 123» → «Av. Lima 123»). */
export function textoTrasPedido(original: string, palabra: string): { token: string; resto: string } | null {
  const re = new RegExp(
    `${palabra}.*?#?((?:leg|chat|aliv)-)?(\\d{3,})\\b\\s*(?:a |por |: ?|-> ?|= ?|- )?\\s*(\\S.*)$`,
    "is"
  );
  const m = original.trim().match(re);
  if (!m || m[3].trim().length < 2) return null;
  return { token: (m[1] ? m[1].toUpperCase() : "") + m[2], resto: m[3].trim() };
}

function conSoloPedido(tipo: TipoComando, token: string | null, valor: string | null): Comando {
  return {
    tipo,
    numeros: token ? extraerNumeros(normalizarTexto(/^[A-Z]/.test(token) ? token : `#${token}`)) : [],
    nombre: null,
    completo: false,
    valor,
  };
}

/** «pedido 1160», «orden #1160», «#1160», «LEG-1066», «CHAT-0001». */
const RE_PEDIDO_EXPLICITO = /(\b(pedido|orden|order)\s*(n[°ºo.]?\s*)?#?\s*\d{3,6}\b|#\s?\d{3,6}\b|\b(leg|chat|aliv)-\d{3,6}\b)/i;

/** Órdenes de cambio en el CRM. Devuelve null si el texto no es un cambio. */
export function interpretarCambio(texto: string, n: string): Comando | null {
  // Cancelar un pedido: «cancela el pedido 1140», «anula 1140 porque no contesta».
  if (/^(cancela|cancelar|anula|anular)\b/.test(n) && (/\d{3,}/.test(n) || /\b(pedido|orden)\b/.test(n))) {
    const motivo = texto.match(/\b(?:porque|motivo:?)\s+(.{2,})$/i)?.[1]?.trim() ?? null;
    const sinMotivo = motivo ? n.replace(/\b(porque|motivo)\b.*$/, "") : n;
    const c = comando("cancelar_pedido", sinMotivo);
    c.valor = motivo;
    return c;
  }

  // Cancelar dicho en cualquier parte: «Angy de orden #1047 no respondió al adelanto,
  // muévelo a cancelado». Exige un pedido explícito (#1047, orden 1047, LEG-1066) y se
  // arma solo con él: el resto del texto es el motivo, no un nombre de cliente.
  if (RE_CANCELAR_EN_TEXTO.test(n) && !/\bno (lo |la )?(cancel|anul)/.test(n)) {
    const ref = (texto.match(RE_PEDIDO_EXPLICITO) ?? n.match(RE_PEDIDO_EXPLICITO))?.[0];
    if (ref) {
      const c = comando("cancelar_pedido", normalizarTexto(ref));
      const motivo = texto.match(/\b(?:porque|motivo:?)\s+(.{2,})$/i)?.[1]?.trim();
      c.valor = (motivo || texto.replace(/\s+/g, " ").trim()).slice(0, 200);
      return c;
    }
  }

  // Cambiar estado: «pasa 1140 a confirmado», «marca el pedido de Carlos como enviado».
  if (
    /^(pasa|pasar|cambia|cambiar|marca|marcar|pon|poner|mueve|mover|actualiza|actualizar)\b/.test(n) &&
    !/\b(dni|direccion|agencia|clave|total|nota|guia)\b/.test(n)
  ) {
    const destino = ESTADOS_DESTINO.find(([, re]) => re.test(n));
    if (destino) {
      const sinEstado = n.replace(destino[1], " ");
      if (destino[0] === "entregado") return comando("entregado", sinEstado);
      if (destino[0] === "cancelado") return comando("cancelar_pedido", sinEstado);
      const c = comando("cambiar_estado", sinEstado);
      c.valor = destino[0];
      return c;
    }
  }

  const VERBO = "(?:(?:cambia|cambiar|actualiza|actualizar|corrige|corregir|registra|registrar|pon|poner|agrega|agregar)\\s+(?:el\\s+|la\\s+|una\\s+)?)?";

  // DNI: «dni 1140 45678912», «cambia el dni de Carlos Huaynalaya a 45678912».
  if (new RegExp(`^${VERBO}dni\\b`).test(n)) {
    const dni = n.match(/\b(\d{8})\b/)?.[1] ?? null;
    const c = comando("dni", n.replace(/\b\d{8}\b/, " "));
    c.valor = dni;
    return c;
  }

  // Dirección o agencia: siempre con el número de pedido, porque el texto nuevo es libre.
  if (new RegExp(`^${VERBO}(direccion|agencia)\\b`).test(n)) {
    const r = textoTrasPedido(texto, "(?:direcci[oó]n|agencia)");
    return conSoloPedido("direccion", r?.token ?? null, r?.resto ?? null);
  }

  // Nota: «nota 1140 el cliente pide que lo llamen después de las 6».
  if (new RegExp(`^${VERBO}(nota|anota|anotar)\\b`).test(n)) {
    const r = textoTrasPedido(texto, "(?:nota|anota|anotar)");
    return conSoloPedido("nota", r?.token ?? null, r?.resto ?? null);
  }

  // Clave nueva: «registra clave 1140 1330», «clave nueva de Carlos 1330».
  if (
    /\bclave\b/.test(n) &&
    (/^(registra|registrar|nueva|cambia|cambiar|pon|poner|guarda|guardar|actualiza|actualizar|corrige|corregir)\b/.test(n) ||
      /\bclave nueva\b/.test(n))
  ) {
    const c = comando("clave_nueva", n);
    const planos = c.numeros.filter((t) => !t.esPedido && !t.esMonto && /^\d{4,6}$/.test(t.texto));
    const otroIdentificador = Boolean(c.nombre || c.guia || c.celular || c.numeros.some((t) => t.esPedido));
    const clave = planos.length >= 2 || (planos.length === 1 && otroIdentificador) ? planos[planos.length - 1] : null;
    c.numeros = c.numeros.filter((t) => t !== clave);
    c.valor = clave?.texto ?? null;
    return c;
  }

  // Total: «total 1140 199», «cambia el total del 1140 a 189».
  if (new RegExp(`^${VERBO}total\\b`).test(n)) return comando("total", n);
  return null;
}

/** «cancela», «anula», «a cancelado» en cualquier parte del mensaje. */
const RE_CANCELAR_EN_TEXTO =
  /\b(cancela|cancelar|cancelalo|cancelala|cancelado|cancelada|anula|anular|anulalo|anulala|anulado|anulada)\b/;

/** «no pagó», «no respondió», «no mandó el adelanto», «todavía no yapea». */
const RE_NEGACION =
  /\b(no|nunca|todavia no|aun no)\s+(ha\s+|han\s+|me\s+|nos\s+|le\s+|lo\s+)?(pag|respond|contest|mand|envi|yape|deposit|transfir|recog|recib|confirm|llego)/;

const RE_INICIO_ORDEN =
  /^(?:por favor |porfa |ya )?(si|no|enviar|envia|ayuda|estado|adelanto|pago|pago completo|pagado|pagó|flete|clave|guia|nueva guia|entregado|entregada|cancela|cancelar|anula|anular|pasa|pasar|mueve|mover|marca|marcar|pon|poner|cambia|cambiar|actualiza|actualizar|corrige|corregir|registra|registrar|dni|direccion|agencia|nota|anota|total|resumen|confirma|confirmar|valida|validar|verifica|verificar)\b/;

/** Orden corta (hasta 10 palabras) o que empieza con la palabra de la orden. */
export function esOrdenCorta(n: string): boolean {
  return n.split(" ").filter(Boolean).length <= 10 || RE_INICIO_ORDEN.test(n);
}

/**
 * ¿Lo puede leer directamente el intérprete fijo, sin pasar antes por la IA? Sí cuando es
 * una orden corta o empieza con la palabra de la orden («SI 1047», «adelanto 1153»,
 * «cancela 1047 porque no respondió»). Lo demás lo interpreta primero la IA, que entiende
 * la intención del mensaje completo.
 */
export function esOrdenDirecta(texto: string | null | undefined): boolean {
  if (!texto) return false;
  const n = normalizarTexto(texto);
  return Boolean(n) && esOrdenCorta(n);
}

export function interpretarComando(texto: string | null | undefined): Comando | null {
  if (!texto) return null;
  const n = normalizarTexto(texto);
  if (!n || n.length > 200) return null;

  if (/^(ayuda|comandos|menu|opciones)$/.test(n)) return comando("ayuda", n);
  // Confirmación: exige el número del pedido para que un "sí" suelto (por ejemplo al
  // probar el bot de ventas) nunca ejecute nada.
  if (/^(si|confirmo|confirmar|confirmado)\s+#?((leg|chat|aliv)-)?\d{3,}$/.test(n)) return comando("confirmar", n);
  if (/^(no|cancelar|cancela|anular|anula)$/.test(n)) return comando("cancelar", n);
  if (/^(enviar|envia|enviala|mandale|mandar)\b/.test(n) && /\d{3,}/.test(n)) return comando("enviar_clave", n);
  const cambio = interpretarCambio(texto, n);
  if (cambio) return cambio;
  const general = interpretarConsultaGeneral(n);
  if (general) return { tipo: "consulta", numeros: [], nombre: null, completo: false, ...general };
  if (/^(estado|como va|donde esta|info|informacion|datos|detalle|resumen)\b/.test(n)) return comando("estado", n);
  if (/^(guia|nueva guia)\b/.test(n) && !/\bclave\b/.test(n)) {
    const c = comando("guia", n);
    // En la orden «guia» el número de 8-10 cifras es siempre la guía nueva.
    if (!c.guia && c.celular) c.guia = extraerNumeros(n).find((t) => t.texto.endsWith(c.celular!))?.texto ?? null;
    c.celular = null;
    c.codigo =
      n
        .split(" ")
        .find((w) => /^[a-z0-9]{4}$/.test(w) && /[a-z]/.test(w) && !["guia", "nueva", "orden"].includes(w))
        ?.toUpperCase() ?? null;
    c.nombre = null;
    return c;
  }
  // La clave solo se muestra o se propone enviar (pide «ENVIAR <pedido>»): vale en
  // cualquier largo, y gana aunque el mensaje mencione el adelanto.
  if (/\bclave\b/.test(n)) return comando("clave", n);
  // Consulta de información: solo si pregunta por un dato del pedido y dice cuál (número,
  // guía, celular o «pedido de …»), para que las preguntas de prueba al bot de ventas
  // («qué beneficios tiene?») no se tomen como orden.
  if (RE_CONSULTA.test(n) && RE_DATO_PEDIDO.test(n)) {
    const c = comando("estado", n);
    const dicePedido = c.numeros.some((t) => t.esPedido || (!t.esMonto && t.texto.length >= 3));
    if (c.guia || c.celular || dicePedido || (c.nombre && /\b(pedido|orden|guia)\b/.test(n))) return c;
  }
  // Las órdenes que registran plata o entregas («adelanto», «pago», «flete», «entregado») solo
  // valen en mensajes cortos o con la palabra al inicio. En un mensaje largo la palabra
  // puede ser solo contexto («no respondió cuando se le pidió el adelanto, cancélalo»):
  // ese lo interpreta la IA. Una negación («no pagó», «no mandó el adelanto») nunca confirma.
  if (!esOrdenCorta(n) || RE_NEGACION.test(n)) return null;
  // «Confirma el adelanto de Manuel orden 1153», «adelanto 1153», «valida adelanto 1153»
  if (/\badelanto\b/.test(n) && !/\bclave\b/.test(n)) {
    const c = comando("adelanto", n);
    // El adelanto es fijo (S/ 20): solo cuentan los números que pueden ser pedidos.
    c.numeros = c.numeros.filter((t) => !t.esMonto && (t.esPedido || t.texto.length >= 3));
    return c;
  }
  if (/\bflete\b/.test(n)) return comando("flete", n);
  if (/\b(entregado|entregada|recogio|ya recogio|lo recogio)\b/.test(n) && !/\bpag/.test(n)) {
    return comando("entregado", n);
  }
  if (/\b(pago|pagado|pagada|pagaron|pagó|yapeo|transfirio|deposito|cobrado|cobre)\b/.test(n)) {
    return comando("pago", n, /\b(completo|completa|todo|total)\b/.test(n));
  }
  return null;
}

/** «modo prueba» (el bot de ventas le contesta como a un cliente) o «modo asistente». */
export function interpretarModo(texto: string | null | undefined): "prueba" | "asistente" | null {
  if (!texto) return null;
  const n = normalizarTexto(texto).replace(/[.]+$/, "");
  if (/^(modo (prueba|cliente|ventas|bot de ventas)|probar (el )?bot( de ventas)?)$/.test(n)) return "prueba";
  if (/^(modo asistente|salir (del )?modo prueba|fin (de la )?prueba|termine (la )?prueba)$/.test(n)) return "asistente";
  return null;
}

/** «sí», «ok», «dale» sueltos: no confirman nada sin el número del pedido. */
export function esAfirmacionSuelta(texto: string | null | undefined): boolean {
  if (!texto) return false;
  const n = normalizarTexto(texto).replace(/[.]+/g, " ").trim();
  return /^(si|ok|okay|okey|dale|ya|listo|confirmo|confirmado|de acuerdo|hazlo|correcto|perfecto|va|claro|si hazlo|si dale|si confirmo|si por favor)$/.test(n);
}


/**
 * Último recurso cuando ni el intérprete fijo ni la IA entendieron el mensaje: si nombra un
 * pedido de forma explícita («ya tienes todo para agendar la entrega de la orden 1160?»),
 * se responde con la ficha de ese pedido. Nunca va al bot de ventas, que le contestaría a
 * Gerardo como si fuera el cliente.
 */
export function consultaPorPedidoExplicito(texto: string | null | undefined): Comando | null {
  if (!texto) return null;
  const n = normalizarTexto(texto);
  if (!n || n.length > 300) return null;
  if (!RE_PEDIDO_EXPLICITO.test(texto) && !RE_PEDIDO_EXPLICITO.test(n)) return null;
  return comando("estado", n);
}

const VERBOS_ORDEN =
  /^(?:por favor |porfa )?(confirma|confirmar|valida|validar|verifica|verificar|registra|registrar|marca|marcar|actualiza|actualizar|cambia|cambiar|pasa|pasar|aprueba|aprobar|anota|anotar)\b/;

/**
 * El texto parece una orden para el CRM aunque no se entendió («confirma lo de Manuel
 * 1153»): no debe ir al bot de ventas, que contestaría como si Gerardo fuera un cliente.
 */
export function pareceOrdenNoEntendida(texto: string | null | undefined): boolean {
  if (!texto) return false;
  const n = normalizarTexto(texto);
  if (!n || n.length > 200) return false;
  return VERBOS_ORDEN.test(n) && /(\d{3,}|\b(pedido|orden|cliente)\b)/.test(n);
}

const PALABRAS_CORRECCION =
  "no|nop|noo|era|es|el|la|del|pedido|orden|numero|nro|n|me|equivoque|equivocaste|equivocado|" +
  "perdon|disculpa|corrijo|correccion|corrige|otro|otra|sino|mejor|ese|ese no|de";
const RE_CORRECCION = new RegExp(
  `^(?:(?:${PALABRAS_CORRECCION})\\s+)*#?((?:leg|chat|aliv)-)?(\\d{3,})$`
);

/**
 * Corrección del pedido a mitad de una orden: «no no pedido es 1084», «era el 1084»,
 * «1084». Devuelve el token del pedido ("1084", "LEG-1066") o null. Solo acepta
 * palabras de relleno y un único número al final, para no confundir montos.
 */
export function interpretarCorreccion(texto: string | null | undefined): string | null {
  if (!texto) return null;
  const n = normalizarTexto(texto);
  if (!n || n.length > 60) return null;
  const m = n.match(RE_CORRECCION);
  if (!m) return null;
  return (m[1] ? m[1].toUpperCase() : "") + m[2];
}

/**
 * De los pedidos traídos por alguna palabra del nombre, deja los que más palabras tienen
 * en el nombre del contacto. Con dos o más palabras escritas exige al menos dos (un
 * «Carlos» suelto no basta para tomar el pedido de otro Carlos).
 */
export function mejoresPorNombre<T extends { contactName: string | null }>(palabras: string[], pedidos: T[]): T[] {
  if (!palabras.length) return [];
  const minimo = Math.min(2, palabras.length);
  const puntaje = (p: T) => {
    const nombre = normalizarTexto(p.contactName || "");
    return palabras.filter((w) => nombre.includes(w)).length;
  };
  const conPuntaje = pedidos.map((p) => ({ p, s: puntaje(p) }));
  const mejor = Math.max(0, ...conPuntaje.map((x) => x.s));
  if (mejor < minimo) return [];
  return conPuntaje.filter((x) => x.s === mejor).map((x) => x.p);
}

/** Dígitos del número de pedido: "#LEG-1049" -> "1049". */
export function digitosPedido(numeroOrden: string): string {
  return numeroOrden.match(/\d{3,}/)?.[0] ?? "";
}

/**
 * Separa el pedido y el monto entre los números del mensaje. `esPedidoExistente`
 * dice si un token corresponde a un pedido real.
 */
export function separarPedidoYMonto(
  numeros: TokenNumero[],
  esPedidoExistente: (t: TokenNumero) => boolean
): { pedido: TokenNumero | null; monto: number | null } {
  let pedido = numeros.find((t) => t.esPedido) ?? null;
  if (!pedido) pedido = numeros.find((t) => !t.esMonto && esPedidoExistente(t)) ?? null;
  const resto = numeros.filter((t) => t !== pedido);
  const monto = resto.find((t) => t.esMonto) ?? resto.find((t) => !t.esPedido) ?? null;
  return { pedido, monto: monto ? Math.round(monto.valor * 100) / 100 : null };
}
