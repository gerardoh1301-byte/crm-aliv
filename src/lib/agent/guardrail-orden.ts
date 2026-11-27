import { mostrarNumeroOrden } from "@/lib/pedidos/numero-formato";
export interface OrdenVerificada {
  numeroOrden: string | null;
  total: number;
  unidades: number;
  producto?: string;
  claveRecojo?: string | null;
  adelanto?: number;
}

export interface ResultadoGuardrailOrden {
  bloqueado: boolean;
  requiereHumano: boolean;
  motivo?:
    | "clave_recojo_prohibida"
    | "monto_contradice_orden"
    | "cantidad_contradice_orden"
    | "dato_orden_inexistente";
  detalle?: string;
  textoSeguro: string;
}

/**
 * Extrae las unidades totales y el monto numérico de una fila de `pedidos_ordenes`.
 */
export function construirOrdenVerificada(pedido: {
  numeroOrden?: string | null;
  total?: string | number | null;
  items?: unknown;
  claveRecojo?: string | null;
  notas?: string | null;
} | null | undefined): OrdenVerificada | null {
  if (!pedido) return null;
  const total = Number(pedido.total) || 0;
  if (total <= 0) return null;

  let unidades = 0;
  let producto = "NAC600";
  if (Array.isArray(pedido.items) && pedido.items.length > 0) {
    for (const item of pedido.items as Array<{
      cantidad?: number | string;
      titulo?: string;
      nombre?: string;
    }>) {
      unidades += Number(item?.cantidad) || 0;
      const nom = String(item?.titulo || item?.nombre || "");
      if (/termix|tobillera/i.test(nom)) producto = "Termix";
    }
  }
  if (unidades <= 0) unidades = 1;

  return {
    numeroOrden: pedido.numeroOrden ?? null,
    total,
    unidades,
    producto,
    claveRecojo: pedido.claveRecojo ?? null,
    adelanto: 20,
  };
}

/**
 * Instrucción para la segunda vuelta del modelo cuando su respuesta mencionó un monto o una
 * cantidad que no calzan con la orden (27/11).
 */
export function correccionGuardrailOrden(orden: OrdenVerificada, detalle?: string): string {
  const adelanto = orden.adelanto ?? 20;
  const saldo = Math.max(0, orden.total - adelanto);
  const num = orden.numeroOrden ? ` ${mostrarNumeroOrden(orden.numeroOrden)}` : "";
  return [
    `Tu respuesta anterior NO se envió porque tenía un dato equivocado${detalle ? ` (${detalle})` : ""}.`,
    `Datos reales del pedido${num}: ${orden.unidades} ${orden.unidades === 1 ? "unidad" : "unidades"} de ${orden.producto ?? "NAC600"}, total S/ ${orden.total.toFixed(2)}; adelanto S/ ${adelanto.toFixed(2)}; saldo S/ ${saldo.toFixed(2)}.`,
    "Vuelve a responder al ÚLTIMO mensaje del cliente, corto y natural. No menciones ningún otro monto ni otra cantidad; si no hace falta hablar de montos, no los menciones. No des claves de recojo.",
  ].join(" ");
}

function armarMensajeDerivacionSeguro(
  orden: OrdenVerificada | null,
  motivo: string
): string {
  if (orden) {
    const numTxt = orden.numeroOrden
      ? ` ${mostrarNumeroOrden(orden.numeroOrden)}`
      : "";
    return `Un asesor de nuestro equipo está revisando en este momento tu pedido${numTxt} (${orden.unidades} ${orden.unidades === 1 ? "unidad" : "unidades"} por S/ ${orden.total.toFixed(2)}) y te responderá por aquí en unos minutos para atenderte personalmente. 🙌`;
  }
  if (motivo === "clave_recojo_prohibida") {
    return "Nuestro equipo de administración verificará tu abono y un asesor humano te compartirá tu clave de retiro por aquí en unos minutos. 🙌";
  }
  return "Un asesor de nuestro equipo revisará los datos de tu pedido y te responderá por aquí en unos minutos. 🙌";
}

