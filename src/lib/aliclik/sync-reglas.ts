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
}

export interface DecisionAliclik {
  accion: "marcar_entregado" | "sin_cambios" | "no_encontrado" | "solo_informar";
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
