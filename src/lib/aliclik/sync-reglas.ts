/**
 * Reglas puras de la sincronización con AliClik (sin red ni base de datos, para probarlas).
 * Solo un pedido CONTRA ENTREGA con estado de entrega «entregado» pasa a Entregado.
 * Cualquier otro estado (en ruta, reprogramado, rechazado, devuelto, anulado) no cambia nada.
 */

export interface OrdenMin {
  orderNumber: string;
  deliveryStatus: string;
  deliveryStatusLabel?: string | null;
  trackingStatus?: string | null;
  trackingStatusLabel?: string | null;
  deliveryType: string;
  total: number;
  /** Fecha programada de entrega (solo en el detalle del pedido: shipping.scheduledDate). */
  scheduledDate?: string | null;
}

export interface DecisionAliclik {
  accion: "marcar_entregado" | "marcar_en_camino" | "sin_cambios" | "no_encontrado" | "solo_informar";
  motivo: string;
}

const NEGATIVO = /\b(no\s+entregad|rechaz|devuel|devoluc|anulad|cancelad|fallid|pendiente|reprogram|en\s+ruta|por\s+entregar)/i;
const ENTREGADO = /\b(entregad[oa]|delivered)\b/i;

export function decidirEntregaAliclik(orden: OrdenMin | null | undefined): DecisionAliclik {
  if (!orden) return { accion: "no_encontrado", motivo: "No se encontró el pedido en AliClik" };
  const estado = `${orden.deliveryStatus ?? ""} ${orden.deliveryStatusLabel ?? ""}`.trim();
  if (orden.deliveryType !== "CASH_ON_DELIVERY") {
    return { accion: "solo_informar", motivo: `Pedido de agencia: lo sigue el chequeo de Shalom (${estado || "sin estado"})` };
  }
  if (ENTREGADO.test(estado) && !NEGATIVO.test(estado)) {
    return { accion: "marcar_entregado", motivo: `estado de entrega «${estado}»` };
  }
  return { accion: "sin_cambios", motivo: `estado de entrega «${estado || "sin estado"}»` };
}

/** Entre los pedidos de AliClik de ese celular, el de total más parecido (contra entrega primero). */
export function elegirOrdenAliclik<T extends OrdenMin>(items: T[], totalCrm: number): T | null {
  if (!items.length) return null;
  const ordenados = [...items].sort((a, b) => {
    const da = Math.abs((Number(a.total) || 0) - totalCrm);
    const dbb = Math.abs((Number(b.total) || 0) - totalCrm);
    return da - dbb;
  });
  const mejor = ordenados[0];
  // Si el total no se parece (más de S/ 30 de diferencia), no es seguro que sea el mismo pedido.
  if (totalCrm > 0 && Math.abs((Number(mejor.total) || 0) - totalCrm) > 30) return null;
  return mejor;
}

/**
 * La lista de AliClik oculta el centro del celular ("51993***569"). Se comparan los dígitos
 * visibles (inicio y final) con el celular del CRM; si viene completo, se compara entero.
 */
export function mismoCelular(deAliclik: string | null | undefined, cel9: string): boolean {
  const v = String(deAliclik ?? "").replace(/\s|\+|-/g, "");
  if (!v || cel9.length !== 9) return false;
  if (!v.includes("*")) return v.replace(/\D/g, "").slice(-9) === cel9;
  const [ini, fin] = [v.slice(0, v.indexOf("*")), v.slice(v.lastIndexOf("*") + 1)];
  const iniSin51 = ini.length > 9 ? ini : ini.replace(/^51/, "");
  if (iniSin51.length < 2 || fin.length < 2) return false;
  return cel9.startsWith(iniSin51) && cel9.endsWith(fin);
}


/** Fecha de Lima (UTC−5) en YYYY-MM-DD. */
function diaLima(ms: number): string {
  return new Date(ms - 5 * 3600_000).toISOString().slice(0, 10);
}

/**
 * Contra entrega «Por entregar» cuya fecha programada ya llegó: está en reparto (26/11, #1183).
 * La API de AliClik no dice cuándo sale el paquete del almacén (solo Por entregar, Reprogramado,
 * Entregado, No contesta, Cancelado), pero sí la fecha programada: ese día el courier lo reparte.
 */
export function enCaminoAliclik(orden: OrdenMin | null | undefined, ahora: Date = new Date()): boolean {
  if (!orden || orden.deliveryType !== "CASH_ON_DELIVERY" || orden.deliveryStatus !== "PENDING_DELIVERY") return false;
  const ms = Date.parse(String(orden.scheduledDate ?? ""));
  if (Number.isNaN(ms)) return false;
  return diaLima(ms) <= diaLima(ahora.getTime());
}
