import "server-only";
import { db } from "@/db";
import { eq } from "drizzle-orm";
import { catalogoProductos } from "./tabla";

export const TIENDA_SHOPIFY_URL = process.env.SHOPIFY_STORE_URL || "https://alivstore.shop";

export interface ProductoSemilla {
  shopifyId: string;
  sku: string;
  handle: string;
  titulo: string;
  categoria: string;
  descripcion: string;
  beneficios: string;
  precauciones: string;
  precio: string;
  precioRegular: string | null;
  moneda: string;
  stock: number;
  disponible: boolean;
  imagenUrl: string;
  publicUrl: string;
}

/**
 * Catalogo real de Aliv Store (https://alivstore.shop/) con descripciones enriquecidas
 * para que el agente IA responda al instante sobre beneficios, modo de uso y precauciones.
 */
export const CATALOGO_ALIV_BASE: ProductoSemilla[] = [
  {
    shopifyId: "15425180696788",
    sku: "ALIV-NAC600",
    handle: "nac600",
    titulo: "NAC600 + NAD+ (60 cápsulas)",
    categoria: "Suplementos y Antioxidantes",
    descripcion:
      "Complejo diario en cápsulas: 600 mg de N-acetil-L-cisteína (NAC) por porción con NAD+, suspendidos en aceite de coco y MCT. Sin olor ni sabor a azufre. Frasco de 60 cápsulas (30 porciones: 2 al día con el desayuno).",
    beneficios:
      "Aporta cisteína para producir glutatión (el antioxidante maestro que apoya los procesos naturales del hígado), energía celular gracias al NAD+ y mejor absorción con aceite MCT.",
    precauciones:
      "Este producto no es un medicamento y no está destinado a diagnosticar, tratar, curar ni prevenir ninguna enfermedad. Tomar 2 cápsulas al día con el desayuno.",
    precio: "119.00",
    precioRegular: null,
    moneda: "PEN",
    stock: 45,
    disponible: true,
    imagenUrl: "https://cdn.shopify.com/s/files/1/0853/5579/0548/files/NACProduct1.webp?v=1792254070",
    publicUrl: "https://alivstore.shop/products/nac600",
  },
  {
    shopifyId: "15419533164756",
    sku: "ALIV-TERMIX-TOB",
    handle: "termix-tobillera",
    titulo: "Termix Tobillera – Calor y Masaje Inalámbrico",
    categoria: "Terapia Térmica y Masaje",
    descripcion:
      "Tobillera inalámbrica que combina placas térmicas de grafeno (calientan en segundos) y doble motor de masaje por vibración para relajar el tobillo después de entrenar o de un día largo de pie. Neopreno transpirable e hipoalergénico con velcro reforzado. Talla universal (pie izquierdo o derecho), batería recargable por USB-C y apagado automático.",
    beneficios:
      "Alivio de sobrecarga, tensión e inflamación en el tobillo mediante termoterapia de grafeno y masaje vibratorio localizado. Uso sin cables.",
    precauciones:
      "No usar sobre heridas abiertas, piel irritada o zonas con poca sensibilidad. Si estás embarazada, tienes marcapasos, diabetes o problemas de circulación, consulta con tu médico antes de usarla.",
    precio: "99.00",
    precioRegular: null,
    moneda: "PEN",
    stock: 35,
    disponible: true,
    imagenUrl: "https://cdn.shopify.com/s/files/1/0853/5579/0548/files/1-r.jpg?v=1791918500",
    publicUrl: "https://alivstore.shop/products/termix-tobillera",
  },
  {
    shopifyId: "9331762561236",
    sku: "ALIV-TERMIX-HOMB",
    handle: "termix-hombrera-termica-con-calor-vibracion-y-luz-roja",
    titulo: "Termix – Hombrera Térmica con Calor, Vibración y Luz Roja",
    categoria: "Terapia Térmica y Masaje",
    descripcion:
      "Hombrera ergonómica inalámbrica que integra triple terapia: calor profundo, masaje por vibración y fototerapia de luz roja para ayudar a la recuperación real del hombro ante sobrecarga, tendinitis o tensión acumulada.",
    beneficios:
      "Relaja la musculatura del manguito rotador y hombro, estimula la circulación local y rompe el ciclo de tensión repetitiva. Ajustable a ambos hombros.",
    precauciones:
      "No aplicar sobre heridas abiertas ni usar mientras duermes. Consultar al médico en caso de marcapasos o embarazo.",
    precio: "99.00",
    precioRegular: null,
    moneda: "PEN",
    stock: 40,
    disponible: true,
    imagenUrl: "https://cdn.shopify.com/s/files/1/0853/5579/0548/files/Gemini_Generated_Image_c0w967c0w967c0w9.jpg?v=1788538755",
    publicUrl: "https://alivstore.shop/products/termix-hombrera-termica-con-calor-vibracion-y-luz-roja",
  },
  {
    shopifyId: "9331755516116",
    sku: "ALIV-NUVARA-CERV",
    handle: "nuvara-almohada-de-masaje-cervical-con-calor-vibracion-y-traccion",
    titulo: "Nuvara – Almohada de Masaje Cervical con Calor, Vibración y Tracción",
    categoria: "Terapia Térmica y Masaje",
    descripcion:
      "Almohada ergonómica de tracción cervical que combina calor terapéutico, vibración relajante y soporte de curva natural para descomprimir las vértebras del cuello y aliviar la rigidez cervical de raíz.",
    beneficios:
      "Ayuda a recuperar la curva natural de la columna cervical, libera la tensión acumulada por uso de pantallas o estrés y mejora el descanso.",
    precauciones:
      "Uso recomendado en sesiones de 15 a 20 minutos diarios. Si tienes hernia cervical severa o cirugía reciente de columna, consulta a tu médico.",
    precio: "149.00",
    precioRegular: "199.00",
    moneda: "PEN",
    stock: 30,
    disponible: true,
    imagenUrl: "https://cdn.shopify.com/s/files/1/0853/5579/0548/files/Gemini_Generated_Image_cbnmx3cbnmx3cbnm.jpg?v=1788537121",
    publicUrl: "https://alivstore.shop/products/nuvara-almohada-de-masaje-cervical-con-calor-vibracion-y-traccion",
  },
  {
    shopifyId: "9331760398548",
    sku: "ALIV-HERBIA-ROLL",
    handle: "herbia-roll-on-de-aceites-esenciales-para-el-alivio-de-la-migrana",
    titulo: "Herbia – Roll-On de Aceites Esenciales para el Alivio de la Migraña",
    categoria: "Alivio Natural y Aromaterapia",
    descripcion:
      "Roll-on tópico de aceites esenciales puros de acción inmediata en sienes, frente y nuca para calmar episodios de dolor de cabeza, tensión y migraña sin esperar a la digestión de una pastilla.",
    beneficios:
      "Efecto refrescante y calmante inmediato, portátil para llevar en el bolsillo o cartera, 100% base de extractos botánicos.",
    precauciones:
      "Uso externo únicamente. Evitar el contacto con los ojos y mucosas.",
    precio: "30.00",
    precioRegular: null,
    moneda: "PEN",
    stock: 80,
    disponible: true,
    imagenUrl: "https://cdn.shopify.com/s/files/1/0853/5579/0548/files/Gemini_Generated_Image_j0qvewj0qvewj0qv.jpg?v=1788538577",
    publicUrl: "https://alivstore.shop/products/herbia-roll-on-de-aceites-esenciales-para-el-alivio-de-la-migrana",
  },
  {
    shopifyId: "9354126754004",
    sku: "ALIV-MENOMAG",
    handle: "meno-mag",
    titulo: "Meno Mag – Apoyo Integral Perimenopausia y Posmenopausia",
    categoria: "Suplementos y Bienestar Femenino",
    descripcion:
      "Fórmula especializada de apoyo integral para mujeres en etapa de perimenopausia y posmenopausia, ayudando al equilibrio diario, descanso y bienestar general.",
    beneficios:
      "Apoya el descanso nocturno, el equilibrio térmico y el bienestar anímico y físico durante la transición menopáusica.",
    precauciones:
      "Suplemento nutricional; no reemplaza una dieta equilibrada ni tratamiento médico.",
    precio: "99.00",
    precioRegular: "159.00",
    moneda: "PEN",
    stock: 40,
    disponible: true,
    imagenUrl: "https://cdn.shopify.com/s/files/1/0853/5579/0548/files/Gemini_Generated_Image_73kr9f73kr9f73kr.jpg?v=1789753667",
    publicUrl: "https://alivstore.shop/products/meno-mag",
  },
  {
    shopifyId: "15409894785236",
    sku: "ALIV-GODA",
    handle: "goda",
    titulo: "GODA for Her – Perfume con Feromonas",
    categoria: "Belleza y Cuidado Personal",
    descripcion:
      "GODA for Her es un perfume con feromonas diseñado para aumentar la atracción, proyectar seguridad, elevar la confianza personal y dejar una impresión duradera.",
    beneficios:
      "Aroma envolvente de larga duración, práctico formato para retoques durante el día o la noche.",
    precauciones:
      "Uso externo. Aplicar en puntos de pulso (muñecas, cuello, detrás de las orejas).",
    precio: "99.00",
    precioRegular: "100.00",
    moneda: "PEN",
    stock: 50,
    disponible: true,
    imagenUrl: "https://cdn.shopify.com/s/files/1/0853/5579/0548/files/1_1c77f425-ea04-4c93-ba65-b13744c41769.jpg?v=1791350783",
    publicUrl: "https://alivstore.shop/products/goda",
  },
];

