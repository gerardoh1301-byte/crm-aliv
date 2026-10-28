import { pgTable, text, numeric, jsonb, timestamp } from "drizzle-orm/pg-core";
import { contacts, deals } from "@/db/schema";

export interface ItemPedido {
  sku: string;
  titulo: string;
  cantidad: number;
  precioUnitario: number;
}

/**
 * Tabla de ordenes y envios COD (espejo tipado de migrations/0000_pedidos.sql).
 */
export const pedidosOrdenes = pgTable("pedidos_ordenes", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  numeroOrden: text("numero_orden").notNull().unique(),
  shopifyOrderId: text("shopify_order_id").unique(),
  contactId: text("contact_id")
    .notNull()
    .references(() => contacts.id, { onDelete: "cascade" }),
  dealId: text("deal_id").references(() => deals.id, { onDelete: "set null" }),
  /** por_confirmar_cod | confirmado | preparando | enviado | entregado | cancelado */
  estado: text("estado").notNull().default("por_confirmar_cod"),
  /** contraentrega | yape | plin | adelanto_agencia | tarjeta */
  modalidadPago: text("modalidad_pago").notNull().default("contraentrega"),
  items: jsonb("items").$type<ItemPedido[]>().notNull().default([]),
  total: numeric("total", { precision: 12, scale: 2 }).notNull().default("0"),
  moneda: text("moneda").notNull().default("PEN"),
  dniCliente: text("dni_cliente"),
  ciudad: text("ciudad"),
  distrito: text("distrito"),
  direccionEnvio: text("direccion_envio"),
  transportadora: text("transportadora"),
  numeroGuia: text("numero_guia"),
  claveRecojo: text("clave_recojo"),
  notas: text("notas"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
