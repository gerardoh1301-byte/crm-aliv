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

/**
 * Remueve saludos repetitivos al inicio del mensaje cuando la conversación
 * ya está en curso (ej: "¡Hola, Hilda! ", "Hola Hilda, ", "¡Hola! 👋 ", "¡Hola DJ! ", "¡Hola, HILDA! ").
 * Evita que el bot salude en cada turno de un mismo chat, preservando un tono humano y cercano.
 */
export function removerSaludoRepetido(texto: string): string {
  let t = texto.trim();

  // 1. Saludo con nombre del cliente seguido de puntuación o emoji:
  // ej: "¡Hola, Hilda! ", "Hola Hilda, ", "¡Hola Hilda! 👋 ", "¡Hola DJ! ", "¡Hola, HILDA! ", "Buenas tardes Carlos, "
  const saludoConNombre =
    /^(?:¡?\s*hola|\bbuen(?:as|os)?\s+(?:d[ií]as|tardes|noches)),?\s+([\p{L}\d_-]+(?:\s+[\p{L}\d_-]+)?)[!.,]?\s*(?:[\p{Extended_Pictographic}\u200d\uFE0F]+[!,.]?)?\s*/iu;

  // 2. Saludo genérico simple o con emoji:
  // ej: "¡Hola! ", "Hola, ", "¡Hola! 👋 ", "Buenos días. "
  const saludoSimple =
    /^(?:¡?\s*hola[!,.]?|\bbuen(?:as|os)?\s+(?:d[ií]as|tardes|noches)[!,.]?)\s*(?:[\p{Extended_Pictographic}\u200d\uFE0F]+[!,.]?)?\s*/iu;

  let cambiado = true;
  while (cambiado) {
    cambiado = false;
    if (saludoConNombre.test(t)) {
      const sig = t.replace(saludoConNombre, "").trim();
      if (sig && sig !== t) {
        t = sig;
        cambiado = true;
        continue;
      }
    }
    if (saludoSimple.test(t)) {
      const sig = t.replace(saludoSimple, "").trim();
      if (sig && sig !== t) {
        t = sig;
        cambiado = true;
        continue;
      }
    }
  }

  if (!t) return texto;
  return t.charAt(0).toUpperCase() + t.slice(1);
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
  // Guarda: eliminar términos como cápsula blanda, cápsulas blandas, softgel, softgels -> cápsulas
  t = t.replace(/\bc[aá]psulas?\s+blandas?\b/gi, (m) => (/blandas/i.test(m) ? "cápsulas" : "cápsula"));
  t = t.replace(/\bsoftgels?\b/gi, (m) => (/s$/i.test(m) ? "cápsulas" : "cápsula"));
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
  // Guarda: precios oficiales de Termix Tobillera (1x S/79, 2x S/139, 3x S/189)
  t = t.replace(/(?:tobillera|termix)[^.?!\n]{0,80}S\/\s?99\b/gi, (m) => m.replace(/99/, "79"));
  t = t.replace(/(?:tobillera|termix)[^.?!\n]{0,80}S\/\s?169\b/gi, (m) => m.replace(/169/, "139"));
  t = t.replace(/(?:tobillera|termix)[^.?!\n]{0,80}S\/\s?219\b/gi, (m) => m.replace(/219/, "189"));
  t = t.replace(/S\/\s?99(?=[^.?!\n]{0,80}(?:tobillera|termix))/gi, "S/79");
  t = t.replace(/S\/\s?169(?=[^.?!\n]{0,80}(?:tobillera|termix))/gi, "S/139");
  t = t.replace(/S\/\s?219(?=[^.?!\n]{0,80}(?:tobillera|termix))/gi, "S/189");

  // Guarda médica: sustituir "porción" por "dosis diaria" o "dosis"
  t = t.replace(/\bpor porci[oó]n\b/gi, "por dosis diaria (2 cápsulas)");
  t = t.replace(/\buna porci[oó]n\b/gi, "una dosis");
  t = t.replace(/\bcada porci[oó]n\b/gi, "cada dosis");
  t = t.replace(/\bporciones\b/gi, "dosis");

  // Guarda logística: domingos no hay envíos
  t = t.replace(/\b(?:los\s+)?domingos?\s+(?:hay|hacemos|tenemos|se\s+hacen)\s+env[ií]os\b/gi, "los envíos se realizan de lunes a sábado (los domingos no hay repartos)");
  t = t.replace(/\b(?:el\s+)?domingo\s+te\s+lo\s+(?:enviamos|llevamos|entregamos)\b/gi, "las entregas son de lunes a sábado, te lo podemos entregar el sábado o lunes");

  // Guarda Shalom: prohibir decir que se paga en la ventanilla o en la misma agencia Shalom
  t = t.replace(
    /\b(?:lo\s+pagas|se\s+cancela|se\s+paga)\s+(?:directamente\s+|reci[eé]n\s+)?(?:en\s+la\s+ventanilla\s+de\s+la\s+agencia(?:\s+Shalom)?|en\s+la\s+misma\s+agencia(?:\s+Shalom)?)(?:\s+al\s+momento\s+de\s+(?:retirar|recibir)\s+tu\s+paquete)?/gi,
    `nos lo transfieres por Yape o Plin al *${YAPE_ADELANTO}* (Gerardo Huaynalaya) cuando llegue a la agencia para enviarte tu clave secreta de retiro`,
  );

  // Guarda anti-vocativos robóticos (ej. "¡Perfecto, anacarrera2318!", "¡Hola 51945226853!")
  t = t.replace(
    /(\b(?:Hola|Perfecto|Genial|Excelente|Entendido|Listo|Claro(?:\s+que\s+s[ií])?|Buenas\s+(?:tardes|noches)|Buenos\s+d[ií]as|Muchas\s+gracias|Gracias)),?\s+\+?[\p{L}_]*\d{2,}[\p{L}\d_]*(?=[!.,\s]|$)/giu,
    "$1",
  );

  const mencionaAdelanto = /S\/\s?20\b/.test(t) && /adelant|separ|reserv/i.test(t);
  if (mencionaAdelanto && !/951\s?365\s?418/.test(t)) {
    // En linea, junto al monto: agregado al final quedaba despues de la pregunta de cierre.
    t = t.replace(/\*?S\/\s?20\b\*?/, (m) => `${m} por Yape al *${YAPE_ADELANTO}* (Gerardo Huaynalaya)`);
  }
  return t;
}

/**
 * Si la clave de recojo de Shalom ya fue entregada o el pago ya fue confirmado,
 * remueve de forma determinista cualquier mención robótica anacrónica del bot que
 * prometa que "un asesor te enviará la clave en breve tras validar tu abono".
 */
export function removerMencionClaveSiYaEntregada(texto: string): string {
  if (!texto) return texto;
  const regex = /(?:^|\s+)(?:tu\s+clave(?:\s+secreta)?(?:\s+te\s+la)?\s+(?:enviar|compartir)[aá][^.!?\n]*|nuestro\s+equipo\s+de\s+administraci[oó]n\s+verificar[aá][^.!?\n]*|un\s+asesor\s+(?:humano\s+)?(?:te\s+)?(?:enviar|compartir)[aá]\s+(?:de\s+inmediato\s+|en\s+breve\s+)?tu\s+clave[^.!?\n]*)[.!?\s]*/gi;
  return texto.replace(regex, " ").replace(/[ \t]{2,}/g, " ").trim();
}
