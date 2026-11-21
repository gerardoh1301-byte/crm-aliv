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
  | "adelanto";

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
  /** Orden «guia»: número de orden Shalom (8-10 cifras) y código alfanumérico. */
  guia?: string | null;
  codigo?: string | null;
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

function extraerNombre(normalizado: string): string | null {
  const palabras = normalizado
    .replace(/s\/\s*\d+(?:[.,]\d{1,2})?/g, " ")
    .replace(/#?\b(?:(?:leg|chat|aliv)-)?\d+(?:[.,]\d{1,2})?\b/g, " ")
    .replace(/[^a-zñ\s]/g, " ")
    .split(/\s+/)
    .filter((p) => p.length >= 3 && !PALABRAS_RELLENO.has(p));
  return palabras.length ? palabras.slice(0, 3).join(" ") : null;
}

function comando(tipo: TipoComando, n: string, completo = false): Comando {
  return { tipo, numeros: extraerNumeros(n), nombre: extraerNombre(n), completo };
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
  if (/^(estado|como va|donde esta|info)\b/.test(n)) return comando("estado", n);
  if (/^(guia|nueva guia)\b/.test(n)) {
    const c = comando("guia", n);
    const guia = c.numeros.find((t) => /^\d{8,10}$/.test(t.texto)) ?? null;
    c.numeros = c.numeros.filter((t) => t !== guia);
    c.guia = guia?.texto ?? null;
    c.codigo =
      n
        .split(" ")
        .find((w) => /^[a-z0-9]{4}$/.test(w) && /[a-z]/.test(w) && !["guia", "nueva", "orden"].includes(w))
        ?.toUpperCase() ?? null;
    c.nombre = null;
    return c;
  }
  // «Confirma el adelanto de Manuel orden 1153», «adelanto 1153», «valida adelanto 1153»
  if (/\badelanto\b/.test(n) && !/\bclave\b/.test(n)) {
    const c = comando("adelanto", n);
    // El adelanto es fijo (S/ 20): solo cuentan los números que pueden ser pedidos.
    c.numeros = c.numeros.filter((t) => !t.esMonto && (t.esPedido || t.texto.length >= 3));
    return c;
  }
  if (/\bclave\b/.test(n)) return comando("clave", n);
  if (/\bflete\b/.test(n)) return comando("flete", n);
  if (/\b(entregado|entregada|recogio|ya recogio|lo recogio)\b/.test(n) && !/\bpag/.test(n)) {
    return comando("entregado", n);
  }
  if (/\b(pago|pagado|pagada|pagaron|pagó|yapeo|transfirio|deposito|cobrado|cobre)\b/.test(n)) {
    return comando("pago", n, /\b(completo|completa|todo|total)\b/.test(n));
  }
  return null;
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
