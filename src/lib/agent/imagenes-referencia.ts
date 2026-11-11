export interface ImagenReferencia {
  id: string;
  titulo: string;
  descripcion: string;
  url: string;
  categoria: "producto" | "beneficios" | "pago" | "promocion";
}

export const IMAGENES_REFERENCIA: ImagenReferencia[] = [
  {
    id: "nac600_frasco",
    titulo: "Frasco NAC600 + NAD+ (60 cápsulas)",
    descripcion: "Foto oficial del frasco de NAC600 + NAD+ de Aliv Perú, mostrando etiqueta, presentación y cápsulas blandas liposomales.",
    url: "https://cdn.shopify.com/s/files/1/0853/5579/0548/files/NACProduct1.webp?v=1792254070",
    categoria: "producto",
  },
  {
    id: "nac600_beneficios",
    titulo: "Beneficios de NAC600 + NAD+ y Modo de Uso",
    descripcion: "Ficha explicativa de soporte hepático (glutatión), claridad mental, energía celular y cómo tomar 2 cápsulas al día con agua en el desayuno.",
    url: "https://cdn.shopify.com/s/files/1/0853/5579/0548/files/Gemini_Generated_Image_c0w967c0w967c0w9.jpg?v=1788538755",
    categoria: "beneficios",
  },
  {
    id: "termix_tobillera",
    titulo: "Tobillera Térmica Termix (Calor + Masaje)",
    descripcion: "Ficha gráfica de características de la Tobillera Termix: calor de grafeno hasta 60 °C, masaje por vibración, batería USB-C, ajuste universal para ambos pies y neopreno suave.",
    url: "https://crm-aliv.onrender.com/productos/termix-caracteristicas.jpg",
    categoria: "producto",
  },
  {
    id: "termix_caracteristicas",
    titulo: "Ficha Técnica Tobillera Termix (Calor y Masaje)",
    descripcion: "Infografía oficial con detalles técnicos de Termix: temperatura, vibración, ajuste ergonómico universal y apagado automático.",
    url: "https://crm-aliv.onrender.com/productos/termix-caracteristicas.jpg",
    categoria: "beneficios",
  },
  {
    id: "termix_promocion",
    titulo: "Promoción Tobillera Termix (Deja el balde)",
    descripcion: "Pieza publicitaria con oferta y presentación de alivio del dolor para la Tobillera Termix.",
    url: "https://crm-aliv.onrender.com/productos/termix-promocion.jpg",
    categoria: "promocion",
  },
  {
    id: "yape_adelanto",
    titulo: "Datos Oficiales de Pago Yape / Plin (Aliv Perú)",
    descripcion: "Comprobante y datos oficiales para adelantos de provincia: Yape / Plin al 951365418 a nombre de Gerardo Huaynalaya.",
    url: "https://crm-aliv.onrender.com/marca/logo.png",
    categoria: "pago",
  },
];

export function buscarImagenReferencia(clave: string): ImagenReferencia | undefined {
  const normalizada = clave.toLowerCase().trim();
  return IMAGENES_REFERENCIA.find(
    (img) =>
      img.id.toLowerCase() === normalizada ||
      img.id.toLowerCase().replace(/_/g, "") === normalizada.replace(/_/g, "")
  );
}
