import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import { db } from "@/db";
import { activities, contacts } from "@/db/schema";
import { eq, or } from "drizzle-orm";
import { resolveDefaultTenantId } from "@/lib/tenants";
import { sincronizarConGoogleDrive } from "@/lib/drive-sync";
import { pedidosOrdenes, type ItemPedido } from "../../../../../modules/pedidos/tabla";

export const dynamic = "force-dynamic";

function verificarFirmaShopify(rawBody: string, hmacHeader: string | null): boolean {
  const secret = process.env.SHOPIFY_WEBHOOK_SECRET?.trim();
  if (!secret) {
    return process.env.NODE_ENV !== "production";
  }
  if (!hmacHeader) return false;
  const digest = createHmac("sha256", secret).update(rawBody, "utf8").digest("base64");
  const a = Buffer.from(digest);
  const b = Buffer.from(hmacHeader);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function normalizarTelefonoPeru(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  if (!digits) return null;
  if (digits.length === 9 && digits.startsWith("9")) return `+51${digits}`;
  if (digits.startsWith("51") && digits.length === 11) return `+${digits}`;
  return raw.startsWith("+") ? raw : `+${digits}`;
}

interface ShopifyOrderWebhook {
  id?: number | string;
  name?: string;
  order_number?: number | string;
  total_price?: string;
  currency?: string;
  financial_status?: string;
  fulfillment_status?: string | null;
  gateway?: string;
  payment_gateway_names?: string[];
  note?: string | null;
  customer?: {
    first_name?: string;
    last_name?: string;
    email?: string;
    phone?: string;
  };
  shipping_address?: {
    first_name?: string;
    last_name?: string;
    phone?: string;
    address1?: string;
    address2?: string;
    city?: string;
    province?: string;
    zip?: string;
    company?: string;
  };
  line_items?: Array<{
    sku?: string | null;
    title?: string;
    quantity?: number;
    price?: string;
  }>;
}

/**
 * Webhook nativo para Shopify (https://alivstore.shop).
 * Configurar en Shopify Admin -> Ajustes -> Notificaciones -> Webhooks:
 *   Evento: Creacion de pedido (orders/create)
 *   URL:    https://<tu-dominio>/api/webhooks/shopify
 */
export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const hmac = req.headers.get("x-shopify-hmac-sha256");

  if (!verificarFirmaShopify(rawBody, hmac)) {
    return NextResponse.json({ error: "Firma HMAC de Shopify invalida" }, { status: 401 });
  }

  const payload = (JSON.parse(rawBody) as ShopifyOrderWebhook) ?? {};
  const shopifyOrderId = payload.id ? String(payload.id) : null;
  if (!shopifyOrderId) {
    return NextResponse.json({ ok: true, ignored: "sin_id" });
  }

  const tenantId = await resolveDefaultTenantId();
  const shipping = payload.shipping_address;
  const customer = payload.customer;

  const nombre =
    [shipping?.first_name ?? customer?.first_name, shipping?.last_name ?? customer?.last_name]
      .filter(Boolean)
      .join(" ")
      .trim() || "Cliente Shopify Aliv";

  const telefono = normalizarTelefonoPeru(shipping?.phone || customer?.phone);
  const email = customer?.email?.trim().toLowerCase() || null;

  // Buscar o crear contacto
  let contactId: string | null = null;
  if (telefono || email) {
    const conds = [];
    if (telefono) conds.push(eq(contacts.phone, telefono));
    if (email) conds.push(eq(contacts.email, email));
    const [existente] = await db
      .select({ id: contacts.id })
      .from(contacts)
      .where(conds.length === 1 ? conds[0] : or(...conds))
      .limit(1);
    if (existente) contactId = existente.id;
  }

  const direccion = [shipping?.address1, shipping?.address2].filter(Boolean).join(" — ");
  const ciudad = shipping?.province || shipping?.city || "Lima";
  const distrito = shipping?.city || null;

  if (!contactId) {
    const [creado] = await db
      .insert(contacts)
      .values({
        name: nombre,
        phone: telefono,
        email,
        source: "website",
        score: 85,
        tags: ["shopify", "alivstore"],
        customFields: {
          departamento_ciudad: ciudad,
          ...(distrito ? { distrito } : {}),
          ...(direccion ? { direccion_envio: direccion } : {}),
          modalidad_entrega: "Contraentrega Domicilio (Lima)",
        },
        tenantId,
      })
      .returning({ id: contacts.id });
    contactId = creado.id;
  }

  const items: ItemPedido[] = (payload.line_items ?? []).map((li) => ({
    sku: li.sku || "ALIV-SHOP",
    titulo: li.title || "Producto Aliv Store",
    cantidad: Math.max(1, Number(li.quantity) || 1),
    precioUnitario: Math.max(0, Number(li.price) || 0),
  }));

  const numeroOrden = payload.name
    ? `#ALIV-${String(payload.name).replace(/^#/, "")}`
    : `#ALIV-SHOP-${shopifyOrderId.slice(-5)}`;

  const [yaRegistrado] = await db
    .select({ id: pedidosOrdenes.id })
    .from(pedidosOrdenes)
    .where(eq(pedidosOrdenes.shopifyOrderId, shopifyOrderId))
    .limit(1);

  if (!yaRegistrado) {
    await db.insert(pedidosOrdenes).values({
      numeroOrden,
      shopifyOrderId,
      contactId,
      estado: "por_confirmar_cod",
      modalidadPago: "contraentrega",
      items,
      total: String(payload.total_price ?? "0.00"),
      moneda: payload.currency || "PEN",
      dniCliente: shipping?.company || null,
      ciudad,
      distrito,
      direccionEnvio: direccion || null,
      notas: payload.note || "Ingresado automáticamente desde alivstore.shop",
    });

    await db.insert(activities).values({
      type: "note",
      description: `Pedido web ${numeroOrden} recibido desde alivstore.shop por S/ ${
        payload.total_price ?? "0.00"
      }`,
      contactId,
    });
    await sincronizarConGoogleDrive().catch(() => {});
  }

  return NextResponse.json({ ok: true, numeroOrden });
}
