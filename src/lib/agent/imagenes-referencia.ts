export interface ImagenReferencia {
  id: string;
  alias?: string[];
  titulo: string;
  descripcion: string;
  url: string;
  categoria: "producto" | "beneficios" | "pago" | "promocion";
  tipo?: "image" | "video";
}

/**
 * Convierte un link de Google Drive (o ID directo) al link directo de alta resolución
 * de Google CDN (https://lh3.googleusercontent.com/d/{id}), que no sobrecarga el CRM.
 */
export function googleDriveCdnUrl(idOrUrl: string): string {
  const match = idOrUrl.match(/[-\w]{25,}/);
  const fileId = match ? match[0] : idOrUrl;
  return `https://lh3.googleusercontent.com/d/${fileId}`;
}

/** Video de confianza de despachos (mejora 2b, 24/11): servido desde public/videos del CRM. */
export const VIDEO_DESPACHOS_SHALOM = "https://crm-aliv.onrender.com/videos/shalom-almacen.mp4";

export const IMAGENES_REFERENCIA: ImagenReferencia[] = [
  // =========================================================================
  // --- 1. NAC600 + NAD+ (Carpeta Oficial Google Drive) ---
  // https://drive.google.com/drive/folders/1sHgU1gqGAF2_qfYqoZRPpsrXqpP9559-
  // =========================================================================
  {
    id: "nac600_frasco",
    alias: ["nac600", "frasco_nac600", "nac600_foto", "nac600_producto", "empaque_nac600", "foto_nac600"],
    titulo: "Foto Oficial Producto NAC600 + NAD+ (The Modern Formula)",
    descripcion: "Foto oficial del empaque/frasco de NAC 600 mg con NAD+ en aceite de coco y MCT, 60 cápsulas, The Modern Formula, Non-GMO, Gluten Free.",
    url: "https://lh3.googleusercontent.com/d/1gXS80zywom16BfpJPPKQ0jdNVmW7F2KV",
    categoria: "producto",
  },
  {
    id: "nac600_beneficios",
    alias: ["beneficios_nac600", "nac600_ficha", "nac600_resena", "nac600_infografia", "nac600_formula", "11.png"],
    titulo: "Reseña Editorial e Infografía de Beneficios NAC600 + NAD+",
    descripcion: "Infografía editorial oficial: respaldo científico de absorción de NAC y NAD+ en suspensión de MCT, salud celular y antioxidante maestro.",
    url: "https://lh3.googleusercontent.com/d/1aDmJHkLqMUUvCZK710AYt2n04W_FkESX",
    categoria: "beneficios",
  },
  {
    id: "nac600_video",
    alias: ["video_nac600", "nac600_video_crudo", "video_producto_nac600", "video_nac", "video_nac_600"],
    titulo: "Video Demostrativo Oficial NAC600 + NAD+",
    descripcion: "Video real del producto en mano mostrando presentación, frasco, etiquetado y cápsulas de NAC600 + NAD+.",
    url: "https://drive.usercontent.google.com/download?id=1aC5l0GNusjxa3gKTUWRu4hC86xcWnu0X&export=download",
    categoria: "producto",
    tipo: "video",
  },

  // =========================================================================
  // --- 2. TOBILLERA TERMIX (Carpeta Oficial Google Drive) ---
  // https://drive.google.com/drive/folders/1_TAUXWd7QW0By2Vo-GUmw_EKvzBn9jCT
  // Según GUIA_PIEZAS_BOT.txt
  // =========================================================================
  {
    id: "termix_tobillera",
    alias: ["termix", "termix_foto", "termix_hero", "01_termix_foto_principal_producto"],
    titulo: "Tobillera Térmica Termix - Foto Oficial (Calor + Masaje)",
    descripcion: "Foto principal de la Tobillera Termix colocada en el tobillo con calor y vibración activos a 50 °C sobre fondo claro.",
    url: "https://lh3.googleusercontent.com/d/1ftuRgrJwGtWZf_a6g-7hY2wDswOG0RDB",
    categoria: "producto",
  },
  {
    id: "termix_promocion",
    alias: ["termix_precios", "termix_oferta", "termix_packs", "02_termix_precios_y_promociones_packs"],
    titulo: "Precios y Promociones Oficiales Termix (1x S/79, 2x S/139, 3x S/189)",
    descripcion: "Banner visual de precios oficiales (1x S/ 79, 2x S/ 139 a S/ 69.50 c/u, 3x S/ 189 a S/ 63.00 c/u, envío gratis, pagas al recibir, garantía de 30 días).",
    url: "https://lh3.googleusercontent.com/d/1n3ltmUqZZOOgycxQGL92vQ8pb7Ocq7nt",
    categoria: "promocion",
  },
  {
    id: "termix_foto_real",
    alias: ["termix_real", "termix_en_mano", "termix_encendida", "03_termix_foto_real_en_mano"],
    titulo: "Foto 100% Real en Mano Tobillera Termix Encendida",
    descripcion: "Foto real tomada en mano, con la pantalla encendida a 50 °C, botones táctiles, manual y cable de carga. Máxima confianza.",
    url: "https://lh3.googleusercontent.com/d/1Q4VmB6GXUtV87FTedRUedN8fiPlL0vli",
    categoria: "producto",
  },
  {
    id: "termix_contenido_caja",
    alias: ["termix_unboxing", "termix_incluye", "04_termix_contenido_caja"],
    titulo: "Contenido de la Caja Tobillera Termix",
    descripcion: "Foto de estudio con la caja abierta mostrando todo lo que incluye el pedido: tobillera, cable de carga USB-C y manual.",
    url: "https://lh3.googleusercontent.com/d/1BbjmDZYsdzrwHKzMeiMy0VCCuFgeiBPU",
    categoria: "producto",
  },
  {
    id: "termix_caracteristicas",
    alias: ["termix_partes", "termix_tecnica", "05_termix_infografia_partes_tecnicas"],
    titulo: "Ficha Técnica y Partes de la Tobillera Termix",
    descripcion: "Infografía detallada: placas térmicas de grafeno de calentamiento rápido, doble motor de masaje focalizado, neopreno transpirable y correas reforzadas.",
    url: "https://lh3.googleusercontent.com/d/13HRd2opokq2g0xZQsYuaIb392YbkjZH-",
    categoria: "beneficios",
  },
  {
    id: "termix_talla_universal",
    alias: ["termix_universal", "termix_seguridad", "06_termix_caracteristicas_y_talla_universal"],
    titulo: "Características de Seguridad y Talla Universal Termix",
    descripcion: "Muestra que la tobillera es talla universal para pie izquierdo o derecho, con apagado automático y recarga USB-C.",
    url: "https://lh3.googleusercontent.com/d/1uNKEitmw1UCqe6X4P7YiOnaLd5e_y6TD",
    categoria: "beneficios",
  },
  {
    id: "termix_comparativa",
    alias: ["termix_vs_comunes", "termix_beneficios", "07_termix_comparativa_vs_tobilleras_comunes"],
    titulo: "Comparativa: Termix vs Tobilleras Tradicionales",
    descripcion: "Tabla comparativa de beneficios: calor constante y masaje activo frente a vendas pasivas comunes que se resbalan.",
    url: "https://lh3.googleusercontent.com/d/1y9M6k_DJxLSR5TGvJIkwv00nm0p3k_aB",
    categoria: "beneficios",
  },
  {
    id: "termix_uso_casa",
    alias: ["termix_sofa", "08_termix_foto_uso_en_sofa"],
    titulo: "Uso y Descanso en Casa con Tobillera Termix",
    descripcion: "Foto de estilo de vida descansando en el sofá con la tobillera puesta.",
    url: "https://lh3.googleusercontent.com/d/1aHY4B6XKPXk62Zx-u2cifTLDg9LHY0pj",
    categoria: "producto",
  },
  {
    id: "termix_caja",
    alias: ["termix_presentacion", "09_termix_presentacion_caja"],
    titulo: "Presentación de Caja Exterior Tobillera Termix",
    descripcion: "Foto frontal de la caja cerrada del producto (Cordless Ankle Heating Pad CL-2888).",
    url: "https://lh3.googleusercontent.com/d/1oJ4I3s26vvp32hPWmY-dDgFFoKpst_Uo",
    categoria: "producto",
  },
  {
    id: "termix_video",
    alias: ["video_termix", "termix_video_unboxing", "10_termix_video_real_unboxing_en_mano", "video_real_termix", "video_tobillera"],
    titulo: "Video Real Unboxing Tobillera Termix",
    descripcion: "Video real de 35s mostrando el desempaque, accesorios, encendido y funcionamiento de la Tobillera Termix.",
    url: "https://drive.usercontent.google.com/download?id=1yM-G9IZUGRAMK77CswFdU6EQ58-mt8k9&export=download",
    categoria: "producto",
    tipo: "video",
  },
  {
    id: "termix_video_loop",
    alias: ["termix_video_corto", "11_termix_video_loop_corto_unboxing", "loop_termix"],
    titulo: "Video Corto Unboxing Termix",
    descripcion: "Video ligero (7s) en bucle mostrando la caja y tobillera Termix.",
    url: "https://drive.usercontent.google.com/download?id=1uVp7AByUPxMP-YM5Yu7QikLvTzY-b_in&export=download",
    categoria: "producto",
    tipo: "video",
  },

  // =========================================================================
  // --- 3. DATOS DE PAGO ---
  // =========================================================================
  {
    id: "yape_adelanto",
    alias: ["yape", "plin", "adelanto_yape"],
    titulo: "Datos Oficiales de Pago Yape / Plin (Aliv Perú)",
    descripcion: "Comprobante y datos oficiales para adelantos de provincia: Yape / Plin al 951365418 a nombre de Gerardo Huaynalaya.",
    url: "https://crm-aliv.onrender.com/marca/logo.png",
    categoria: "pago",
  },
  {
    id: "shalom_almacen_video",
    alias: ["video_despachos", "despachos_shalom", "video_shalom", "video_confianza", "almacen_shalom"],
    titulo: "Video real: así salen nuestros pedidos a Shalom (14 s)",
    descripcion:
      "Video vertical de 14 s con fotos reales de la mesa de despachos y paquetes rotulados por Shalom (Cajamarca, Arequipa). Cierra con el adelanto de S/20 por Yape y el saldo al recoger en la agencia. Para dar confianza al cliente de provincia que duda en pagar el adelanto.",
    url: VIDEO_DESPACHOS_SHALOM,
    categoria: "pago",
    tipo: "video",
  },
];

