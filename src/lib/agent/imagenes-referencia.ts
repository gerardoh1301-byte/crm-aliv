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
    titulo: "Tobillera Térmica Termix (Calor de Grafeno y Masaje)",
    descripcion: "Foto de la tobillera anatómica inalámbrica Termix para alivio de pies y tobillos con doble motor de masaje vibratorio.",
    url: "https://cdn.shopify.com/s/files/1/0853/5579/0548/files/1-r.jpg?v=1791918500",
    categoria: "producto",
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
