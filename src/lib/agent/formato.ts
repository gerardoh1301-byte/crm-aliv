const YAPE_ADELANTO = "951365418";

/**
 * WhatsApp usa *negrita* y _cursiva_: el Markdown del modelo (**x**, __x__, ### titulos)
 * se ve con simbolos sueltos. Las viñetas "* " o "- " de Markdown salen como asteriscos o
 * guiones sueltos, asi que se cambian por "• ". Ademas aplica las guardas de venta.
 */
export function limpiarFormatoWhatsApp(texto: string): string {
  const limpio = texto
    .replace(/\*\*(.+?)\*\*/g, "*$1*")
    .replace(/__(.+?)__/g, "_$1_")
    .replace(/^#{1,6}\s+(.+)$/gm, "*$1*")
    .replace(/^[ \t]*[*-][ \t]+/gm, "• ");
  return aplicarGuardasDeVenta(limpio);
}

/**
 * Reglas que el modelo a veces olvida y que no pueden fallar:
 * - Si menciona el adelanto de S/20, el mensaje lleva el Yape (regla 5 del prompt).
 * - "Excelente elección" suena a plantilla: se cambia por "Perfecto".
 */
export function aplicarGuardasDeVenta(texto: string): string {
  let t = texto.replace(/(¡?)\s*Excelente elecci[oó]n\s*(!|,)?/gi, (_m, abre: string, p: string | undefined) =>
    p === "!" ? "¡Perfecto!" : `${abre}Perfecto,`,
  );
  const mencionaAdelanto = /S\/\s?20\b/.test(t) && /adelant|separ|reserv/i.test(t);
  if (mencionaAdelanto && !/951\s?365\s?418/.test(t)) {
    t = `${t}\n\nEl adelanto lo haces por Yape al *${YAPE_ADELANTO}* (Gerardo Huaynalaya).`;
  }
  return t;
}
