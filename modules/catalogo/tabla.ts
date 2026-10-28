import { pgTable, text, integer, numeric, boolean, timestamp } from "drizzle-orm/pg-core";

/**
 * Tabla del catalogo de productos de E-commerce (espejo tipado de migrations/0000_catalogo.sql).
 */
export const catalogoProductos = pgTable("catalogo_productos", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  shopifyId: text("shopify_id").unique(),
  sku: text("sku"),
  handle: text("handle"),
  titulo: text("titulo").notNull(),
  categoria: text("categoria").notNull().default("Bienestar"),
  descripcion: text("descripcion"),
  beneficios: text("beneficios"),
  precauciones: text("precauciones"),
  precio: numeric("precio", { precision: 12, scale: 2 }).notNull().default("0"),
  precioRegular: numeric("precio_regular", { precision: 12, scale: 2 }),
  moneda: text("moneda").notNull().default("PEN"),
  stock: integer("stock").notNull().default(50),
  disponible: boolean("disponible").notNull().default(true),
  imagenUrl: text("imagen_url"),
  publicUrl: text("public_url"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
