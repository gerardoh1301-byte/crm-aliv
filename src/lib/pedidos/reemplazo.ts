/**
 * Cuando un cliente vuelve a llenar el formulario (o el bot le registra otro pedido) con
 * un pedido anterior todavía abierto, el nuevo reemplaza al anterior: queda una sola
 * tarjeta por cliente en "Pedido confirmado" y nadie despacha dos veces.
 *
 * No se reemplaza lo que ya avanzó (guía, orden en AliClik, adelanto verificado) ni un
 * pedido de otro producto (p. ej. la oferta Termix después de comprar NAC600).
 */

export const MARCA_REEMPLAZADO = "[REEMPLAZADO]";

const ESTADOS_ABIERTOS = new Set(["por_confirmar_cod", "confirmado", "preparando"]);

export function familiaProducto(titulo: string): string {
  const t = titulo.toLowerCase();
  if (/nac\s?600|nad/.test(t)) return "nac600";
  if (/termix|tobill|hombr|rodill/.test(t)) return "termix";
  return t.replace(/\s+/g, " ").trim();
}

export function familias(items: readonly { titulo: string }[] | null | undefined): Set<string> {
  return new Set((items ?? []).map((i) => familiaProducto(i.titulo ?? "")).filter(Boolean));
}

export interface PedidoPrevio {
  estado: string;
  numeroGuia: string | null;
  notas: string | null;
  items: readonly { titulo: string }[] | null;
}

export function esReemplazable(previo: PedidoPrevio, itemsNuevos: readonly { titulo: string }[]): boolean {
  if (!ESTADOS_ABIERTOS.has(previo.estado)) return false;
  if (previo.numeroGuia) return false;
  const notas = previo.notas ?? "";
  if (/\[ALICLIK_ORDEN:/i.test(notas) || notas.includes("[ADELANTO VERIFICADO]")) return false;
  const nuevas = familias(itemsNuevos);
  const viejas = familias(previo.items);
  // Sin productos legibles en alguno de los dos: se trata como el mismo pedido.
  if (nuevas.size === 0 || viejas.size === 0) return true;
  return [...viejas].some((f) => nuevas.has(f));
}
