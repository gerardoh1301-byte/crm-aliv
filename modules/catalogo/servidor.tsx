import "server-only";
import { NextResponse } from "next/server";
import { and, desc, eq, ilike, lte, or, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { contacts } from "@/db/schema";
import type { ModuloServidor, HandlerModulo, ToolModulo } from "@/lib/modules/types";
import manifiesto from "./manifiesto";
import { catalogoProductos } from "./tabla";
import { sincronizarDesdeShopify } from "./productos-aliv";
import { CatalogoPage } from "./componentes/CatalogoPage";
import { sincronizarConGoogleDrive } from "@/lib/drive-sync";

const listar: HandlerModulo = async (req) => {
  const q = new URL(req.url).searchParams.get("q")?.trim();
  const rows = await db
    .select()
    .from(catalogoProductos)
    .orderBy(desc(catalogoProductos.updatedAt));

  if (rows.length === 0) {
    // Auto-seed del catalogo de Aliv Store si la tabla aun esta vacia
    await sincronizarDesdeShopify();
    const recargados = await db
      .select()
      .from(catalogoProductos)
      .orderBy(desc(catalogoProductos.updatedAt));
    return NextResponse.json(recargados);
  }

  if (!q) return NextResponse.json(rows);

  const patron = `%${q}%`;
  const filtrados = await db
    .select()
    .from(catalogoProductos)
    .where(
      or(
        ilike(catalogoProductos.titulo, patron),
        ilike(catalogoProductos.categoria, patron),
        ilike(catalogoProductos.descripcion, patron),
        ilike(catalogoProductos.beneficios, patron),
        ilike(catalogoProductos.sku, patron)
      )
    )
    .orderBy(desc(catalogoProductos.updatedAt));

  return NextResponse.json(filtrados);
};

const crearOSincronizar: HandlerModulo = async (req) => {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "JSON invalido" }, { status: 400 });

  if (body.action === "sync_shopify") {
    const storeUrl = typeof body.storeUrl === "string" ? body.storeUrl : undefined;
    const res = await sincronizarDesdeShopify(storeUrl);
    await sincronizarConGoogleDrive().catch(() => {});
    return NextResponse.json(res);
  }

  const titulo = typeof body.titulo === "string" ? body.titulo.trim() : "";
  if (!titulo) return NextResponse.json({ error: "El titulo es obligatorio" }, { status: 400 });

  const [nuevo] = await db
    .insert(catalogoProductos)
    .values({
      titulo,
      sku: typeof body.sku === "string" ? body.sku : null,
      handle:
        typeof body.handle === "string"
          ? body.handle
          : titulo
              .toLowerCase()
              .normalize("NFD")
              .replace(/[\u0300-\u036f]/g, "")
              .replace(/[^a-z0-9]+/g, "-")
              .replace(/(^-|-$)/g, ""),
      categoria: typeof body.categoria === "string" ? body.categoria : "Bienestar",
      descripcion: typeof body.descripcion === "string" ? body.descripcion : null,
      beneficios: typeof body.beneficios === "string" ? body.beneficios : null,
      precauciones: typeof body.precauciones === "string" ? body.precauciones : null,
      precio: String(body.precio ?? "0"),
      precioRegular: body.precioRegular ? String(body.precioRegular) : null,
      moneda: "PEN",
      stock: Number(body.stock ?? 50),
      disponible: body.disponible !== false,
      imagenUrl: typeof body.imagenUrl === "string" ? body.imagenUrl : null,
      publicUrl: typeof body.publicUrl === "string" ? body.publicUrl : null,
    })
    .returning();

  await sincronizarConGoogleDrive().catch(() => {});
  return NextResponse.json(nuevo, { status: 201 });
};

