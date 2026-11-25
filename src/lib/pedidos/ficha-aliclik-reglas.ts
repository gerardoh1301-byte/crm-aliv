/**
 * Ficha para registrar a mano en AliClik un pedido Shalom con guía propia (25/11).
 *
 * AliClik no tiene API para pedidos de agencia (la de integraciones solo crea contra entrega),
 * así que cuando la preguía, el código y la clave están cargados se le manda a Gerardo por
 * WhatsApp todo lo que pide el formulario «Agregar orden · Drop Shalom y Olva», listo para
 * copiar, y el recordatorio de pagar los S/5 con la billetera de AliClik.
 */

export const MARCA_FICHA_ALICLIK = "[ALICLIK_FICHA_AVISADA]";

export interface PedidoParaFicha {
  numeroOrden: string;
  transportadora: string | null;
  modalidadPago: string | null;
  numeroGuia: string | null;
  codigo: string | null;
  clave: string | null;
  dni: string | null;
  agencia: string | null;
  total: string | number | null;
  items: unknown;
  notas: string | null;
  cliente: string | null;
  telefono: string | null;
}

/** Hay que avisar: pedido Shalom con preguía, N° de orden, código y clave, aún sin orden AliClik. */
export function debeAvisarFicha(p: PedidoParaFicha): boolean {
  const notas = p.notas ?? "";
  const esShalom = /shalom/i.test(p.transportadora ?? "") || p.modalidadPago === "adelanto_agencia";
  if (!esShalom) return false;
  if (!p.numeroGuia || !p.codigo || !/^\d{4}$/.test(String(p.clave ?? "").trim())) return false;
  if (!notas.includes("[GUIA_PDF:")) return false;
  if (/\[ALICLIK_(?:WANKLIC_)?ORDEN:/i.test(notas) || notas.includes(MARCA_FICHA_ALICLIK)) return false;
  return true;
}

function productos(items: unknown): string {
  const lista = Array.isArray(items) ? (items as Array<{ cantidad?: number; titulo?: string }>) : [];
  return lista.map((i) => `${Number(i.cantidad) || 1}× ${String(i.titulo || "NAC600").trim()}`).join(", ") || "NAC600";
}

export function textoFichaAliclik(p: PedidoParaFicha): string {
  const tel = String(p.telefono ?? "").replace(/\D/g, "").slice(-9);
  return [
    `Pedido ${p.numeroOrden} listo para AliClik (Drop Shalom y Olva · pago Parcial · Canal Shopify):`,
    `• Nombre: ${(p.cliente ?? "").trim() || "-"}`,
    `• DNI: ${p.dni ?? "-"}`,
    `• Teléfono: ${tel || "-"}`,
    `• Productos: ${productos(p.items)} · total S/ ${Number(p.total ?? 0).toFixed(2)}`,
    `• Agencia destino: ${p.agencia ?? "-"}`,
    `• Guía Shalom: N° ${p.numeroGuia || "-"} · código ${p.codigo || "-"}`,
    `• Clave numérica: ${p.clave || "-"}`,
    `La preguía PDF está en Drive y en la tarjeta del pipeline. Cuando la registres, paga los S/5 con la billetera de AliClik.`,
  ].join("\n");
}

/** Lo que aún falta cargar para registrar el pedido en AliClik. */
export function faltantesFicha(p: PedidoParaFicha): string[] {
  const falta: string[] = [];
  if (!p.numeroGuia) falta.push("N° de orden Shalom");
  if (!p.codigo) falta.push("código de la guía");
  if (!/^\d{4}$/.test(String(p.clave ?? "").trim())) falta.push("clave numérica");
  if (!p.dni) falta.push("DNI");
  return falta;
}

/**
 * Respuesta a «datos de <pedido> para AliClik» en un pedido Shalom (25/11, #1181: el Bot
 * Asistente contestaba «no se registra en AliClik»). Los Shalom con guía propia sí van a AliClik
 * («Drop Shalom y Olva»), a mano; aquí van los datos y lo que falte.
 */
export function respuestaFichaShalom(p: PedidoParaFicha, ordenPrevia: string | null): string {
  if (ordenPrevia) return `Pedido ${p.numeroOrden} ya está registrado en AliClik (orden ${ordenPrevia}).`;
  const falta = faltantesFicha(p);
  const texto = textoFichaAliclik(p);
  return falta.length ? `${texto}\n⚠️ Falta cargar: ${falta.join(", ")}.` : texto;
}
