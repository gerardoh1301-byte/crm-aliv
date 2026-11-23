import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import { db } from "@/db";
import { activities, contacts, crmSettings, webhookEvents } from "@/db/schema";
import { and, eq, gte, ne, or } from "drizzle-orm";
import { resolveDefaultTenantId } from "@/lib/tenants";
import { sincronizarConGoogleDrive } from "@/lib/drive-sync";
import { alertarEquipo } from "@/lib/agent/alertas";
import { notificarSupervisoresCritico } from "@/lib/alerts/supervisor-alerts";
import { pedidosOrdenes, type ItemPedido } from "../../../../../modules/pedidos/tabla";
import { sincronizarEtapaPipeline } from "../../../../../modules/pedidos/servidor";
import { emitAutomationEvent } from "@/lib/automations";
import { extraerDatosFormularioShopify } from "@/lib/shopify/form-extractor";
import { marcarAbandonoRecuperado } from "@/lib/abandonos/servidor";
import { clasificarEntregaWeb, textoClasificacion } from "@/lib/shopify/clasificar-entrega-web";

export const dynamic = "force-dynamic";

const activeLocks = new Map<string, Promise<void>>();

async function executeWithLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  while (activeLocks.has(key)) {
    try {
      await activeLocks.get(key);
    } catch {
      // Ignorar errores previos
    }
  }
  let unlock!: () => void;
  const lockPromise = new Promise<void>((resolve) => {
    unlock = resolve;
  });
  activeLocks.set(key, lockPromise);
  try {
    return await fn();
  } finally {
    activeLocks.delete(key);
    unlock();
  }
}

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

  return await executeWithLock(`shopify-${shopifyOrderId}`, async () => {
    const tenantId = await resolveDefaultTenantId();
    const datosForm = extraerDatosFormularioShopify(payload as Record<string, any>);
    const nombre = datosForm.nombreCliente;
    const telefono = datosForm.telefono;
    const email = datosForm.email;
    const ciudad = datosForm.ciudad;
    const distrito = datosForm.distrito;
    const direccion = datosForm.direccionEnvio;
    const dni = datosForm.dni;
    // AG (agencia Shalom con adelanto) o CE (contra entrega) según la cobertura de AliClik.
    const entregaWeb = await clasificarEntregaWeb({ esProvincia: datosForm.esProvincia, ciudad, distrito, direccion });

  // Buscar o crear contacto
  let contactId: string | null = null;
  if (telefono || email) {
    const conds = [];
    if (telefono) conds.push(eq(contacts.phone, telefono));
    if (email) conds.push(eq(contacts.email, email));
    const [existente] = await db
      .select({ id: contacts.id, customFields: contacts.customFields })
      .from(contacts)
      .where(conds.length === 1 ? conds[0] : or(...conds))
      .limit(1);
    if (existente) {
      contactId = existente.id;
      // Actualizar customFields del contacto con la dirección más reciente si no la tenía
      const cf = (existente.customFields || {}) as Record<string, any>;
      await db
        .update(contacts)
        .set({
          customFields: {
            ...cf,
            departamento_ciudad: ciudad || cf.departamento_ciudad,
            distrito: distrito || cf.distrito,
            direccion_envio: direccion || cf.direccion_envio,
            dni_ruc: dni || cf.dni_ruc,
            modalidad_entrega: entregaWeb.modalidadEntrega,
          },
        })
        .where(eq(contacts.id, existente.id));
    }
  }

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
          ...(dni ? { dni_ruc: dni } : {}),
          modalidad_entrega: entregaWeb.modalidadEntrega,
        },
        tenantId,
      })
      .returning({ id: contacts.id });
    contactId = creado.id;
  }

  const items: ItemPedido[] = (payload.line_items ?? []).map((li) => {
    const titulo = li.title || "NAC600 + NAD+ (60 cápsulas)";
    const esTermix = /termix|tobill/i.test(titulo);
    const precio = Math.max(0, Number(li.price) || 0);
    let cant = Math.max(1, Number(li.quantity) || 1);
    // Si EasySell envió bundle como quantity=1 pero el precio o título indica 2x o 3x
    if (cant === 1) {
      const mCant = titulo.match(/(\d+)\s*(?:x|unid|tobill|frasc)/i);
      if (mCant) cant = parseInt(mCant[1], 10) || 1;
      else if (esTermix && Math.round(precio) === 139) cant = 2;
      else if (esTermix && Math.round(precio) === 189) cant = 3;
      else if (!esTermix && Math.round(precio) === 199) cant = 3;
      else if (!esTermix && Math.round(precio) === 189) cant = 2;
    }
    return {
      sku: li.sku || (esTermix ? "ALIV-TERMIX" : "ALIV-NAC600"),
      titulo,
      cantidad: cant,
      precioUnitario: cant > 0 ? Math.round((precio / cant) * 100) / 100 : precio,
    };
  });

  // Guardar producto_interes en customFields del contacto
  if (contactId && items.length > 0) {
    const resumenProd = items.map((i) => `${i.cantidad}x ${i.titulo}`).join(", ");
    const [cRow] = await db
      .select({ customFields: contacts.customFields })
      .from(contacts)
      .where(eq(contacts.id, contactId))
      .limit(1);
    if (cRow) {
      await db
        .update(contacts)
        .set({
          customFields: {
            ...((cRow.customFields as Record<string, unknown>) || {}),
            producto_interes: resumenProd,
          },
        })
        .where(eq(contacts.id, contactId));
    }
  }

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
    const primerProducto = items[0]?.titulo ?? "Pedido Aliv";
    const totalSoles = Number(payload.total_price) || 0;
    const dealId = await sincronizarEtapaPipeline(
      contactId,
      "por_confirmar_cod",
      `${numeroOrden} · ${primerProducto}`,
      totalSoles
    );

    const [pedidoNuevo] = await db.insert(pedidosOrdenes).values({
      numeroOrden,
      shopifyOrderId,
      contactId,
      dealId,
      estado: "por_confirmar_cod",
      modalidadPago: entregaWeb.modalidadPago,
      items,
      total: String(payload.total_price ?? "0.00"),
      moneda: payload.currency || "PEN",
      dniCliente: dni || payload.shipping_address?.company || null,
      ciudad,
      distrito,
      direccionEnvio: direccion || null,
      notas: `${
        payload.note ||
        `Pedido web ${numeroOrden} desde ${shopDomain} (Canal: ${payload.gateway || "EasySell COD Form"})`
      }
${entregaWeb.marca}`,
    }).returning({ id: pedidosOrdenes.id });

    // R1: Detección inteligente de duplicados
    // a) Ráfaga (< 3 minutos): doble clic o reenvío inmediato del formulario web
    const hace3Minutos = new Date(Date.now() - 3 * 60 * 1000);
    const [pedidoPrevioRafaga] = await db
      .select({ id: pedidosOrdenes.id, numeroOrden: pedidosOrdenes.numeroOrden, total: pedidosOrdenes.total })
      .from(pedidosOrdenes)
      .where(
        and(
          eq(pedidosOrdenes.contactId, contactId),
          gte(pedidosOrdenes.createdAt, hace3Minutos),
          ne(pedidosOrdenes.id, pedidoNuevo.id)
        )
      )
      .limit(1);

    // b) Pedido previo en las últimas 24h (para auditoría informativa al equipo sin silenciar al bot)
    const hace24Horas = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [pedidoPrevio24h] = await db
      .select({ id: pedidosOrdenes.id, numeroOrden: pedidosOrdenes.numeroOrden, total: pedidosOrdenes.total })
      .from(pedidosOrdenes)
      .where(
        and(
          eq(pedidosOrdenes.contactId, contactId),
          gte(pedidosOrdenes.createdAt, hace24Horas),
          ne(pedidosOrdenes.id, pedidoNuevo.id)
        )
      )
      .limit(1);

    if (pedidoPrevioRafaga) {
      // Reintento en ráfaga (menos de 3 minutos): no duplicar el envío de plantilla inmediata
      await db.insert(activities).values({
        type: "note",
        description: `⚠️ [REINTENTO EN RÁFAGA] Pedido ${numeroOrden} recibido a menos de 3 min de ${pedidoPrevioRafaga.numeroOrden}. Se omite duplicar el envío de plantilla automática en el mismo instante.`,
        contactId,
      });
    } else {
      // Si el cliente ya tenía un pedido reciente (> 3 min y < 24h), registramos nota e informamos sin silenciar al bot
      if (pedidoPrevio24h) {
        await db.insert(activities).values({
          type: "note",
          description: `ℹ️ [PEDIDO ADICIONAL O REINTENTO] El cliente registra pedido ${numeroOrden}. Pedido previo en 24h: ${pedidoPrevio24h.numeroOrden}. Se envía plantilla de confirmación automáticamente.`,
          contactId,
        });

        await alertarEquipo({
          contactId,
          titulo: `Pedido adicional / reintento: ${nombre}`,
          cuerpo: `Cliente con pedido ${numeroOrden} ya tenía ${pedidoPrevio24h.numeroOrden} en las últimas 24h. Se envió confirmación automática para no perder la venta.`,
        });
      }

      const esProv = entregaWeb.esAgencia;
      const totalNum = Number(payload.total_price) || 0;
      const saldoNum = Math.max(0, totalNum - 20);

      await emitAutomationEvent({
        trigger: "order.created",
        contactId,
        payload: {
          orderId: numeroOrden,
          numeroOrden,
          contactName: nombre,
          phone: telefono,
          total: totalNum.toFixed(2),
          totalSoles: totalNum,
          ciudad,
          distrito: distrito || "",
          direccion: direccion || "",
          productos: items.map((i) => `${i.cantidad}x ${i.titulo}`).join(", "),
          esProvincia: String(esProv),
          adelanto: "20.00",
          saldo: saldoNum.toFixed(2),
          modalidadPago: entregaWeb.modalidadPago,
          canal: "shopify",
          origen: "shopify",
        },
      }).catch((err) => console.error("[shopify-webhook] error disparando automatizaciones:", err));

      await notificarSupervisoresCritico({
        tipo: "pedido_shopify",
        titulo: `Pedido web ${numeroOrden}`,
        detalle: `${numeroOrden} por S/ ${totalNum.toFixed(2)} (${items.map((i) => `${i.cantidad}x ${i.titulo}`).join(", ")}) · ${distrito ? `${distrito}, ` : ""}${ciudad} · ${textoClasificacion(entregaWeb)}`,
        clienteNombre: nombre,
        clienteTelefono: telefono,
        contactId,
      }).catch((err) => console.warn("[shopify-webhook] aviso a supervisores falló:", err));
    }

    await db.insert(activities).values({
      type: "note",
      description: `Pedido web ${numeroOrden} recibido desde ${shopDomain} por S/ ${
        payload.total_price ?? "0.00"
      }`,
      contactId,
    });
    // Si venía de un formulario abandonado, cuenta como recuperado (métricas del rescate).
    await marcarAbandonoRecuperado(contactId, numeroOrden, Number(payload.total_price) || 0).catch((err) =>
      console.warn("[shopify-webhook] no se pudo marcar abandono recuperado:", err)
    );
    await sincronizarConGoogleDrive().catch(() => {});
  }

  return NextResponse.json({ ok: true, numeroOrden, yaRegistrado: Boolean(yaRegistrado) });
  });
}