const actualizar: HandlerModulo = async (req, { params }) => {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "JSON invalido" }, { status: 400 });

  const updates: Partial<typeof catalogoProductos.$inferInsert> = { updatedAt: new Date() };
  if (typeof body.titulo === "string" && body.titulo.trim()) updates.titulo = body.titulo.trim();
  if (body.sku !== undefined) updates.sku = body.sku ? String(body.sku) : null;
  if (typeof body.categoria === "string") updates.categoria = body.categoria;
  if (body.descripcion !== undefined) updates.descripcion = body.descripcion ? String(body.descripcion) : null;
  if (body.beneficios !== undefined) updates.beneficios = body.beneficios ? String(body.beneficios) : null;
  if (body.precauciones !== undefined) updates.precauciones = body.precauciones ? String(body.precauciones) : null;
  if (body.precio !== undefined) updates.precio = String(body.precio);
  if (body.precioRegular !== undefined) {
    updates.precioRegular = body.precioRegular ? String(body.precioRegular) : null;
  }
  if (body.stock !== undefined) updates.stock = Math.max(0, Number(body.stock) || 0);
  if (typeof body.disponible === "boolean") updates.disponible = body.disponible;
  if (body.imagenUrl !== undefined) updates.imagenUrl = body.imagenUrl ? String(body.imagenUrl) : null;
  if (body.publicUrl !== undefined) updates.publicUrl = body.publicUrl ? String(body.publicUrl) : null;

  const [actualizado] = await db
    .update(catalogoProductos)
    .set(updates)
    .where(eq(catalogoProductos.id, params.id))
    .returning();

  if (!actualizado) return NextResponse.json({ error: "Producto no encontrado" }, { status: 404 });
  await sincronizarConGoogleDrive().catch(() => {});
  return NextResponse.json(actualizado);
};

const borrar: HandlerModulo = async (_req, { params }) => {
  await db.delete(catalogoProductos).where(eq(catalogoProductos.id, params.id));
  await sincronizarConGoogleDrive().catch(() => {});
  return NextResponse.json({ ok: true });
};

async function etiquetarInteresContacto(contactId: string, etiqueta: string) {
  const limpia = etiqueta.trim().slice(0, 40);
  if (!limpia) return;
  try {
    const [c] = await db
      .select({ tags: contacts.tags })
      .from(contacts)
      .where(eq(contacts.id, contactId))
      .limit(1);
    if (!c || (c.tags ?? []).some((t) => t.toLowerCase() === limpia.toLowerCase())) return;
    await db
      .update(contacts)
      .set({ tags: [...(c.tags ?? []), limpia], updatedAt: new Date() })
      .where(eq(contacts.id, contactId));
  } catch {
    /* no interrumpir respuesta del agente */
  }
}

