import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { contacts, crmSettings } from "@/db/schema";
import { pedidosOrdenes, type ItemPedido } from "../../../../../modules/pedidos/tabla";
import { sincronizarEtapaPipeline } from "../../../../../modules/pedidos/servidor";
import { eq, or, desc } from "drizzle-orm";
import { requireAdmin } from "@/lib/api-auth";
import { resolveDefaultTenantId } from "@/lib/tenants";
import { sincronizarConGoogleDrive } from "@/lib/drive-sync";

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

async function guardarSetting(key: string, value: string) {
  await db
    .insert(crmSettings)
    .values({ key, value })
    .onConflictDoUpdate({
      target: crmSettings.key,
      set: { value },
    });
}

function normalizarTelefonoPeru(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  if (!digits) return null;
  if (digits.length === 9 && digits.startsWith("9")) return `+51${digits}`;
  if (digits.startsWith("51") && digits.length === 11) return `+${digits}`;
  return raw.startsWith("+") ? raw : `+${digits}`;
}

export async function GET() {
  const auth = await requireAdmin();
  if ("response" in auth) return auth.response;

  const storeUrl =
    (await leerSetting("shopify.store_url")) ||
    process.env.SHOPIFY_STORE_URL ||
    "alivstore.myshopify.com";
  const hasToken = Boolean(
    (await leerSetting("shopify.access_token")) || process.env.SHOPIFY_ACCESS_TOKEN
  );
  const hasWebhookSecret = Boolean(
    (await leerSetting("shopify.webhook_secret")) ||
      process.env.SHOPIFY_WEBHOOK_SECRET
  );

  const [totalOrders] = await db
    .select()
    .from(pedidosOrdenes)
    .where(eq(pedidosOrdenes.moneda, "PEN"));

  return NextResponse.json({
    ok: true,
    webhookUrl: "https://crm-aliv.onrender.com/api/webhooks/shopify",
    storeUrl,
    hasToken,
    hasWebhookSecret,
  });
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin();
  if ("response" in auth) return auth.response;

  const body = (await req.json().catch(() => ({}))) as {
    action?: "save_settings" | "sync_api" | "import_manual";
    storeUrl?: string;
    accessToken?: string;
    webhookSecret?: string;
    orders?: Array<{
      numeroOrden: string;
      nombreCliente: string;
      telefono?: string;
      total: string | number;
      ciudad?: string;
      distrito?: string;
      direccion?: string;
      items?: ItemPedido[];
      notas?: string;
      fecha?: string;
    }>;
  };

  if (body.action === "save_settings") {
    if (typeof body.storeUrl === "string") {
      await guardarSetting("shopify.store_url", body.storeUrl.trim());
    }
    if (typeof body.accessToken === "string") {
      await guardarSetting("shopify.access_token", body.accessToken.trim());
    }
    if (typeof body.webhookSecret === "string") {
      await guardarSetting("shopify.webhook_secret", body.webhookSecret.trim());
    }
    return NextResponse.json({ ok: true, mensaje: "Ajustes de Shopify guardados" });
  }

  // 1. Sincronización manual / importación de órdenes (ej. las órdenes EasySell de la captura)
  if (body.action === "import_manual" || (Array.isArray(body.orders) && body.orders.length > 0)) {
    const ordersList = body.orders ?? [];
    const tenantId = await resolveDefaultTenantId();
    let importados = 0;
    let actualizados = 0;

    for (const o of ordersList) {
      const numeroOrden = o.numeroOrden.startsWith("#") ? o.numeroOrden : `#${o.numeroOrden}`;
      const nombre = o.nombreCliente?.trim() || "Cliente Shopify";
      const telefono = normalizarTelefonoPeru(o.telefono);
      const ciudad = o.ciudad?.trim() || "Lima";
      const distrito = o.distrito?.trim() || null;
      const direccion = o.direccion?.trim() || null;
      const total = Number(o.total) || 199;

      // Buscar o crear contacto
      let contactId: string | null = null;
      if (telefono) {
        const [existente] = await db
          .select({ id: contacts.id })
          .from(contacts)
          .where(eq(contacts.phone, telefono))
          .limit(1);
        if (existente) contactId = existente.id;
      }

      if (!contactId) {
        const [creado] = await db
          .insert(contacts)
          .values({
            name: nombre,
            phone: telefono,
            source: "website",
            score: 90,
            tags: ["shopify", "easysell_cod", "alivstore"],
            customFields: {
              departamento_ciudad: ciudad,
              ...(distrito ? { distrito } : {}),
              ...(direccion ? { direccion_envio: direccion } : {}),
              modalidad_entrega: ciudad.toLowerCase().includes("lima")
                ? "Contraentrega Domicilio (Lima)"
                : "Agencia Shalom / Olva",
            },
            tenantId,
          })
          .returning({ id: contacts.id });
        contactId = creado.id;
      }

      const items: ItemPedido[] =
        Array.isArray(o.items) && o.items.length > 0
          ? o.items
          : [
              {
                sku: "ALIV-NAC600",
                titulo: "NAC600 + NAD+ (60 cápsulas)",
                cantidad: 3,
                precioUnitario: 66.33,
              },
            ];

      const [yaExiste] = await db
        .select({ id: pedidosOrdenes.id, dealId: pedidosOrdenes.dealId, estado: pedidosOrdenes.estado })
        .from(pedidosOrdenes)
        .where(eq(pedidosOrdenes.numeroOrden, numeroOrden))
        .limit(1);

      const primerProducto = items[0]?.titulo ?? "Pedido Aliv";
      const cant = items[0]?.cantidad ? `${items[0].cantidad}x ` : "";
      const tituloDeal = `${numeroOrden} · ${cant}${primerProducto}`;

      if (!yaExiste) {
        const dealId = await sincronizarEtapaPipeline(
          contactId,
          "por_confirmar_cod",
          tituloDeal,
          total
        );

        await db.insert(pedidosOrdenes).values({
          numeroOrden,
          shopifyOrderId: `manual-${numeroOrden.replace(/\D/g, "")}`,
          contactId,
          dealId,
          estado: "por_confirmar_cod",
          modalidadPago: "contraentrega",
          items,
          total: total.toFixed(2),
          moneda: "PEN",
          ciudad,
          distrito,
          direccionEnvio: direccion,
          notas: o.notas || "Importado desde Shopify (Canal: EasySell COD Form)",
        });
        importados++;
      } else {
        if (!yaExiste.dealId) {
          const dealId = await sincronizarEtapaPipeline(
            contactId,
            (yaExiste.estado as any) || "por_confirmar_cod",
            tituloDeal,
            total,
            yaExiste.id
          );
          if (dealId) {
            await db
              .update(pedidosOrdenes)
              .set({ dealId })
              .where(eq(pedidosOrdenes.id, yaExiste.id));
          }
        }
        actualizados++;
      }
    }

    await sincronizarConGoogleDrive().catch(() => {});

    return NextResponse.json({
      ok: true,
      importados,
      actualizados,
      mensaje: `Sincronización completada: ${importados} pedidos nuevos registrados en el CRM.`,
    });
  }

  // 2. Sincronización automática vía Shopify Admin API (si hay token configurado)
  const token =
    (await leerSetting("shopify.access_token")) || process.env.SHOPIFY_ACCESS_TOKEN;
  const store =
    (await leerSetting("shopify.store_url")) ||
    process.env.SHOPIFY_STORE_URL ||
    "alivstore.myshopify.com";

  if (!token) {
    return NextResponse.json(
      {
        error:
          "Para sincronización directa por API de Shopify, ingresa tu Access Token (shpat_...) o importa los pedidos por lista/webhook.",
        needsToken: true,
      },
      { status: 400 }
    );
  }

  try {
    const domain = store.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    const res = await fetch(`https://${domain}/admin/api/2024-01/orders.json?status=any&limit=50`, {
      headers: {
        "X-Shopify-Access-Token": token,
        "Content-Type": "application/json",
      },
    });

    if (!res.ok) {
      const errText = await res.text();
      return NextResponse.json(
        { error: `Shopify API respondió ${res.status}: ${errText}` },
        { status: 502 }
      );
    }

    const data = (await res.json()) as { orders?: Array<Record<string, unknown>> };
    const rawOrders = data.orders ?? [];
    let importados = 0;

    for (const po of rawOrders) {
      const shopifyId = String(po.id);
      const name = String(po.name || `#${po.order_number}`);
      const [ya] = await db
        .select({ id: pedidosOrdenes.id, dealId: pedidosOrdenes.dealId, estado: pedidosOrdenes.estado })
        .from(pedidosOrdenes)
        .where(
          or(
            eq(pedidosOrdenes.shopifyOrderId, shopifyId),
            eq(pedidosOrdenes.numeroOrden, name)
          )
        )
        .limit(1);

      if (!ya) {
        // Enviar por el pipeline estándar de webhook
        const customer = (po.customer ?? {}) as Record<string, unknown>;
        const shipping = ((po.shipping_address || po.billing_address) ?? {}) as Record<
          string,
          unknown
        >;
        const nombre =
          [shipping.first_name ?? customer.first_name, shipping.last_name ?? customer.last_name]
            .filter(Boolean)
            .join(" ") || "Cliente Shopify";
        const telefono = normalizarTelefonoPeru(
          String(shipping.phone || customer.phone || "")
        );
        const email = String(customer.email || "").trim().toLowerCase() || null;
        const ciudad = String(shipping.province || shipping.city || "Lima");
        const distrito = shipping.city ? String(shipping.city) : null;
        const direccion = [shipping.address1, shipping.address2].filter(Boolean).join(" — ");

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

        if (!contactId) {
          const tenantId = await resolveDefaultTenantId();
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
              },
              tenantId,
            })
            .returning({ id: contacts.id });
          contactId = creado.id;
        }

        const rawLineItems = Array.isArray(po.line_items) ? po.line_items : [];
        const items: ItemPedido[] = rawLineItems.map((li: Record<string, unknown>) => ({
          sku: String(li.sku || "ALIV-NAC600"),
          titulo: String(li.title || "NAC600 + NAD+ (60 cápsulas)"),
          cantidad: Math.max(1, Number(li.quantity) || 1),
          precioUnitario: Math.max(0, Number(li.price) || 0),
        }));

        const primerProducto = items[0]?.titulo ?? "Pedido Aliv";
        const cant = items[0]?.cantidad ? `${items[0].cantidad}x ` : "";
        const dealId = await sincronizarEtapaPipeline(
          contactId,
          "por_confirmar_cod",
          `${name} · ${cant}${primerProducto}`,
          Number(po.total_price) || 0
        );

        await db.insert(pedidosOrdenes).values({
          numeroOrden: name,
          shopifyOrderId: shopifyId,
          contactId,
          dealId,
          estado: "por_confirmar_cod",
          modalidadPago: "contraentrega",
          items,
          total: String(po.total_price ?? "0.00"),
          moneda: String(po.currency || "PEN"),
          ciudad,
          distrito,
          direccionEnvio: direccion || null,
          notas: String(
            po.note || `Pedido importado desde Shopify (Canal: ${po.gateway || "web"})`
          ),
        });
        importados++;
      } else if (!ya.dealId) {
        const rawLineItems = Array.isArray(po.line_items) ? po.line_items : [];
        const primer = String(rawLineItems[0]?.title || "Pedido Aliv");
        const cant = rawLineItems[0]?.quantity ? `${rawLineItems[0].quantity}x ` : "";
        const contactId = (await db.select({ contactId: pedidosOrdenes.contactId }).from(pedidosOrdenes).where(eq(pedidosOrdenes.id, ya.id)).limit(1))[0]?.contactId;
        if (contactId) {
          const dealId = await sincronizarEtapaPipeline(
            contactId,
            (ya.estado as any) || "por_confirmar_cod",
            `${name} · ${cant}${primer}`,
            Number(po.total_price) || 0,
            ya.id
          );
          if (dealId) {
            await db
              .update(pedidosOrdenes)
              .set({ dealId })
              .where(eq(pedidosOrdenes.id, ya.id));
          }
        }
      }
    }

    await sincronizarConGoogleDrive().catch(() => {});
    return NextResponse.json({
      ok: true,
      importados,
      totalShopify: rawOrders.length,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Error sincronizando con Shopify" },
      { status: 500 }
    );
  }
}