export function buscarImagenReferencia(clave: string): ImagenReferencia | undefined {
  const normalizada = clave.toLowerCase().trim();
  return IMAGENES_REFERENCIA.find((img) => {
    if (img.id.toLowerCase() === normalizada) return true;
    if (img.id.toLowerCase().replace(/_/g, "") === normalizada.replace(/_/g, "")) return true;
    if (img.alias?.some((al) => al.toLowerCase() === normalizada || al.toLowerCase().replace(/_/g, "") === normalizada.replace(/_/g, ""))) {
      return true;
    }
    return false;
  });
}

/**
 * Resuelve y valida la mejor imagen de referencia a enviar, aplicando blindaje estricto:
 * 1. Detección y corrección de cruces de producto (ej: Si se habla de NAC600 pero el bot pide imagen de Tobillera, se corrige automáticamente).
 * 2. Selección inteligente de la foto según el motivo o la consulta del cliente (ficha técnica, unboxing, foto real, precios, etc.).
 */
export function resolverMejorImagen(params: {
  claveSolicitada?: string;
  motivo?: string;
  textoContexto?: string;
  interesProducto?: string;
  /**
   * Último mensaje del cliente. Manda sobre el contexto para elegir foto o video: el 25/11
   * (956230526) pidió «Foto ?» después de haber pedido video y se le reenvió el video, porque
   * «video» seguía en los últimos mensajes; el cliente contestó «no adjuntas nada».
   */
  ultimoCliente?: string;
}): {
  imagen: ImagenReferencia;
  corregida: boolean;
  motivoCorreccion?: string;
} {
  const claveRaw = (params.claveSolicitada || "").toLowerCase().trim();
  const textoCombinado = [
    params.motivo || "",
    params.textoContexto || "",
    params.interesProducto || "",
  ]
    .join(" ")
    .toLowerCase();

  const nacMatches = (textoCombinado.match(/\b(nac|nac600|glutation|higado|capsulas?|frasco|frascos|nad\+?|suplemento)\b/gi) || []).length;
  const termixMatches = (textoCombinado.match(/\b(termix|tobillera|tobillo|tobillos|calor|masaje|grafeno|esguince|tendon|pie|cargador|cable|unboxing|en mano)\b/gi) || []).length;

  const esAmbos = nacMatches > 0 && termixMatches > 0;
  const motivoMencionaNac = /\b(nac|nac600|glutation|higado|capsulas?|frasco|frascos|nad\+?|suplemento)\b/i.test(params.motivo || "");
  const motivoMencionaTermix = /\b(termix|tobillera|tobillo|tobillos|calor|masaje|grafeno|esguince|tendon|pie)\b/i.test(params.motivo || "");

  const esTemaNac = nacMatches > 0 && (nacMatches >= termixMatches || motivoMencionaNac);
  const esTemaTermix = termixMatches > 0 && (termixMatches > nacMatches || motivoMencionaTermix);
  const esTemaPago =
    /\b(yape|plin|adelanto|s\/20|cuenta|transferencia|banco)\b/i.test(textoCombinado);
  const ultimo = (params.ultimoCliente || "").toLowerCase();
  const RE_VIDEO = /\b(video|videos|grabaci[oó]n|filmaci[oó]n|filme|unboxing video)\b/i;
  const RE_FOTO = /\b(foto|fotos|fotito|imagen|imagenes|imágenes|captura)\b/i;
  const pideFotoAhora = RE_FOTO.test(ultimo) && !RE_VIDEO.test(ultimo);
  const pideVideo = !pideFotoAhora && (RE_VIDEO.test(ultimo || textoCombinado) || claveRaw.includes("video"));

  // El cliente acaba de pedir una foto: nunca se le manda un video (se ve igual que el anterior).
  if (pideFotoAhora && claveRaw.includes("video")) {
    const clave = claveRaw.startsWith("termix") ? "termix_foto_real" : "nac600_frasco";
    return {
      imagen: buscarImagenReferencia(clave) || IMAGENES_REFERENCIA[0],
      corregida: true,
      motivoCorreccion: `El cliente pidió foto y se solicitó '${claveRaw}'. Se envía '${clave}'.`,
    };
  }

  let claveEfectiva = claveRaw;

  // 1. BLINDAJE ANTI-CRUCE: Si el bot solicitó Termix pero el motivo o contexto es NAC600
  if (
    claveRaw.startsWith("termix") &&
    (motivoMencionaNac || (nacMatches > 0 && termixMatches === 0) || (nacMatches > 0 && !motivoMencionaTermix && !esAmbos))
  ) {
    const esBeneficios = /\b(beneficio|para que sirve|como se toma|dosis|ingredientes|composicion|ficha)\b/i.test(textoCombinado);
    claveEfectiva = pideVideo ? "nac600_video" : esBeneficios ? "nac600_beneficios" : "nac600_frasco";
    const imgCorregida = buscarImagenReferencia(claveEfectiva) || IMAGENES_REFERENCIA[0];
    return {
      imagen: imgCorregida,
      corregida: true,
      motivoCorreccion: `Cruce detectado: se solicitó '${claveRaw}' mientras se conversaba de NAC600. Corregida automáticamente a '${claveEfectiva}'.`,
    };
  }

  // 2. BLINDAJE ANTI-CRUCE: Si el bot solicitó NAC600 pero el motivo o contexto es Termix
  if (
    claveRaw.startsWith("nac600") &&
    (motivoMencionaTermix || (termixMatches > 0 && nacMatches === 0) || (termixMatches > 0 && !motivoMencionaNac && !esAmbos))
  ) {
    const esPromocion = /\b(precio|cuanto|cuesta|oferta|promo|promocion|pack|packs)\b/i.test(textoCombinado);
    const esFotoReal = /\b(real|en mano|original|confianza|desconfi)\b/i.test(textoCombinado);
    const esLoop = /\b(loop|corto|rapido)\b/i.test(textoCombinado);
    claveEfectiva = pideVideo
      ? esLoop
        ? "termix_video_loop"
        : "termix_video"
      : esPromocion
      ? "termix_promocion"
      : esFotoReal
      ? "termix_foto_real"
      : "termix_tobillera";
    const imgCorregida = buscarImagenReferencia(claveEfectiva) || IMAGENES_REFERENCIA[3];
    return {
      imagen: imgCorregida,
      corregida: true,
      motivoCorreccion: `Cruce detectado: se solicitó '${claveRaw}' mientras se conversaba de Tobillera Termix. Corregida automáticamente a '${claveEfectiva}'.`,
    };
  }

  // 3. Si el cliente o motivo pide video explícitamente y la clave no es de video, actualizar a video correspondiente
  if (pideVideo && !claveEfectiva.includes("video")) {
    if (esTemaTermix) {
      const esLoop = /\b(loop|corto|rapido)\b/i.test(textoCombinado);
      claveEfectiva = esLoop ? "termix_video_loop" : "termix_video";
    } else {
      claveEfectiva = "nac600_video";
    }
  }

  // 4. Selección inteligente si la clave no vino o no fue exacta
  if (!claveEfectiva || !buscarImagenReferencia(claveEfectiva)) {
    if (pideVideo) {
      if (esTemaTermix) {
        const esLoop = /\b(loop|corto|rapido)\b/i.test(textoCombinado);
        claveEfectiva = esLoop ? "termix_video_loop" : "termix_video";
      } else {
        claveEfectiva = "nac600_video";
      }
    } else if (esTemaPago) {
      claveEfectiva = "yape_adelanto";
    } else if (esTemaNac) {
      const esBeneficios = /\b(beneficio|para que sirve|como se toma|dosis|ingredientes|composicion|ficha)\b/i.test(textoCombinado);
      claveEfectiva = esBeneficios ? "nac600_beneficios" : "nac600_frasco";
    } else if (esTemaTermix) {
      if (/\b(precio|cuanto|cuesta|oferta|promo|promocion|pack|packs)\b/i.test(textoCombinado)) {
        claveEfectiva = "termix_promocion";
      } else if (/\b(real|en mano|original|confianza)\b/i.test(textoCombinado)) {
        claveEfectiva = "termix_foto_real";
      } else if (/\b(caja|viene|incluye|unboxing|cargador|cable)\b/i.test(textoCombinado)) {
        claveEfectiva = "termix_contenido_caja";
      } else if (/\b(tecnica|caracteristica|partes|grafeno|vibracion|motor)\b/i.test(textoCombinado)) {
        claveEfectiva = "termix_caracteristicas";
      } else if (/\b(talla|tamano|medida|ajuste|universal)\b/i.test(textoCombinado)) {
        claveEfectiva = "termix_talla_universal";
      } else if (/\b(diferencia|comparativa|comunes|tradicional|venda)\b/i.test(textoCombinado)) {
        claveEfectiva = "termix_comparativa";
      } else {
        claveEfectiva = "termix_tobillera";
      }
    } else {
      claveEfectiva = claveRaw || "nac600_frasco";
    }
  }

  const encontrada = buscarImagenReferencia(claveEfectiva) || IMAGENES_REFERENCIA[0];
  return {
    imagen: encontrada,
    corregida: claveEfectiva !== claveRaw,
    motivoCorreccion: claveEfectiva !== claveRaw ? `Imagen optimizada a '${encontrada.id}' según contexto.` : undefined,
  };
}

/**
 * El pie de la foto ya llegó como caption: si la respuesta en texto trae ese mismo párrafo, se
 * quita (25/11: «¡Aquí tienes una foto…!» salía dos veces seguidas).
 */
export function quitarPieRepetido(reply: string, pies: string[]): string {
  let texto = reply.trim();
  const norm = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  for (const pie of pies) {
    const p = norm(pie);
    if (p.length < 12) continue;
    const parrafos = texto.split(/\n{2,}/);
    const restantes = parrafos.filter((par) => norm(par) !== p);
    if (restantes.length && restantes.length < parrafos.length) texto = restantes.join("\n\n").trim();
  }
  return texto;
}
