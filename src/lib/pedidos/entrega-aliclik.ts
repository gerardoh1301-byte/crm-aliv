/**
 * ¿El pedido es contra entrega por AliClik (Lima o provincia con cobertura)? (26/11, #1183)
 * La tarjeta del pipeline trataba como Shalom todo pedido fuera de Lima y mostraba «Guía
 * Shalom» y «Registrar dinero Shalom» en un contra entrega de Huaraz ya registrado en AliClik.
 * Un pedido Shalom (adelanto, guía o clave) nunca cuenta aquí, aunque AliClik lleve el paquete
 * a la agencia y tenga [ALICLIK_ORDEN:…].
 */
export function esContraEntregaAliclik(p: {
  transportadora?: string | null;
  modalidadPago?: string | null;
  notas?: string | null;
  numeroGuia?: string | null;
  claveRecojo?: string | null;
}): boolean {
  const transportadora = p.transportadora ?? "";
  const notas = p.notas ?? "";
  if (/shalom/i.test(transportadora) || p.modalidadPago === "adelanto_agencia" || p.numeroGuia || p.claveRecojo) {
    return false;
  }
  return /aliclik/i.test(transportadora) || /\[ENTREGA_WEB:CE\|/i.test(notas) || /\[ALICLIK_ORDEN:/i.test(notas);
}
