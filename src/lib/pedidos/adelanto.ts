import { extraerDatosFormularioShopify } from "@/lib/shopify/form-extractor";

/** Marca que deja "Adelanto confirmado" en las notas del pedido. */
export const MARCA_ADELANTO_VERIFICADO = "[ADELANTO VERIFICADO]";

export function esPedidoDeProvincia(p: { ciudad: string | null; distrito: string | null; direccionEnvio: string | null }): boolean {
  const ciudad = p.ciudad || p.distrito;
  if (!ciudad) return false;
  return extraerDatosFormularioShopify({
    shipping_address: { city: ciudad, address1: p.direccionEnvio ?? "" },
    ...(p.distrito && p.distrito !== ciudad ? { note_attributes: [{ name: "Distrito", value: p.distrito }] } : {}),
  }).esProvincia;
}

export function adelantoRegistrado(notas: string | null | undefined): boolean {
  return (notas ?? "").includes(MARCA_ADELANTO_VERIFICADO);
}

/** "S/20 verificado por Gerardo el 12/11 15:04" -> quien verifico (para mostrar en la tabla). */
export function quienVerificoAdelanto(notas: string | null | undefined): string | null {
  const m = /\[ADELANTO VERIFICADO\][^\n]*?verificado por ([^\n]+?)(?: el |\n|$)/.exec(notas ?? "");
  return m ? m[1].trim() : null;
}
