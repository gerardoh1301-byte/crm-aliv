export interface ImagenReferencia {
  id: string;
  alias?: string[];
  titulo: string;
  descripcion: string;
  url: string;
  categoria: "producto" | "beneficios" | "pago" | "promocion";
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

export const IMAGENES_REFERENCIA: ImagenReferencia[] = [
  // --- NAC600 ---
  {
    id: "nac600_frasco",
    alias: ["nac600", "frasco_nac600", "nac600_foto"],
    titulo: "Frasco NAC600 + NAD+ (60 cápsulas)",
    descripcion: "Foto oficial del frasco de NAC600 + NAD+ de Aliv Perú, mostrando etiqueta, presentación y cápsulas blandas liposomales.",
    url: "https://cdn.shopify.com/s/files/1/0853/5579/0548/files/NACProduct1.webp?v=1792254070",
    categoria: "producto",
  },
  {
    id: "nac600_beneficios",
    alias: ["beneficios_nac600", "nac600_ficha"],
    titulo: "Beneficios de NAC600 + NAD+ y Modo de Uso",
    descripcion: "Ficha explicativa de soporte hepático (glutatión), claridad mental, energía celular y cómo tomar 2 cápsulas al día con agua en el desayuno.",
    url: "https://cdn.shopify.com/s/files/1/0853/5579/0548/files/Gemini_Generated_Image_c0w967c0w967c0w9.jpg?v=1788538755",
    categoria: "beneficios",
  },

  // --- TOBILLERA TERMIX (Hospedadas en Google Drive CDN - Cero carga al CRM) ---
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
    titulo: "Precios y Promociones Oficiales Termix (1x S/99, 2x S/169)",
    descripcion: "Banner visual de precios oficiales (1x S/ 99, 2x S/ 169 a S/ 84.50 c/u, envío gratis, pagas al recibir, garantía de 30 días).",
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

  // --- DATOS DE PAGO ---
  {
    id: "yape_adelanto",
    alias: ["yape", "plin", "adelanto_yape"],
    titulo: "Datos Oficiales de Pago Yape / Plin (Aliv Perú)",
    descripcion: "Comprobante y datos oficiales para adelantos de provincia: Yape / Plin al 951365418 a nombre de Gerardo Huaynalaya.",
    url: "https://crm-aliv.onrender.com/marca/logo.png",
    categoria: "pago",
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