/**
 * C2 Guardrail determinista:
 * - Prohíbe terminantemente que el bot escriba cualquier clave de retiro/recojo (oficial o inventada como "0011").
 * - Prohíbe que el bot mencione una cantidad de frascos/unidades o un monto/saldo que contradiga la orden activa.
 * - Si no existe orden activa y el bot intenta afirmar una clave o un saldo específico de pedido, lo bloquea y pasa a humano.
 */
export function validarRespuestaBotContraOrden(
  textoRespuesta: string,
  ordenActiva: OrdenVerificada | null
): ResultadoGuardrailOrden {
  const texto = (textoRespuesta || "").trim();
  if (!texto) {
    return {
      bloqueado: false,
      requiereHumano: false,
      textoSeguro: texto,
    };
  }

  // 1. Detectar si el bot intenta dar o mencionar un código/clave de recojo o retiro
  const regexClaveExplicita =
    /(?:tu\s+clave(?:\s+secreta)?(?:\s+de)?\s*(?:recojo|retiro)?|clave\s+de\s+(?:recojo|retiro)|c[oó]digo\s+(?:secreto\s+)?de\s+(?:recojo|retiro)|clave\s+secreta)\s*(?:es|:|ser[ií]a|-)?\s*[\(\*\["']?\s*\d{3,6}(?:-\d{3,6})?\s*[\)\*\]"']?/i;
  const regexClaveParentesis =
    /clave\s+(?:de\s+)?(?:recojo|retiro)\s*\(\s*[^)]*\d+[^)]*\)/i;
  const regexClaveConocida =
    ordenActiva?.claveRecojo && ordenActiva.claveRecojo.trim().length >= 3
      ? new RegExp(
          `\\b${ordenActiva.claveRecojo.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`,
          "i"
        )
      : null;

  if (
    regexClaveExplicita.test(texto) ||
    regexClaveParentesis.test(texto) ||
    /\bclave\b[^.\n]{0,30}\b0011\b/i.test(texto) ||
    (regexClaveConocida && regexClaveConocida.test(texto))
  ) {
    return {
      bloqueado: true,
      requiereHumano: true,
      motivo: "clave_recojo_prohibida",
      detalle: "El bot intentó escribir una clave de recojo/retiro.",
      textoSeguro: armarMensajeDerivacionSeguro(
        ordenActiva,
        "clave_recojo_prohibida"
      ),
    };
  }

  // Detectar si el mensaje habla del pedido, saldo, recojo o pago del cliente (no una simple lista del catálogo)
  const esListadoCatalogo =
    /1\s*(?:frasco|x|unidad)[^.\n]*119[^.\n]*2\s*(?:frascos|x|unidades)[^.\n]*189/i.test(
      texto
    ) ||
    /1\s*(?:tobillera|x|unidad)[^.\n]*79[^.\n]*2\s*(?:tobilleras|x|unidades)[^.\n]*139/i.test(
      texto
    );

  const hablaDePedidoOSaldo =
    /\b(tu\s+pedido|tu\s+orden|tu\s+saldo|el\s+saldo|saldo\s+restante|saldo\s+pendiente|restar[ií]a|resta\s+pagar|queda\s+un\s+saldo|para\s+liberar\s+tu\s+clave|clave\s+de\s+recojo|clave\s+de\s+retiro)\b/i.test(
      texto
    );

  // 2. Si NO tiene orden activa pero el bot afirma un saldo restante o una clave de un pedido supuesto.
  // En plena venta es normal decir "te dejo tu pedido separado: 2 tobilleras por S/139" o explicar
  // "adelanto de S/20 y el saldo lo pagas cuando llegue": eso NO se bloquea (antes se bloqueaba y
  // el cliente recibía "un asesor revisará tu pedido" a mitad del cierre). Solo se bloquea un monto
  // de saldo concreto ("saldo de S/169", "te faltan S/99") o la mención de liberar una clave.
  const afirmaSaldoConcreto =
    /(saldo(?:\s+(?:restante|pendiente))?|resta(?:n)?(?:\s+pagar)?|restar[ií]a|te\s+falta(?:n)?|queda(?:n)?\s+(?:un\s+saldo\s+)?(?:de|por\s+pagar))[^.\n]{0,30}?S\/\s*\d+/i.test(texto) ||
    /(liberar\s+tu\s+clave|clave\s+de\s+(?:recojo|retiro))[^.\n]*S\/\s*\d+|S\/\s*\d+[^.\n]*(liberar\s+tu\s+clave|clave\s+de\s+(?:recojo|retiro))/i.test(texto);
  if (!ordenActiva && hablaDePedidoOSaldo && !esListadoCatalogo) {
    if (afirmaSaldoConcreto) {
      return {
        bloqueado: true,
        requiereHumano: true,
        motivo: "dato_orden_inexistente",
        detalle:
          "El bot mencionó un monto o saldo de pedido sin que exista una orden activa leída en la base de datos.",
        textoSeguro: armarMensajeDerivacionSeguro(
          null,
          "dato_orden_inexistente"
        ),
      };
    }
  }

  // 3. Si SÍ tiene orden activa, validar que ni las unidades ni los montos contradigan la orden real
  if (ordenActiva && (hablaDePedidoOSaldo || !esListadoCatalogo)) {
    // 3a. Validar unidades mencionadas ("3 frascos", "3 unidades") cuando la orden tiene otra cantidad
    const matchesUnidades = [
      ...texto.matchAll(
        /\b(\d+)\s*(?:frascos?|unidades?|cajas?|tobilleras?)\b/gi
      ),
    ];
    for (const m of matchesUnidades) {
      const cantMencionada = parseInt(m[1], 10);
      // Ignorar "60 cápsulas"
      if (
        Number.isFinite(cantMencionada) &&
        cantMencionada >= 1 &&
        cantMencionada <= 10 &&
        cantMencionada !== ordenActiva.unidades &&
        !esListadoCatalogo
      ) {
        return {
          bloqueado: true,
          requiereHumano: true,
          motivo: "cantidad_contradice_orden",
          detalle: `El bot mencionó ${cantMencionada} unidades pero la orden ${ordenActiva.numeroOrden ?? ""} es de ${ordenActiva.unidades} unidades.`,
          textoSeguro: armarMensajeDerivacionSeguro(
            ordenActiva,
            "cantidad_contradice_orden"
          ),
        };
      }
    }

    // 3b. Validar montos S/ mencionados
    const adelanto = ordenActiva.adelanto ?? 20;
    const saldoConAdelanto = Math.max(0, ordenActiva.total - adelanto);
    const montosPermitidos = new Set<number>([
      Math.round(ordenActiva.total * 100),
      Math.round(adelanto * 100),
      Math.round(saldoConAdelanto * 100),
    ]);

    const matchesMontos = [
      ...texto.matchAll(/S\/\s*(\d+(?:\.\d{1,2})?)/gi),
    ];
    for (const m of matchesMontos) {
      const valor = parseFloat(m[1]);
      if (!Number.isFinite(valor)) continue;
      const centavos = Math.round(valor * 100);
      if (!montosPermitidos.has(centavos) && !esListadoCatalogo) {
        return {
          bloqueado: true,
          requiereHumano: true,
          motivo: "monto_contradice_orden",
          detalle: `El bot mencionó S/ ${valor} pero la orden ${ordenActiva.numeroOrden ?? ""} tiene total S/ ${ordenActiva.total} (saldo S/ ${saldoConAdelanto}).`,
          textoSeguro: armarMensajeDerivacionSeguro(
            ordenActiva,
            "monto_contradice_orden"
          ),
        };
      }
    }
  }

  return {
    bloqueado: false,
    requiereHumano: false,
    textoSeguro: texto,
  };
}
