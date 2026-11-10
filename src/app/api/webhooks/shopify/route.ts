import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import { db } from "@/db";
import { activities, contacts, crmSettings, webhookEvents } from "@/db/schema";
import { eq, or } from "drizzle-orm";
import { resolveDefaultTenantId } from "@/lib/tenants";
import { sincronizarConGoogleDrive } from "@/lib/drive-sync";
import { pedidosOrdenes, type ItemPedido } from "../../../../../modules/pedidos/tabla";

export const dynamic = "force-dynamic";

async function leerSetting(key: string): Promise<string | null> {
  try {
    const [row] = await db
      .select({ value: crmSettings.value })
      .from(crmSettings)
      .where(eq(crmSettings.key, key))
      .limit(1);
    return row?.value?.trim() || null;
  } catch {
    return null;
  }
}

async function verificarFirmaShopify(
  rawBody: string,
  hmacHeader: string | null
): Promise<boolean> {
  const secret =
    process.env.SHOPIFY_WEBHOOK_SECRET?.trim() ||
    (await leerSetting("shopify.webhook_secret"));

  // Si no hay secreto configurado, aceptar el webhook para no bloquear pedidos entrantes de Shopify/EasySell
  if (!secret) {
    console.warn(
      "[shopify-webhook] AVISO: SHOPIFY_WEBHOOK_SECRET no configurado. Aceptando webhook de Shopify para evitar pérdida de pedidos."
    );
    return true;
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

export interface ShopifyOrderWebhook {
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
  tags?: string;
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
  billing_address?: {
    first_name?: string;
    last_name?: string;
    phone?: string;
    address1?: string;
    address2?: string;
    city?: string;
    province?: string;
  };
  line_items?: Array<{
    sku?: string | null;
    title?: string;
    quantity?: number;
    price?: string;
  }>;
}

/**
 * Webhook nativo para Shopify y formularios EasySell COD (https://alivstore.shop).
 * Configurar en Shopify Admin -> Ajustes -> Notificaciones -> Notificaciones para desarrolladores (Webhooks):
 *   Evento: Creación de pedidos (orders/create)
 *   URL:    https://crm-aliv.onrender.com/api/webhooks/shopify
 */
export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const hmac = req.headers.get("x-shopify-hmac-sha256");
  const topic = req.headers.get("x-shopify-topic") || "orders/create";
  const shopDomain = req.headers.get("x-shopify-shop-domain") || "alivstore.myshopify.com";

  const esValido = await verificarFirmaShopify(rawBody, hmac);
  if (!esValido) {
    return NextResponse.json({ error: "Firma HMAC de Shopify inválida" }, { status: 401 });
  }

  let payload: ShopifyOrderWebhook = {};
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Payload no es JSON válido" }, { status: 400 });
  }

  const shopifyOrderId = payload.id ? String(payload.id) : null;
  if (!shopifyOrderId) {
    return NextResponse.json({ ok: true, ignored: "sin_id" });
  }

  // Registrar evento de webhook para trazabilidad total
  try {
    await db
      .insert(webhookEvents)
      .values({
        eventId: `shopify-${shopifyOrderId}-${Date.now()}`,
        provider: "shopify",
        event: topic,
        status: "processed",
        attempts: 1,
        payload: payload as unknown as Record<string, unknown>,
      })
      .onConflictDoNothing();
  } catch (err) {
    console.error("[shopify-webhook] error guardando evento en webhook_events:", err);
  }

  const tenantId = await resolveDefaultTenantId();
  const shipping = payload.shipping_address || payload.billing_address;
  const customer = payload.customer;

  const nombre =
    [shipping?.first_name ?? customer?.first_name, shipping?.last_name ?? customer?.last_name]
      .filter(Boolean)
      .join(" ")
      .trim() ||
    customer?.first_name ||
    shipping?.first_name ||
    "Cliente Shopify Aliv";

  const telefono = normalizarTelefonoPeru(
    shipping?.phone || customer?.phone || payload.billing_address?.phone
  );
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

  const tags = ["shopify", "alivstore"];
  if (payload.tags?.includes("easysell")) {
    tags.push("easysell_cod");
  }

  if (!contactId) {
    const [creado] = await db
      .insert(contacts)
      .values({
        name: nombre,
        phone: telefono,
        email,
        source: "website",
        score: 85,
        tags,
        customFields: {
          departamento_ciudad: ciudad,
          ...(distrito ? { distrito } : {}),
          ...(direccion ? { direccion_envio: direccion } : {}),
          modalidad_entrega: ciudad.toLowerCase().includes("lima")
            ? "Contraentrega Domicilio (Lima)"
            : "Agencia / Courier Provincia",
        },
        tenantId,
      })
      .returning({ id: contacts.id });
    contactId = creado.id;
  }

  const items: ItemPedido[] = (payload.line_items ?? []).map((li) => ({
    sku: li.sku || "ALIV-NAC600",
    titulo: li.title || "NAC600 + NAD+ (60 cápsulas)",
    cantidad: Math.max(1, Number(li.quantity) || 1),
    precioUnitario: Math.max(0, Number(li.price) || 0),
  }));

  const numeroOrden = payload.name
    ? String(payload.name).startsWith("#")
      ? String(payload.name)
      : `#${payload.name}`
    : payload.order_number
    ? `#${payload.order_number}`
    : `#ALIV-SHOP-${shopifyOrderId.slice(-5)}`;

  const [yaRegistrado] = await db
    .select({ id: pedidosOrdenes.id })
    .from(pedidosOrdenes)
    .where(
      or(
        eq(pedidosOrdenes.shopifyOrderId, shopifyOrderId),
        eq(pedidosOrdenes.numeroOrden, numeroOrden)
      )
    )
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
      dniCliente: payload.shipping_address?.company || null,
      ciudad,
      distrito,
      direccionEnvio: direccion || null,
      notas:
        payload.note ||
        `Pedido web ${numeroOrden} desde ${shopDomain} (Canal: ${payload.gateway || "EasySell COD Form"})`,
    });

    await db.insert(activities).values({
      type: "note",
      description: `Pedido web ${numeroOrden} recibido desde ${shopDomain} por S/ ${
        payload.total_price ?? "0.00"
      }`,
      contactId,
    });
    await sincronizarConGoogleDrive().catch(() => {});
  }

  return NextResponse.json({ ok: true, numeroOrden, yaRegistrado: Boolean(yaRegistrado) });
}
