/**
 * Mejora 3 (informe CRM Driven, 24/11): «Confirmado por bot (por validar)» separado de
 * «Pedido confirmado (por despachar)». Reglas puras para la tarjeta y la ruta de validación.
 */
export const MARCA_VALIDADO = "[VALIDADO]";

export type TipoValidacion = "yape" | "direccion";

/**
 * AG (provincia por Shalom, el bot lo deja en por_confirmar_cod): falta verificar el Yape de S/20.
 * CE (Lima, el bot lo deja en confirmado): falta revisar dirección, referencia y ubicación.
 */
export function tipoValidacion(p: { estado: string | null; modalidadPago: string | null }): TipoValidacion {
  return p.estado === "por_confirmar_cod" || p.modalidadPago === "adelanto_agencia" ? "yape" : "direccion";
}

export function etiquetaValidacion(t: TipoValidacion): string {
  return t === "yape" ? "⏳ Por validar Yape" : "⏳ Por validar dirección";
}

export function mensajeValidado(numeroVisible: string): string {
  return `✅ *Pedido confirmado:* Hemos validado tus datos correctamente y tu pedido ${numeroVisible} ya pasó al área de despacho.`;
}

export function yaValidado(notas: string | null | undefined): boolean {
  return (notas ?? "").includes(MARCA_VALIDADO);
}