const tools: ToolModulo[] = [
  {
    definicion: {
      type: "function",
      function: {
        name: "buscar_productos",
        description:
          "Busca productos en el catalogo oficial de Aliv Store (alivstore.shop) por nombre, sintoma/molestia a aliviar (ej. cuello, cervical, hombro, tobillo, migrana, higado, antioxidante, menopausia, perfume), categoria o precio maximo en Soles (PEN). Devuelve stock, precio real en S/ y link.",
        parameters: {
          type: "object",
          properties: {
            consulta: {
              type: "string",
              description:
                "Palabra clave, nombre del producto o molestia del cliente (ej. 'NAC600', 'tobillera', 'hombro', 'cuello', 'migrana', 'menopausia', 'perfume'). Vacio para listar todo el catalogo.",
            },
            precio_max: {
              type: "number",
              description: "Precio maximo en Soles Peruanos (PEN).",
            },
            solo_disponibles: {
              type: "boolean",
              description: "Si es true (por defecto), solo muestra productos con stock disponible.",
            },
          },
          additionalProperties: false,
        },
      },
    },
    descripcionUI: "Permite al agente consultar el catálogo oficial de Aliv Store con precios en Soles y stock real.",
    async ejecutar(args, ctx) {
      let total = await db.select().from(catalogoProductos);
      if (total.length === 0) {
        await sincronizarDesdeShopify();
        total = await db.select().from(catalogoProductos);
      }

      const conds: SQL[] = [];
      if (args.solo_disponibles !== false) {
        conds.push(eq(catalogoProductos.disponible, true));
      }
      if (typeof args.precio_max === "number" && args.precio_max > 0) {
        conds.push(lte(catalogoProductos.precio, String(args.precio_max)));
      }

      const consulta = typeof args.consulta === "string" ? args.consulta.trim() : "";
      if (consulta) {
        const palabras = consulta
          .split(/\s+/)
          .map((w) => w.trim())
          .filter((w) => w.length >= 2);
        const orConds: SQL[] = [];
        for (const p of palabras.length > 0 ? palabras : [consulta]) {
          const pat = `%${p}%`;
          orConds.push(
            ilike(catalogoProductos.titulo, pat),
            ilike(catalogoProductos.categoria, pat),
            ilike(catalogoProductos.descripcion, pat),
            ilike(catalogoProductos.beneficios, pat),
            ilike(catalogoProductos.handle, pat),
            ilike(catalogoProductos.sku, pat)
          );
        }
        if (orConds.length > 0) conds.push(or(...orConds)!);
        await etiquetarInteresContacto(ctx.contactId, `interes:${consulta.toLowerCase()}`);
      }

      let rows = await db
        .select()
        .from(catalogoProductos)
        .where(conds.length > 0 ? and(...conds) : undefined)
        .orderBy(catalogoProductos.precio);

      // Si la palabra especifica no dio match exacto, devolver el catalogo completo disponible para que el agente oriente bien
      if (rows.length === 0) {
        rows = total.filter((p) => p.disponible && p.stock > 0);
      }

      return {
        ok: true,
        data: {
          moneda: "PEN (Soles Peruanos S/)",
          modalidad_pago: "Pago Contraentrega (COD) en Lima y Provincias, Yape, Plin o Tarjeta",
          cantidad: rows.length,
          productos: rows.map((r) => ({
            sku: r.sku,
            nombre: r.titulo,
            categoria: r.categoria,
            precio_soles: `S/ ${Number(r.precio).toFixed(2)}`,
            precio_regular_soles: r.precioRegular ? `S/ ${Number(r.precioRegular).toFixed(2)}` : null,
            en_stock: r.disponible && r.stock > 0,
            unidades_disponibles: r.stock,
            descripcion: r.descripcion,
            beneficios: r.beneficios,
            precauciones: r.precauciones,
            link_tienda: r.publicUrl,
          })),
        },
      };
    },
  },
  {
    definicion: {
      type: "function",
      function: {
        name: "detalle_producto",
        description:
          "Obtiene toda la ficha tecnica, modo de uso, beneficios, contraindicaciones y stock exacto de un producto especifico de Aliv Store por su nombre, SKU o handle.",
        parameters: {
          type: "object",
          properties: {
            producto: {
              type: "string",
              description: "Nombre, SKU o handle del producto (ej. 'NAC600', 'Termix Tobillera', 'Nuvara', 'Herbia', 'Meno Mag', 'GODA').",
            },
          },
          required: ["producto"],
          additionalProperties: false,
        },
      },
    },
    descripcionUI: "Obtiene la ficha detallada, modo de uso y precauciones de un producto de Aliv Store.",
    async ejecutar(args, ctx) {
      const q = String(args.producto ?? "").trim();
      if (!q) return { ok: false, error: "Debes indicar el nombre o SKU del producto" };

      const pat = `%${q}%`;
      const [prod] = await db
        .select()
        .from(catalogoProductos)
        .where(
          or(
            ilike(catalogoProductos.titulo, pat),
            ilike(catalogoProductos.sku, pat),
            ilike(catalogoProductos.handle, pat)
          )
        )
        .limit(1);

      if (!prod) {
        return {
          ok: false,
          error: `No se encontro "${q}". Usa buscar_productos sin filtro para ver todos los productos de Aliv Store.`,
        };
      }

      await etiquetarInteresContacto(ctx.contactId, prod.handle ?? prod.titulo);

      return {
        ok: true,
        data: {
          sku: prod.sku,
          nombre: prod.titulo,
          categoria: prod.categoria,
          precio_soles: `S/ ${Number(prod.precio).toFixed(2)}`,
          precio_antes: prod.precioRegular ? `S/ ${Number(prod.precioRegular).toFixed(2)}` : null,
          disponible: prod.disponible && prod.stock > 0,
          stock: prod.stock,
          descripcion: prod.descripcion,
          beneficios: prod.beneficios,
          precauciones: prod.precauciones,
          link: prod.publicUrl,
        },
      };
    },
  },
];

const modulo: ModuloServidor = {
  manifiesto,
  paginas: {
    "": () => <CatalogoPage />,
  },
  api: {
    "": { GET: listar, POST: crearOSincronizar },
    "[id]": { PATCH: actualizar, DELETE: borrar },
  },
  tools,
  async seed() {
    await sincronizarDesdeShopify();
  },
};

export default modulo;