function limpiarHtml(html: string | null | undefined): string {
  if (!html) return "";
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

interface ShopifyProductRaw {
  id: number | string;
  title: string;
  handle: string;
  body_html?: string;
  product_type?: string;
  variants?: Array<{
    id: number | string;
    sku?: string | null;
    price?: string;
    compare_at_price?: string | null;
    available?: boolean;
  }>;
  images?: Array<{ src?: string }>;
}

/**
 * Sincroniza el catalogo directamente desde el endpoint JSON publico de Shopify
 * (`https://alivstore.shop/products.json`), sin requerir API Keys de pago.
 * Si un producto ya tiene beneficios/precauciones enriquecidos en CATALOGO_ALIV_BASE,
 * los conserva mientras actualiza precio, imagen y disponibilidad en vivo.
 */
export async function sincronizarDesdeShopify(baseUrl = TIENDA_SHOPIFY_URL): Promise<{
  ok: boolean;
  sincronizados: number;
  origen: "shopify_live" | "catalogo_local";
  detalle?: string;
}> {
  const cleanUrl = baseUrl.replace(/\/$/, "");
  const mapaBase = new Map(CATALOGO_ALIV_BASE.map((p) => [p.handle, p]));
  let productosParaGuardar: ProductoSemilla[] = [];
  let origen: "shopify_live" | "catalogo_local" = "catalogo_local";

  try {
    const res = await fetch(`${cleanUrl}/products.json?limit=250`, {
      headers: { Accept: "application/json", "User-Agent": "AlivStore-CRM/1.0" },
      signal: AbortSignal.timeout(10000),
    });
    if (res.ok) {
      const json = (await res.json()) as { products?: ShopifyProductRaw[] };
      if (Array.isArray(json.products) && json.products.length > 0) {
        origen = "shopify_live";
        productosParaGuardar = json.products.map((raw) => {
          const base = mapaBase.get(raw.handle);
          const v = raw.variants?.[0];
          const descLimpia = limpiarHtml(raw.body_html);
          return {
            shopifyId: String(raw.id),
            sku: v?.sku?.trim() || base?.sku || `ALIV-${raw.handle.slice(0, 10).toUpperCase()}`,
            handle: raw.handle,
            titulo: base?.titulo || raw.title,
            categoria: raw.product_type?.trim() || base?.categoria || "Bienestar y Salud",
            descripcion: descLimpia || base?.descripcion || raw.title,
            beneficios: base?.beneficios || "Producto oficial de Aliv Store con envío a todo el Perú.",
            precauciones: base?.precauciones || "Seguir las indicaciones del empaque.",
            precio: v?.price || base?.precio || "99.00",
            precioRegular: v?.compare_at_price || base?.precioRegular || null,
            moneda: "PEN",
            stock: base?.stock ?? 50,
            disponible: v?.available ?? true,
            imagenUrl: raw.images?.[0]?.src || base?.imagenUrl || "",
            publicUrl: `${cleanUrl}/products/${raw.handle}`,
          };
        });
      }
    }
  } catch {
    // Fallback al catalogo base embebido si no hay red en el entorno
  }

  if (productosParaGuardar.length === 0) {
    productosParaGuardar = CATALOGO_ALIV_BASE;
  }

  let count = 0;
  for (const item of productosParaGuardar) {
    const [existente] = await db
      .select({ id: catalogoProductos.id, stock: catalogoProductos.stock })
      .from(catalogoProductos)
      .where(eq(catalogoProductos.shopifyId, item.shopifyId))
      .limit(1);

    if (existente) {
      await db
        .update(catalogoProductos)
        .set({
          titulo: item.titulo,
          handle: item.handle,
          sku: item.sku,
          categoria: item.categoria,
          descripcion: item.descripcion,
          beneficios: item.beneficios,
          precauciones: item.precauciones,
          precio: item.precio,
          precioRegular: item.precioRegular,
          imagenUrl: item.imagenUrl,
          publicUrl: item.publicUrl,
          disponible: item.disponible,
          updatedAt: new Date(),
        })
        .where(eq(catalogoProductos.id, existente.id));
    } else {
      await db.insert(catalogoProductos).values({
        shopifyId: item.shopifyId,
        sku: item.sku,
        handle: item.handle,
        titulo: item.titulo,
        categoria: item.categoria,
        descripcion: item.descripcion,
        beneficios: item.beneficios,
        precauciones: item.precauciones,
        precio: item.precio,
        precioRegular: item.precioRegular,
        moneda: item.moneda,
        stock: item.stock,
        disponible: item.disponible,
        imagenUrl: item.imagenUrl,
        publicUrl: item.publicUrl,
      });
    }
    count++;
  }

  return { ok: true, sincronizados: count, origen };
}
