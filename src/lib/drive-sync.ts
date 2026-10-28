import "server-only";
import { existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { contacts, conversations, deals } from "@/db/schema";
import { catalogoProductos } from "../../modules/catalogo/tabla";
import { pedidosOrdenes } from "../../modules/pedidos/tabla";

const RUTAS_CANDIDATAS_DRIVE = [
  process.env.GOOGLE_DRIVE_SYNC_DIR,
  "G:\\Mi unidad\\Aliv Store CRM",
  "G:\\My Drive\\Aliv Store CRM",
  join(process.env.USERPROFILE || "C:\\Users\\USER", "Google Drive", "Aliv Store CRM"),
  join(process.env.USERPROFILE || "C:\\Users\\USER", "OneDrive", "Aliv Store CRM"),
].filter(Boolean) as string[];

export function resolverCarpetaDrive(): { ruta: string; esGoogleDrive: boolean } {
  for (const candidata of RUTAS_CANDIDATAS_DRIVE) {
    const padre = join(candidata, "..");
    if (existsSync(candidata) || existsSync(padre)) {
      mkdirSync(candidata, { recursive: true });
      return {
        ruta: candidata,
        esGoogleDrive:
          candidata.toLowerCase().includes("mi unidad") ||
          candidata.toLowerCase().includes("drive"),
      };
    }
  }
  const fallback = join(process.cwd(), ".local", "drive-sync");
  mkdirSync(fallback, { recursive: true });
  return { ruta: fallback, esGoogleDrive: false };
}

function escaparCsv(valor: unknown): string {
  if (valor === null || valor === undefined) return "";
  const texto = String(valor).replace(/\r?\n/g, " ").trim();
  if (texto.includes(",") || texto.includes('"') || texto.includes(";")) {
    return `"${texto.replace(/"/g, '""')}"`;
  }
  return texto;
}

function aCsv(encabezados: string[], filas: Array<Array<unknown>>): string {
  // \uFEFF (BOM UTF-8) para que Excel y Google Sheets abran tildes y S/ sin errores
  const lineas = [
    encabezados.map(escaparCsv).join(","),
    ...filas.map((f) => f.map(escaparCsv).join(",")),
  ];
  return "\uFEFF" + lineas.join("\r\n") + "\r\n";
}

export interface ResultadoSyncDrive {
  ok: boolean;
  carpeta: string;
  esGoogleDrive: boolean;
  archivos: string[];
  totales: {
    pedidos: number;
    contactos: number;
    productos: number;
  };
  urlPublica: string | null;
  sincronizadoEn: string;
}

export function leerUrlPublicaActiva(): string | null {
  try {
    const archivoUrl = join(process.cwd(), ".local", "public_url.txt");
    if (existsSync(archivoUrl)) {
      const url = readFileSync(archivoUrl, "utf8").trim();
      if (url) return url;
    }
  } catch {
    /* continuar */
  }
  return process.env.APP_BASE_URL || null;
}

/**
 * Exporta y sincroniza automaticamente toda la informacion operativa de Aliv Store
 * hacia la carpeta compartida de Google Drive (`G:\Mi unidad\Aliv Store CRM`).
 */
export async function sincronizarConGoogleDrive(): Promise<ResultadoSyncDrive> {
  const { ruta, esGoogleDrive } = resolverCarpetaDrive();
  const ahora = new Date();
  const fechaIso = ahora.toISOString();
  const urlPublica = leerUrlPublicaActiva();

  const [listaPedidos, listaContactos, listaProductos, listaDeals, listaConvs] =
    await Promise.all([
      db
        .select({
          id: pedidosOrdenes.id,
          numeroOrden: pedidosOrdenes.numeroOrden,
          estado: pedidosOrdenes.estado,
          modalidadPago: pedidosOrdenes.modalidadPago,
          items: pedidosOrdenes.items,
          total: pedidosOrdenes.total,
          moneda: pedidosOrdenes.moneda,
          dniCliente: pedidosOrdenes.dniCliente,
          ciudad: pedidosOrdenes.ciudad,
          distrito: pedidosOrdenes.distrito,
          direccionEnvio: pedidosOrdenes.direccionEnvio,
          transportadora: pedidosOrdenes.transportadora,
          numeroGuia: pedidosOrdenes.numeroGuia,
          claveRecojo: pedidosOrdenes.claveRecojo,
          notas: pedidosOrdenes.notas,
          createdAt: pedidosOrdenes.createdAt,
          updatedAt: pedidosOrdenes.updatedAt,
          contactName: contacts.name,
          contactPhone: contacts.phone,
        })
        .from(pedidosOrdenes)
        .leftJoin(contacts, eq(pedidosOrdenes.contactId, contacts.id))
        .orderBy(desc(pedidosOrdenes.createdAt)),
      db.select().from(contacts).orderBy(desc(contacts.updatedAt)),
      db.select().from(catalogoProductos).orderBy(catalogoProductos.titulo),
      db.select().from(deals).orderBy(desc(deals.updatedAt)),
      db.select().from(conversations).orderBy(desc(conversations.updatedAt)),
    ]);

  // 1. CSV de Pedidos COD (para vendedores y logistica)
  const csvPedidos = aCsv(
    [
      "N_Orden",
      "Estado",
      "Fecha_Creacion",
      "Cliente",
      "Telefono",
      "DNI",
      "Ciudad_Departamento",
      "Distrito",
      "Direccion_Envio",
      "Productos",
      "Total_PEN",
      "Modalidad_Pago",
      "Transportadora",
      "Numero_Guia",
      "Clave_Recojo",
      "Notas",
    ],
    listaPedidos.map((p) => [
      p.numeroOrden,
      p.estado,
      p.createdAt ? new Date(p.createdAt).toLocaleString("es-PE", { timeZone: "America/Lima" }) : "",
      p.contactName ?? "",
      p.contactPhone ?? "",
      p.dniCliente ?? "",
      p.ciudad ?? "",
      p.distrito ?? "",
      p.direccionEnvio ?? "",
      (p.items ?? []).map((i) => `${i.cantidad}x ${i.titulo} (S/${i.precioUnitario})`).join(" + "),
      `S/ ${Number(p.total ?? 0).toFixed(2)}`,
      p.modalidadPago,
      p.transportadora ?? "",
      p.numeroGuia ?? "",
      p.claveRecojo ?? "",
      p.notas ?? "",
    ])
  );

  // 2. CSV de Contactos y Clientes
  const csvContactos = aCsv(
    [
      "Nombre",
      "Telefono",
      "Email",
      "Canal_Origen",
      "Producto_Interes",
      "Ciudad",
      "Distrito",
      "Direccion",
      "DNI",
      "Modalidad_Entrega",
      "Etiquetas",
      "Resumen_IA",
      "Fecha_Actualizacion",
    ],
    listaContactos.map((c) => {
      const cf = (c.customFields as Record<string, unknown> | null) ?? {};
      return [
        c.name,
        c.phone ?? "",
        c.email ?? "",
        c.source,
        cf.producto_interes ?? "",
        cf.departamento_ciudad ?? "",
        cf.distrito ?? "",
        cf.direccion_envio ?? "",
        cf.dni_ruc ?? "",
        cf.modalidad_entrega ?? "",
        (c.tags ?? []).join(" | "),
        c.aiSummary ?? "",
        c.updatedAt ? new Date(c.updatedAt).toLocaleString("es-PE", { timeZone: "America/Lima" }) : "",
      ];
    })
  );

  // 3. CSV de Catalogo y Stock
  const csvCatalogo = aCsv(
    [
      "SKU",
      "Producto",
      "Categoria",
      "Precio_PEN",
      "Precio_Regular_PEN",
      "Stock_Unidades",
      "Disponible",
      "URL_Tienda",
    ],
    listaProductos.map((pr) => [
      pr.sku ?? "",
      pr.titulo,
      pr.categoria,
      `S/ ${Number(pr.precio).toFixed(2)}`,
      pr.precioRegular ? `S/ ${Number(pr.precioRegular).toFixed(2)}` : "",
      pr.stock,
      pr.disponible ? "SI" : "NO",
      pr.publicUrl ?? "",
    ])
  );

  // 4. Respaldo JSON integral en tiempo real
  const respaldoJson = JSON.stringify(
    {
      negocio: "Aliv Store (https://alivstore.shop/)",
      moneda: "PEN",
      sincronizadoEn: fechaIso,
      urlPublicaActiva: urlPublica,
      resumen: {
        pedidos: listaPedidos.length,
        contactos: listaContactos.length,
        productos: listaProductos.length,
        operacionesPipeline: listaDeals.length,
        conversaciones: listaConvs.length,
      },
      pedidos: listaPedidos,
      contactos: listaContactos,
      catalogo: listaProductos,
      pipelineDeals: listaDeals,
    },
    null,
    2
  );

  // 5. Archivo informativo con el enlace publico para los vendedores que abran la carpeta de Drive
  const infoEquipo = [
    "================================================================",
    "   ALIV STORE CRM — ACCESO REMOTO PARA VENDEDORES Y EQUIPO",
    "================================================================",
    "",
    `Última sincronización automática: ${ahora.toLocaleString("es-PE", { timeZone: "America/Lima" })}`,
    `Enlace Web Público Activo:       ${urlPublica ?? "Iniciando túnel..."}`,
    "",
    "ARCHIVOS EN ESTA CARPETA DE GOOGLE DRIVE (SE ACTUALIZAN SOLOS):",
    "1. Pedidos_COD_AlivStore.csv        -> Todas las órdenes contraentrega, guías Shalom/Olva y estados.",
    "2. Contactos_Clientes_AlivStore.csv -> Base de clientes, teléfonos, distritos, DNI y producto de interés.",
    "3. Catalogo_Productos_AlivStore.csv -> Stock y precios en Soles (PEN) de alivstore.shop.",
    "4. Respaldo_Completo_CRM.json       -> Copia de seguridad completa en tiempo real.",
    "",
    "¿CÓMO COMPARTIR CON TUS VENDEDORES?",
    "- Comparte el Enlace Web Público para que todos entren al CRM desde su celular o PC al mismo tiempo.",
    "- Comparte esta carpeta 'Aliv Store CRM' desde tu Google Drive para que todos vean los Excel/CSV en vivo.",
    "",
  ].join("\r\n");

  const archivos = [
    "Pedidos_COD_AlivStore.csv",
    "Contactos_Clientes_AlivStore.csv",
    "Catalogo_Productos_AlivStore.csv",
    "Respaldo_Completo_CRM.json",
    "LEEME_EQUIPO_ALIV.txt",
  ];

  writeFileSync(join(ruta, "Pedidos_COD_AlivStore.csv"), csvPedidos, "utf8");
  writeFileSync(join(ruta, "Contactos_Clientes_AlivStore.csv"), csvContactos, "utf8");
  writeFileSync(join(ruta, "Catalogo_Productos_AlivStore.csv"), csvCatalogo, "utf8");
  writeFileSync(join(ruta, "Respaldo_Completo_CRM.json"), respaldoJson, "utf8");
  writeFileSync(join(ruta, "LEEME_EQUIPO_ALIV.txt"), infoEquipo, "utf8");

  return {
    ok: true,
    carpeta: ruta,
    esGoogleDrive,
    archivos,
    totales: {
      pedidos: listaPedidos.length,
      contactos: listaContactos.length,
      productos: listaProductos.length,
    },
    urlPublica,
    sincronizadoEn: fechaIso,
  };
}
