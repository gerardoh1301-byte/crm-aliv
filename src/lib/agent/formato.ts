/** WhatsApp usa *negrita* y _cursiva_: el Markdown del modelo (**x**, __x__, ### titulos) se ve con simbolos sueltos. */
export function limpiarFormatoWhatsApp(texto: string): string {
  return texto
    .replace(/\*\*(.+?)\*\*/g, "*$1*")
    .replace(/__(.+?)__/g, "_$1_")
    .replace(/^#{1,6}\s+(.+)$/gm, "*$1*");
}
