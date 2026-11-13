const YAPE_ADELANTO = "951365418";

/**
 * WhatsApp usa *negrita* y _cursiva_: el Markdown del modelo (**x**, __x__, ### titulos)
 * se ve con simbolos sueltos. Las viñetas "* " o "- " de Markdown salen como asteriscos o
 * guiones sueltos, asi que se cambian por "• ". Ademas aplica las guardas de venta.
 */
export function limpiarFormatoWhatsApp(texto: string): string {
  const limpio = quitarLlamadasEscritas(texto)
    .replace(/\*\*(.+?)\*\*/g, "*$1*")
    .replace(/__(.+?)__/g, "_$1_")
    .replace(/^#{1,6}\s+(.+)$/gm, "*$1*")
    .replace(/^[ \t]*[*-][ \t]+/gm, "• ");
  return aplicarGuardasDeVenta(limpio);
}

const HERRAMIENTAS =
  "enviar_imagen_referencia|registrar_actividad|actualizar_contacto|mover_etapa|crear_pedido_chat|avisar_asesor|derivar_asesor|agendar_entrega|resumen_lead|confirmar_pedido|consultar_pedido|solicitar_soporte_pedido";

/**
 * A veces el modelo escribe la llamada a una herramienta como texto
 * (`registrar_actividad(descripcion='...')`) en vez de ejecutarla: eso no puede llegar
 * al cliente. Se quita la llamada (con o sin comillas invertidas) y las lineas vacias que deja.
 */
export function quitarLlamadasEscritas(texto: string): string {
  const llamada = new RegExp("`?\\b(?:" + HERRAMIENTAS + ")\\s*\\([^)]*\\)`?", "g");
  return texto
    .replace(llamada, "")
    .replace(/`[a-z]+(?:_[a-z]+)+\([^`]*\)`/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Reglas que el modelo a veces olvida y que no pueden fallar:
 * - Si menciona el adelanto de S/20, el mensaje lleva el Yape (regla 5 del prompt).
 * - "Excelente elección/decisión" suena a plantilla: se cambia por "Perfecto".
 */
export function aplicarGuardasDeVenta(texto: string): string {
  // Solo al inicio de una oracion ("Es una excelente elección para..." se deja como esta).
  let t = texto.replace(
    /(^|[.!?]\s+|\n)(¡?)Excelente (?:elecci[oó]n|decisi[oó]n)(!|,)?/g,
    (_m, antes: string, abre: string, p: string | undefined) =>
      `${antes}${p === "!" ? "¡Perfecto!" : `${abre}Perfecto${p ?? ""}`}`,
  );
  // El bot no decide la fecha de despacho: "para despacharlo hoy mismo" -> "para despacharlo".
  t = t.replace(/,?\s+hoy mismo\b/gi, "");
  // "para enviártela hoy" / "lo despachamos hoy" -> sin "hoy".
  t = t.replace(/((?:envi|despach|mand)\p{L}*)\s+hoy(?!\p{L})/giu, "$1");
  // "Es un complemento seguro" tambien promete: queda "Es un complemento".
  t = t.replace(/\b(complemento|suplemento|producto)( 100%)? segur[oa]\b/gi, "$1");
  // Subida mal calculada: de 1 a 3 frascos son S/80, no S/70 (S/70 es de 1 a 2).
  t = t.replace(/S\/\s?70(?=[^.?!\n]{0,120}(?:pack de 3|3 frascos|tres frascos|el de 3|90 d[ií]as))/gi, "S/80");
  // "No causa efectos secundarios" es una promesa de salud: se quita esa frase.
  // La letra que sigue a lo quitado pasa a mayuscula (inicio de la oracion siguiente).
  t = t.replace(
    /[^.;\n]*\bno (?:causa|tiene|produce|genera|presenta)\b[^.;\n]*efectos secundarios[^.;\n]*[.;]\s*(?:sin embargo,?\s*)?(\p{Ll})?/giu,
    (_m, letra: string | undefined) => (letra ? letra.toUpperCase() : ""),
  );
  const mencionaAdelanto = /S\/\s?20\b/.test(t) && /adelant|separ|reserv/i.test(t);
  if (mencionaAdelanto && !/951\s?365\s?418/.test(t)) {
    // En linea, junto al monto: agregado al final quedaba despues de la pregunta de cierre.
    t = t.replace(/\*?S\/\s?20\b\*?/, (m) => `${m} por Yape al *${YAPE_ADELANTO}* (Gerardo Huaynalaya)`);
  }
  return t;
}
