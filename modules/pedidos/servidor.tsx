import "server-only";
import { NextResponse } from "next/server";
import { and, desc, eq, gte, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import {
  activities,
  contacts,
  conversations,
  deals,
  pipelineStages,
  pipelines,
} from "@/db/schema";
import { canAccessContactId, ownerFilter } from "@/lib/team";
import { setDealStage } from "@/lib/deals/stage";
import { emitAutomationEvent } from "@/lib/automations";
import { deliverMessage } from "@/lib/channels/deliver";
import { sincronizarConGoogleDrive } from "@/lib/drive-sync";
import { extraerDatosFormularioShopify } from "@/lib/shopify/form-extractor";
import { sincronizarDealEnSheets } from "@/lib/sheets/envios-sync";
import { notificarCambioDealAlErp } from "@/lib/finanzas/notificar-erp";
import { generarNumeroChat } from "@/lib/pedidos/numeracion";
import { mostrarNumeroOrden } from "@/lib/pedidos/numero-formato";
import { esNumeroEntrenador, notificarSupervisoresCritico } from "@/lib/alerts/supervisor-alerts";
import type { ModuloServidor, HandlerModulo, ToolModulo } from "@/lib/modules/types";
import manifiesto from "./manifiesto";
import { pedidosOrdenes, type ItemPedido } from "./tabla";
import {
  ESTADOS_PEDIDO,
  ETIQUETA_ESTADO_PEDIDO,
  type EstadoPedido,
} from "./tipos";
import { PedidosPage } from "./componentes/PedidosPage";
import {
  validarDepartamentoODestino,
  validarTelefonoPeruano,
} from "@/lib/pedidos/validacion-datos";
import { crearOActualizarDealPostventa } from "@/lib/postventa/engine";
import { textoRastreoShalom } from "@/lib/agencias/shalom-rastreo";

const MAPA_ESTADO_A_ETAPA: Record<EstadoPedido, string> = {
  por_confirmar_cod: "agendar_entrega",
  confirmado: "agendar_entrega",
  preparando: "agendar_entrega",
  enviado: "en_reparto",
  entregado: "entregado",
  cancelado: "cancelado_rechazado",
};

// Los pedidos que nacen en el CRM (bot o asesor) usan la serie CHAT-0001: la serie "#1148"
// es de Shopify y compartirla hacía que un pedido web se diera por repetido.
async function generarNumeroOrden(): Promise<string> {
  return generarNumeroChat();
}

export async function sincronizarEtapaPipeline(
  contactId: string,
  estado: EstadoPedido,
  tituloOrden: string,
  montoSoles: number,
  pedidoId?: string,
  dealId?: string | null
): Promise<string | null> {
  try {
    const claveEtapa = MAPA_ESTADO_A_ETAPA[estado];
    if (!claveEtapa) return null;

    const [pipeline] = await db
      .select()
      .from(pipelines)
      .where(eq(pipelines.isDefault, true))
      .limit(1);
    if (!pipeline) return null;

    const stages = await db
      .select()
      .from(pipelineStages)
      .where(eq(pipelineStages.pipelineId, pipeline.id));

    const stage = stages.find((s) => s.key === claveEtapa) ?? stages[0];
    if (!stage) return null;

    let abierta: { id: string; stageId: string } | null = null;

    // 1. Si tenemos dealId explícito
    if (dealId) {
      const [porId] = await db
        .select({ id: deals.id, stageId: deals.stageId })
        .from(deals)
        .where(eq(deals.id, dealId))
        .limit(1);
      if (porId) abierta = porId;
    }

    // 2. Si no, buscar deal del contacto cuyo título empiece con el número de orden
    if (!abierta) {
      const prefijo = tituloOrden.split(" · ")[0]?.trim();
      if (prefijo) {
        const [porPrefijo] = await db
          .select({ id: deals.id, stageId: deals.stageId })
          .from(deals)
          .where(and(eq(deals.contactId, contactId), ilike(deals.title, `${prefijo}%`)))
          .limit(1);
        if (porPrefijo) abierta = porPrefijo;
      }
    }

    // 3. Fallback: última deal del contacto no asignada a otra orden
    if (!abierta) {
      const [porContacto] = await db
        .select({ id: deals.id, stageId: deals.stageId })
        .from(deals)
        .where(eq(deals.contactId, contactId))
        .orderBy(desc(deals.updatedAt))
        .limit(1);
      if (porContacto) {
        const [otra] = await db
          .select({ id: pedidosOrdenes.id })
          .from(pedidosOrdenes)
          .where(eq(pedidosOrdenes.dealId, porContacto.id))
          .limit(1);
        if (!otra || (pedidoId && otra.id === pedidoId)) {
          abierta = porContacto;
        }
      }
    }

    let finalDealId: string;

    if (abierta) {
      await db
        .update(deals)
        .set({
          value: Math.round(montoSoles * 100),
          title: tituloOrden,
          updatedAt: new Date(),
        })
        .where(eq(deals.id, abierta.id));
      if (abierta.stageId !== stage.id) {
        await setDealStage({ dealId: abierta.id, stageId: stage.id });
      }
      finalDealId = abierta.id;
    } else {
      const [nueva] = await db
        .insert(deals)
        .values({
          title: tituloOrden,
          value: Math.round(montoSoles * 100),
          stageId: stage.id,
          contactId,
        })
        .returning({ id: deals.id });
      await setDealStage({ dealId: nueva.id, stageId: stage.id, justCreated: true });
      finalDealId = nueva.id;
    }

    if (pedidoId && finalDealId) {
      await db
        .update(pedidosOrdenes)
        .set({ dealId: finalDealId })
        .where(eq(pedidosOrdenes.id, pedidoId));
    }

    return finalDealId;
  } catch (err) {
    console.error("[sincronizarEtapaPipeline] error:", err);
    return null;
  }
}

async function notificarDespachoPorChat(
  contactId: string,
  numeroOrden: string,
  transportadora: string | null,
  numeroGuia: string | null,
  codigoRastreo: string | null,
  total: string
) {
  try {
    const [conv] = await db
      .select({ id: conversations.id })
      .from(conversations)
      .where(eq(conversations.contactId, contactId))
      .orderBy(desc(conversations.lastMessageAt))
      .limit(1);

    if (!conv) return;

    const partes = [
      `¡Hola! Te escribimos de *Aliv Store* para avisarte que tu pedido *${numeroOrden}* ya fue despachado y está en camino.`,
    ];
    if (transportadora) partes.push(`• Empresa de envío: *${transportadora}*`);
    if (numeroGuia) partes.push(`• N° de Orden: *${numeroGuia}*`);
    if (codigoRastreo) partes.push(`• Código: *${codigoRastreo}*`);
    if (numeroGuia && codigoRastreo) {
      partes.push(`Con ambos datos puedes rastrear tu envío en https://shalom.com.pe/rastrea/`);
    }
    // La clave de recojo de 4 digitos NUNCA va aqui: se entrega al pagar el saldo.
    partes.push(`• Monto total: *S/ ${Number(total).toFixed(2)}*`);
    partes.push(`Cualquier consulta sobre tu entrega, escríbenos por aquí.`);

    await deliverMessage(
      conv.id,
      { text: partes.join("\n") },
      "human"
    );
  } catch {
    /* no bloquear actualizacion si el canal falla */
  }
}

async function pedidosVisibles(memberFilter: SQL | undefined, extra: SQL[] = []) {
  const conds = [...extra];
  if (memberFilter) conds.push(memberFilter);

  const query = db
    .select({
      id: pedidosOrdenes.id,
      numeroOrden: pedidosOrdenes.numeroOrden,
      shopifyOrderId: pedidosOrdenes.shopifyOrderId,
      contactId: pedidosOrdenes.contactId,
      dealId: pedidosOrdenes.dealId,
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
    .leftJoin(contacts, eq(pedidosOrdenes.contactId, contacts.id));

  return conds.length > 0
    ? query.where(and(...conds)).orderBy(desc(pedidosOrdenes.createdAt))
    : query.orderBy(desc(pedidosOrdenes.createdAt));
}

const listar: HandlerModulo = async (req, { member }) => {
  const { searchParams } = new URL(req.url);
  const estado = searchParams.get("estado");
  const contactId = searchParams.get("contactId");
  const extra: SQL[] = [];
  if (estado) extra.push(eq(pedidosOrdenes.estado, estado));
  if (contactId) extra.push(eq(pedidosOrdenes.contactId, contactId));
  return NextResponse.json(await pedidosVisibles(ownerFilter(member), extra));
};

const crear: HandlerModulo = async (req, { member }) => {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "JSON invalido" }, { status: 400 });

  const contactId = typeof body.contactId === "string" ? body.contactId : "";
  if (!contactId) return NextResponse.json({ error: "El cliente es obligatorio" }, { status: 400 });
  if (!(await canAccessContactId(member, contactId))) {
    return NextResponse.json({ error: "Contacto no encontrado" }, { status: 404 });
  }

  const rawItems = Array.isArray(body.items) ? body.items : [];
  const items: ItemPedido[] = rawItems.map((it: Record<string, unknown>) => ({
    sku: String(it.sku ?? "ALIV-PROD"),
    titulo: String(it.titulo ?? "Producto Aliv Store"),
    cantidad: Math.max(1, Number(it.cantidad) || 1),
    precioUnitario: Math.max(0, Number(it.precioUnitario) || 0),
  }));

  if (items.length === 0) {
    return NextResponse.json({ error: "Agrega al menos un producto al pedido" }, { status: 400 });
  }

  const totalCalculado = items.reduce(
    (acc, it) => acc + subtotalConOfertas(it.sku, it.cantidad, it.precioUnitario),
    0
  );
  const estado = (
    typeof body.estado === "string" &&
    ESTADOS_PEDIDO.includes(body.estado as EstadoPedido)
      ? body.estado
      : "por_confirmar_cod"
  ) as EstadoPedido;

  const [contactoCheck] = await db
    .select({ name: contacts.name, phone: contacts.phone })
    .from(contacts)
    .where(eq(contacts.id, contactId))
    .limit(1);

  // M2: Validar teléfono (9 dígitos que empiecen con 9) y departamento/destino antes de confirmar un pedido
  if (typeof body.ciudad === "string" && body.ciudad.trim()) {
    const valCiudad = validarDepartamentoODestino(body.ciudad);
    if (!valCiudad.valido) {
      return NextResponse.json({ error: valCiudad.error }, { status: 400 });
    }
  }
  if (estado === "confirmado" || estado === "enviado") {
    const valTel = validarTelefonoPeruano(contactoCheck?.phone);
    if (!valTel.valido) {
      return NextResponse.json({ error: valTel.error }, { status: 400 });
    }
    const valDep = validarDepartamentoODestino(
      typeof body.ciudad === "string" ? body.ciudad : ""
    );
    if (!valDep.valido) {
      return NextResponse.json({ error: valDep.error }, { status: 400 });
    }
  }

  const numeroOrden = await generarNumeroOrden();
  const dealId = await sincronizarEtapaPipeline(
    contactId,
    estado,
    `${numeroOrden} · ${items[0].titulo}`,
    totalCalculado
  );

  const [creado] = await db
    .insert(pedidosOrdenes)
    .values({
      numeroOrden,
      contactId,
      dealId,
      estado,
      modalidadPago: typeof body.modalidadPago === "string" ? body.modalidadPago : "contraentrega",
      items,
      total: totalCalculado.toFixed(2),
      moneda: "PEN",
      dniCliente: typeof body.dniCliente === "string" ? body.dniCliente : null,
      ciudad: typeof body.ciudad === "string" ? body.ciudad : null,
      distrito: typeof body.distrito === "string" ? body.distrito : null,
      direccionEnvio: typeof body.direccionEnvio === "string" ? body.direccionEnvio : null,
      notas: typeof body.notas === "string" ? body.notas : null,
    })
    .returning();

  const [contacto] = await db
    .select({ name: contacts.name, phone: contacts.phone })
    .from(contacts)
    .where(eq(contacts.id, contactId))
    .limit(1);

  // REGLA DE NEGOCIO: Los pedidos registrados manualmente desde el CRM corresponden
  // a ventas coordinadas directamente por el asesor humano (por WhatsApp, teléfono o mostrador).
  // NO deben disparar automatizaciones de mensajes para no duplicar ni solicitar adelantos
  // que ya fueron coordinados con el cliente.
  // Solo los pedidos web de Shopify/EasySell disparan la automatización inicial.

  await sincronizarConGoogleDrive().catch(() => {});
  return NextResponse.json(creado, { status: 201 });
};

async function pedidoAccesible(
  member: Parameters<HandlerModulo>[1]["member"],
  id: string
) {
  const [p] = await db
    .select({
      id: pedidosOrdenes.id,
      dealId: pedidosOrdenes.dealId,
      contactId: pedidosOrdenes.contactId,
      numeroOrden: pedidosOrdenes.numeroOrden,
      total: pedidosOrdenes.total,
      items: pedidosOrdenes.items,
      notas: pedidosOrdenes.notas,
    })
    .from(pedidosOrdenes)
    .where(eq(pedidosOrdenes.id, id))
    .limit(1);
  if (!p) return null;
  const ok = await canAccessContactId(member, p.contactId);
  return ok ? p : null;
}

const actualizar: HandlerModulo = async (req, { member, params }) => {
  const actual = await pedidoAccesible(member, params.id);
  if (!actual) return NextResponse.json({ error: "Pedido no encontrado" }, { status: 404 });

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "JSON invalido" }, { status: 400 });

  const updates: Partial<typeof pedidosOrdenes.$inferInsert> = { updatedAt: new Date() };
  let nuevoEstado: EstadoPedido | null = null;

  if (
    typeof body.estado === "string" &&
    ESTADOS_PEDIDO.includes(body.estado as EstadoPedido)
  ) {
    nuevoEstado = body.estado as EstadoPedido;
    updates.estado = nuevoEstado;
  }
  if (body.transportadora !== undefined) {
    updates.transportadora = body.transportadora ? String(body.transportadora) : null;
  }
  if (body.numeroGuia !== undefined) {
    updates.numeroGuia = body.numeroGuia ? String(body.numeroGuia) : null;
  }
  if (body.claveRecojo !== undefined) {
    updates.claveRecojo = body.claveRecojo ? String(body.claveRecojo) : null;
  }
  if (body.direccionEnvio !== undefined) {
    updates.direccionEnvio = body.direccionEnvio ? String(body.direccionEnvio) : null;
  }
  if (body.ciudad !== undefined) {
    if (body.ciudad && String(body.ciudad).trim()) {
      const checkDep = validarDepartamentoODestino(String(body.ciudad));
      if (!checkDep.valido) {
        return NextResponse.json({ error: checkDep.error }, { status: 400 });
      }
    }
    updates.ciudad = body.ciudad ? String(body.ciudad) : null;
  }

  // M2: Si se confirma el pedido, validar que el teléfono del cliente (9 dígitos empezando con 9) y el departamento sean válidos
  if (nuevoEstado === "confirmado" || nuevoEstado === "enviado") {
    const [contactoPedido] = await db
      .select({ phone: contacts.phone })
      .from(contacts)
      .where(eq(contacts.id, actual.contactId))
      .limit(1);
    const checkTel = validarTelefonoPeruano(contactoPedido?.phone);
    if (!checkTel.valido) {
      return NextResponse.json({ error: checkTel.error }, { status: 400 });
    }
    const ciudadFinal =
      updates.ciudad !== undefined
        ? updates.ciudad
        : (
            await db
              .select({ ciudad: pedidosOrdenes.ciudad })
              .from(pedidosOrdenes)
              .where(eq(pedidosOrdenes.id, actual.id))
              .limit(1)
          )[0]?.ciudad;
    const checkDep = validarDepartamentoODestino(ciudadFinal);
    if (!checkDep.valido) {
      return NextResponse.json({ error: checkDep.error }, { status: 400 });
    }
  }
  if (body.distrito !== undefined) {
    updates.distrito = body.distrito ? String(body.distrito) : null;
  }
  if (body.dniCliente !== undefined) {
    updates.dniCliente = body.dniCliente ? String(body.dniCliente) : null;
  }
  if (body.codigoRastreo !== undefined) {
    updates.codigoRastreo = body.codigoRastreo ? String(body.codigoRastreo) : null;
  }
  if (Array.isArray(body.items)) {
    updates.items = body.items as ItemPedido[];
  }
  if (body.total !== undefined && body.total !== null) {
    const totalNum = Number(body.total);
    if (!Number.isNaN(totalNum)) {
      updates.total = totalNum.toFixed(2);
    }
  }

  // Motivo o razón del cambio de pedido/producto/precio
  let notaAuditoriaCambio: string | null = null;
  if (typeof body.motivoCambio === "string" && body.motivoCambio.trim()) {
    const fechaHora = new Date().toLocaleString("es-PE", { timeZone: "America/Lima" });
    const autor = member.name || "Asesor";
    notaAuditoriaCambio = `[${fechaHora}] Modificación (${autor}): ${body.motivoCambio.trim()}`;
    const baseNotas = body.notas !== undefined ? String(body.notas ?? "") : (actual.notas ?? "");
    updates.notas = baseNotas ? `${baseNotas}\n${notaAuditoriaCambio}` : notaAuditoriaCambio;
  } else if (body.notas !== undefined) {
    updates.notas = body.notas ? String(body.notas) : null;
  }

  const [row] = await db
    .update(pedidosOrdenes)
    .set(updates)
    .where(eq(pedidosOrdenes.id, params.id))
    .returning();

  // Si se modificaron items o total, mantener sincronizado el Deal del Pipeline
  if ((updates.items || updates.total) && actual.dealId) {
    const itemsNuevos = (updates.items as ItemPedido[] | undefined) || (actual.items as ItemPedido[]) || [];
    const primerProducto = itemsNuevos[0]?.titulo || "Pedido Aliv";
    const totalNum = Number(row.total) || 0;
    await db
      .update(deals)
      .set({
        title: `${actual.numeroOrden} · ${primerProducto}`,
        value: Math.round(totalNum * 100),
        updatedAt: new Date(),
      })
      .where(eq(deals.id, actual.dealId));
  }

  // Registrar actividad si hubo modificación justificada
  if (notaAuditoriaCambio) {
    await db.insert(activities).values({
      type: "note",
      description: `Pedido ${actual.numeroOrden} modificado: ${body.motivoCambio}. Total: S/ ${row.total}`,
      contactId: actual.contactId,
      dealId: actual.dealId,
    });
  }

  if (nuevoEstado) {
    const primerProducto = actual.items?.[0]?.titulo ?? "Pedido Aliv";
    await sincronizarEtapaPipeline(
      actual.contactId,
      nuevoEstado,
      `${actual.numeroOrden} · ${primerProducto}`,
      Number(actual.total) || 0,
      actual.id,
      actual.dealId
    );

    await db.insert(activities).values({
      type: "note",
      description: `Pedido ${actual.numeroOrden} actualizado a "${ETIQUETA_ESTADO_PEDIDO[nuevoEstado]}"${
        row.numeroGuia ? ` (Guía: ${row.numeroGuia})` : ""
      }`,
      contactId: actual.contactId,
    });

    if (nuevoEstado === "entregado") {
      try {
        await crearOActualizarDealPostventa(
          actual.contactId,
          actual.numeroOrden,
          Number(actual.total) || 0
        );
      } catch (postventaErr) {
        console.warn("[pedidos] error al crear deal postventa:", postventaErr);
      }
    }

    if (nuevoEstado === "enviado" && body.notificarCliente === true) {
      await notificarDespachoPorChat(
        actual.contactId,
        row.numeroOrden,
        row.transportadora,
        row.numeroGuia,
        row.codigoRastreo,
        row.total
      );
    }
  }

  await sincronizarConGoogleDrive().catch(() => {});
  if (row.dealId) {
    sincronizarDealEnSheets(row.dealId).catch(() => {});
    notificarCambioDealAlErp(row.dealId).catch(() => {});
  }
  return NextResponse.json(row);
};

const borrar: HandlerModulo = async (_req, { member, params }) => {
  const actual = await pedidoAccesible(member, params.id);
  if (!actual) return NextResponse.json({ error: "Pedido no encontrado" }, { status: 404 });
  await db.delete(pedidosOrdenes).where(eq(pedidosOrdenes.id, params.id));
  await sincronizarConGoogleDrive().catch(() => {});
  return NextResponse.json({ ok: true });
};

// ============================================================
// Tools del Agente IA para Pedidos COD y Post-Venta
// ============================================================

async function buscarPrecioEnCatalogo(nombreOSku: string): Promise<{
  sku: string;
  titulo: string;
  precio: number;
} | null> {
  try {
    const pat = `%${nombreOSku.trim()}%`;
    const res = await db.execute(sql`
      select sku, titulo, precio
      from catalogo_productos
      where titulo ilike ${pat} or sku ilike ${pat} or handle ilike ${pat}
      limit 1
    `);
    const rows = res as unknown as Array<{ sku: string | null; titulo: string; precio: string }>;
    if (rows.length > 0) {
      return {
        sku: rows[0].sku ?? "ALIV-PROD",
        titulo: rows[0].titulo,
        precio: Number(rows[0].precio) || 99,
      };
    }
  } catch {
    /* fallback si la tabla catalogo_productos aun no tiene el registro */
  }
  return null;
}

/**
 * Precio por cantidad de las ofertas de la tienda (fuente: reglas-comerciales.md del
 * sistema integrado). Antes el chat cobraba precio unitario x cantidad: 2 frascos de
 * NAC600 salian S/238 en el chat y S/189 en la web.
 * Mas de 3 unidades se arma con paquetes de 3 + el resto.
 */
const PRECIOS_POR_CANTIDAD: Record<string, Record<number, number>> = {
  "ALIV-NAC600": { 1: 119, 2: 189, 3: 199 },
  "ALIV-TERMIX-TOB": { 1: 79, 2: 139, 3: 189 },
};

function subtotalConOfertas(sku: string, cantidad: number, precioUnitario: number): number {
  const tabla = PRECIOS_POR_CANTIDAD[sku];
  if (!tabla) return cantidad * precioUnitario;
  const paquetes = Math.floor(cantidad / 3);
  const resto = cantidad % 3;
  return paquetes * tabla[3] + (resto ? tabla[resto] : 0);
}

/** Ids de contacto del mismo cliente: el del chat y los que comparten su telefono
 * (un pedido web crea su propio contacto con el telefono del formulario). */
async function contactosDelCliente(contactId: string): Promise<string[]> {
  const [actual] = await db
    .select({ phone: contacts.phone })
    .from(contacts)
    .where(eq(contacts.id, contactId))
    .limit(1);
  const digitos = actual?.phone?.replace(/\D/g, "").slice(-9);
  if (!digitos || digitos.length < 9) return [contactId];
  const mismos = await db
    .select({ id: contacts.id })
    .from(contacts)
    .where(sql`right(regexp_replace(coalesce(${contacts.phone}, ''), '\\D', '', 'g'), 9) = ${digitos}`);
  return Array.from(new Set([contactId, ...mismos.map((c) => c.id)]));
}

/** "#1234", "1234", "CHAT-0012" o "#ALIV-1234" -> numeros de orden que terminan exactamente en 1234. */
function condicionNumeroOrden(texto: string): SQL | null {
  const digitos = texto.match(/\d{3,}/)?.[0];
  if (!digitos) return null;
  return or(
    eq(pedidosOrdenes.numeroOrden, `#${digitos}`),
    eq(pedidosOrdenes.numeroOrden, `#ALIV-${digitos}`),
    ilike(pedidosOrdenes.numeroOrden, `%-${digitos}`)
  ) ?? null;
}

const tools: ToolModulo[] = [
  {
    definicion: {
      type: "function",
      function: {
        name: "crear_pedido_chat",
        description:
          "Registra un pedido con Pago Contraentrega (COD) o Yape/Plin en Aliv Store directamente desde la conversacion cuando el cliente confirma que desea comprar y proporciona sus datos de envio (ciudad, distrito, direccion). Calcula el total real en Soles (PEN) desde el catalogo oficial y mueve el pipeline.",
        parameters: {
          type: "object",
          properties: {
            productos: {
              type: "array",
              description: "Lista de productos de Aliv Store que el cliente desea pedir.",
              items: {
                type: "object",
                properties: {
                  producto: {
                    type: "string",
                    description: "Nombre o SKU del producto (ej. 'NAC600', 'Termix Tobillera', 'Termix Hombrera', 'Nuvara', 'Herbia', 'Meno Mag', 'GODA').",
                  },
                  cantidad: {
                    type: "number",
                    description: "Cantidad de unidades (por defecto 1).",
                  },
                },
                required: ["producto"],
                additionalProperties: false,
              },
            },
            nombre_cliente: {
              type: "string",
              description: "Nombre completo del cliente que recibe el pedido.",
            },
            dni_cliente: {
              type: "string",
              description: "Numero de DNI del cliente (requerido para Shalom o boleta).",
            },
            ciudad: {
              type: "string",
              description: "Ciudad o departamento en Peru (ej. Lima, Arequipa, Trujillo, Cusco).",
            },
            distrito: {
              type: "string",
              description: "Distrito de entrega (ej. Miraflores, Surco, San Juan de Lurigancho).",
            },
            direccion_envio: {
              type: "string",
              description: "Direccion exacta con referencia o agencia Shalom (provincia).",
            },
            modalidad_pago: {
              type: "string",
              enum: ["contraentrega", "yape", "plin", "adelanto_agencia"],
              description:
                "Lima: 'contraentrega' (paga al recibir por transferencia, Yape o Plin). Provincia: 'adelanto_agencia' (S/20 por Yape y saldo en Shalom).",
            },
            notas: {
              type: "string",
              description: "Horario preferido o instrucciones adicionales de entrega.",
            },
          },
          required: ["productos", "ciudad", "direccion_envio"],
          additionalProperties: false,
        },
      },
    },
    descripcionUI: "Permite al agente tomar pedidos Contraentrega (COD) directamente en el chat y calcular el total en Soles.",
    async ejecutar(args, ctx) {
      const listaRaw = Array.isArray(args.productos) ? args.productos : [];
      if (listaRaw.length === 0) {
        return { ok: false, error: "Debes indicar al menos un producto para crear el pedido" };
      }

      // Lista blanca: los supervisores (951365418 y 945226853) prueban el bot; nunca se les
      // registra un pedido real, aunque el modelo ignore la instrucción del prompt.
      if (esNumeroEntrenador(ctx.contactPhone)) {
        return {
          ok: true,
          data: {
            simulado: true,
            message:
              "MODO SUPERVISOR: este número es de un supervisor en prueba. NO se registró ningún pedido. Dile que el pedido de prueba no se guarda y continúa la prueba.",
          },
        };
      }

      // Un solo pedido de chat abierto por cliente: el bot a veces volvia a llamar esta
      // herramienta en el turno siguiente y duplicaba el pedido (#ALIV-1038 y #ALIV-1039).
      const hace72h = new Date(Date.now() - 72 * 60 * 60 * 1000);
      const [yaAbierto] = await db
        .select({ numeroOrden: pedidosOrdenes.numeroOrden, total: pedidosOrdenes.total, estado: pedidosOrdenes.estado })
        .from(pedidosOrdenes)
        .where(
          and(
            eq(pedidosOrdenes.contactId, ctx.contactId),
            inArray(pedidosOrdenes.estado, ["por_confirmar_cod", "confirmado"]),
            gte(pedidosOrdenes.createdAt, hace72h)
          )
        )
        .orderBy(desc(pedidosOrdenes.createdAt))
        .limit(1);
      if (yaAbierto) {
        return {
          ok: true,
          data: {
            ya_existia: true,
            numeroOrden: yaAbierto.numeroOrden,
            total: yaAbierto.total,
            message: `El cliente ya tiene el pedido ${yaAbierto.numeroOrden} abierto (S/ ${yaAbierto.total}). No se creo otro. Si quiere cambiar cantidad o datos, usa avisar_asesor.`,
          },
        };
      }

      const itemsFinales: ItemPedido[] = [];
      const subtotales: number[] = [];
      for (const item of listaRaw as Array<{ producto?: string; cantidad?: number }>) {
        const nombreProd = String(item.producto ?? "").trim();
        if (!nombreProd) continue;
        const cant = Math.max(1, Number(item.cantidad) || 1);
        const match = await buscarPrecioEnCatalogo(nombreProd);
        if (!match) {
          return {
            ok: false,
            error: `El producto "${nombreProd}" no coincide con el catalogo de Aliv Store. Usa buscar_productos primero.`,
          };
        }
        const subtotal = subtotalConOfertas(match.sku, cant, match.precio);
        subtotales.push(subtotal);
        itemsFinales.push({
          sku: match.sku,
          titulo: match.titulo,
          cantidad: cant,
          precioUnitario: Math.round((subtotal / cant) * 100) / 100,
        });
      }

      if (itemsFinales.length === 0) {
        return { ok: false, error: "No se encontraron productos validos" };
      }

      let totalSoles = subtotales.reduce((acc, s) => acc + s, 0);
      const ciudad = String(args.ciudad ?? "Lima").trim();
      const distrito = args.distrito ? String(args.distrito).trim() : null;
      let direccionEnvio = String(args.direccion_envio ?? "").trim();
      const dniCliente = args.dni_cliente ? String(args.dni_cliente).trim() : null;
      let modalidadPago =
        typeof args.modalidad_pago === "string" ? args.modalidad_pago : "contraentrega";
      const notas = args.notas ? String(args.notas).trim() : null;

      // M2: Validar que el departamento/ciudad sea válido y que el teléfono sea un celular peruano (9 dígitos empezando con 9)
      const checkDepChat = validarDepartamentoODestino(ciudad);
      if (!checkDepChat.valido) {
        return {
          ok: false,
          error: checkDepChat.error,
        };
      }
      if (ctx.contactPhone) {
        const checkTelChat = validarTelefonoPeruano(ctx.contactPhone);
        if (!checkTelChat.valido) {
          return {
            ok: false,
            error:
              "El número de teléfono actual del contacto no es un celular peruano válido de 9 dígitos (puede ser un ID de Meta). Pídele al cliente su número de celular de 9 dígitos (empezando con 9) y actualízalo antes de confirmar el pedido.",
          };
        }
      }

      // Sin calle y numero (Lima) o sin agencia (provincia) el motorizado no puede entregar:
      // el bot debe pedir la direccion antes de registrar (paso en simulaciones: pedido con
      // direccion "San Juan de Lurigancho").
      if (!/\d/.test(direccionEnvio) && !/shalom|agencia/i.test(direccionEnvio)) {
        return {
          ok: false,
          error:
            "Falta la direccion exacta (calle y numero con referencia en Lima, o la agencia Shalom en provincia). Pidela al cliente y vuelve a registrar el pedido.",
        };
      }

      const numeroOrden = await generarNumeroOrden();
      // Cupón de recompra de S/ 15 (se otorga al enviar la clave de retiro, 30 días, un uso).
      const [fichaCupon] = await db
        .select({ cf: contacts.customFields })
        .from(contacts)
        .where(eq(contacts.id, ctx.contactId))
        .limit(1);
      const { cuponVigente, aplicarCupon, marcarUsado, CAMPO_CUPON } = await import("@/lib/pedidos/cupon-recompra");
      const cupon = cuponVigente(fichaCupon?.cf);
      const conCupon = aplicarCupon(totalSoles, cupon);
      const descuentoCupon = conCupon.descuento;
      if (descuentoCupon > 0) totalSoles = conCupon.total;
      const notasPedido =
        descuentoCupon > 0
          ? `${notas ? `${notas}\n` : ""}[CUPON_RECOMPRA] Descuento de S/ ${descuentoCupon.toFixed(2)} por recompra${cupon?.pedido_origen ? ` (cupón de ${cupon.pedido_origen})` : ""}.`
          : notas;
      // Provincia (adelanto por Yape): el pedido queda "por confirmar" hasta que una PERSONA
      // verifique el adelanto con el boton "Adelanto confirmado". El bot nunca da por
      // recibido un pago (antes lo marcaba confirmado por una imagen que no podia ver).
      // El destino manda, no el medio de pago: en Lima "pago por Yape" es al recibir
      // (contraentrega). Antes un pedido de Lima con modalidad "yape" caia en la cola de
      // "adelanto por verificar" como si fuera de provincia.
      const esProvinciaPorDestino = extraerDatosFormularioShopify({
        shipping_address: { city: distrito || ciudad, address1: direccionEnvio },
      }).esProvincia;
      if (!esProvinciaPorDestino && (modalidadPago === "yape" || modalidadPago === "plin")) {
        modalidadPago = "contraentrega";
      }
      const esProvinciaChat = esProvinciaPorDestino || modalidadPago === "adelanto_agencia";
      // Provincia: el envío va a una agencia Shalom concreta. Una dirección de calle no sirve
      // para emitir la guía; el bot debe confirmar la agencia antes de registrar.
      // Tiene que ser una sede del padrón OFICIAL de Shalom (no basta escribir "Agencia
      // Shalom ..."): #LEG-1066 se registró con una agencia que no existe y la guía salió a
      // otra sede. Se guarda con el nombre y la dirección oficiales.
      if (esProvinciaChat) {
        const { resolverAgenciaOficial, textoAgenciaOficial } = await import("@/lib/agencias/shalom-directorio");
        const r = resolverAgenciaOficial({ texto: [direccionEnvio, distrito].filter(Boolean).join(" "), ciudad });
        if (!r.agencia) {
          const opciones = r.opciones
            .slice(0, 5)
            .map((a) => `${a.nombre} (${a.direccion.trim()}${a.referencia ? ` - ref: ${a.referencia.replace(/^[\s:]+/, "")}` : ""})`);
          return {
            ok: false,
            error:
              "Pedido de provincia sin una agencia Shalom del padrón oficial. NO lo registres todavía ni digas que quedó registrado. " +
              "Pregúntale al cliente a qué sede oficial se envía" +
              (opciones.length ? `: ${opciones.join("; ")}` : " (pídele ciudad y dirección o referencia de la agencia)") +
              ". Cuando confirme, vuelve a registrar con direccion_envio = el nombre y la dirección de esa sede.",
          };
        }
        direccionEnvio = textoAgenciaOficial(r.agencia);
      }
      const estadoInicial = esProvinciaChat ? "por_confirmar_cod" : "confirmado";
      const dealId = await sincronizarEtapaPipeline(
        ctx.contactId,
        estadoInicial,
        `${numeroOrden} · ${itemsFinales[0].titulo}`,
        totalSoles
      );

      const [orden] = await db
        .insert(pedidosOrdenes)
        .values({
          numeroOrden,
          contactId: ctx.contactId,
          dealId,
          estado: estadoInicial,
          modalidadPago,
          items: itemsFinales,
          total: totalSoles.toFixed(2),
          moneda: "PEN",
          dniCliente,
          ciudad,
          distrito,
          direccionEnvio,
          notas: notasPedido,
        })
        .returning();

      // Actualizar ficha del contacto con sus datos de envio
      const [contactoActual] = await db
        .select()
        .from(contacts)
        .where(eq(contacts.id, ctx.contactId))
        .limit(1);

      if (contactoActual) {
        const cfActual =
          (contactoActual.customFields as Record<string, unknown> | null) ?? {};
        const nuevoCf: Record<string, unknown> = {
          ...cfActual,
          producto_interes: itemsFinales.map((i) => i.titulo).join(", "),
          departamento_ciudad: ciudad,
          ...(distrito ? { distrito } : {}),
          direccion_envio: direccionEnvio,
          ...(dniCliente ? { dni_ruc: dniCliente } : {}),
          ...(descuentoCupon > 0 && cupon ? { [CAMPO_CUPON]: marcarUsado(cupon, numeroOrden) } : {}),
        };
        await db
          .update(contacts)
          .set({
            ...(typeof args.nombre_cliente === "string" && args.nombre_cliente.trim()
              ? { name: args.nombre_cliente.trim().slice(0, 120) }
              : {}),
            customFields: nuevoCf,
            updatedAt: new Date(),
          })
          .where(eq(contacts.id, ctx.contactId));
      }

      await db.insert(activities).values({
        type: "note",
        description: `[IA] Pedido ${numeroOrden} ${esProvinciaChat ? "registrado (adelanto de S/20 pendiente de verificar por una persona)" : "confirmado"} por S/ ${totalSoles.toFixed(
          2
        )} (${itemsFinales.map((i) => `${i.cantidad}x ${i.titulo}`).join(", ")}) — Destino: ${
          distrito ? `${distrito}, ` : ""
        }${ciudad}`,
        contactId: ctx.contactId,
      });

      await sincronizarConGoogleDrive().catch(() => {});

      await notificarSupervisoresCritico({
        tipo: "pedido_chat",
        titulo: `Pedido ${numeroOrden}`,
        detalle: `El bot registró ${mostrarNumeroOrden(numeroOrden)} por S/ ${totalSoles.toFixed(2)} (${itemsFinales
          .map((i) => `${i.cantidad}x ${i.titulo}`)
          .join(", ")}) · ${distrito ? `${distrito}, ` : ""}${ciudad}${esProvinciaChat ? " · adelanto S/20 por verificar" : ""}`,
        clienteNombre: typeof args.nombre_cliente === "string" && args.nombre_cliente.trim() ? args.nombre_cliente.trim() : contactoActual?.name,
        clienteTelefono: ctx.contactPhone,
        contactId: ctx.contactId,
        conversationId: ctx.conversationId,
      }).catch((err) => console.warn("[pedidos] aviso a supervisores falló:", err));

      return {
        ok: true,
        data: {
          pedido_id: orden.id,
          numero_orden: numeroOrden,
          estado: "Pedido Confirmado",
          items: itemsFinales,
          total_soles: `S/ ${totalSoles.toFixed(2)}`,
          ...(descuentoCupon > 0
            ? { cupon_aplicado: `Descuento de recompra de S/ ${descuentoCupon.toFixed(2)} ya incluido en el total` }
            : {}),
          modalidad_pago: modalidadPago,
          destino: `${direccionEnvio}${distrito ? ` (${distrito} - ${ciudad})` : ` (${ciudad})`}`,
        },
      };
    },
  },
  {
    definicion: {
      type: "function",
      function: {
        name: "consultar_pedido",
        description:
          "Consulta el estado actual, productos, monto en Soles, empresa de envio (Motorizado Lima o Shalom), numero de orden Shalom y codigo de seguimiento de los pedidos del cliente. Para rastrear en Shalom el cliente necesita AMBOS: el N° de orden y el codigo alfanumerico (ej. 104493000 + 3KJP). Nunca des solo el numero.",
        parameters: {
          type: "object",
          properties: {
            numero_orden: {
              type: "string",
              description:
                "Numero de orden si el cliente lo menciona (ej. '#ALIV-1001' o '1001'). Si no lo menciona, dejar vacio para buscar todos los pedidos de este contacto.",
            },
          },
          additionalProperties: false,
        },
      },
    },
    descripcionUI: "Permite al agente consultar en tiempo real el estado de envío y número de guía de un pedido.",
    async ejecutar(args, ctx) {
      const q = typeof args.numero_orden === "string" ? args.numero_orden.trim() : "";
      // Solo pedidos del propio cliente. Antes, con un numero, el filtro era
      // `numero ilike %q% OR contacto = este`: pedir el "1" devolvia pedidos (con
      // direccion) de otros clientes.
      const propios = await contactosDelCliente(ctx.contactId);
      const condiciones: SQL[] = [inArray(pedidosOrdenes.contactId, propios)];
      const filtroNumero = condicionNumeroOrden(q);
      if (filtroNumero) condiciones.push(filtroNumero);
      const rows = await db
        .select()
        .from(pedidosOrdenes)
        .where(and(...condiciones))
        .orderBy(desc(pedidosOrdenes.createdAt))
        .limit(5);

      if (rows.length === 0) {
        return {
          ok: true,
          data: {
            encontrados: 0,
            mensaje:
              "No hay pedidos registrados todavia con este numero o telefono. Puedes pedirle su numero de orden (#ALIV-...) o tomarle un nuevo pedido.",
          },
        };
      }

      return {
        ok: true,
        data: {
          encontrados: rows.length,
          pedidos: rows.map((p) => ({
            numero_orden: p.numeroOrden,
            estado: ETIQUETA_ESTADO_PEDIDO[p.estado as EstadoPedido] ?? p.estado,
            productos: p.items,
            total_soles: `S/ ${Number(p.total).toFixed(2)}`,
            modalidad_pago: p.modalidadPago,
            destino: [p.direccionEnvio, p.distrito, p.ciudad].filter(Boolean).join(", "),
            empresa_envio: p.transportadora ?? "Pendiente de asignación de reparto",
            numero_guia: p.numeroGuia ?? "Aún en preparación en almacén",
            codigo_seguimiento: p.codigoRastreo ?? null,
            como_rastrear: textoRastreoShalom(p.numeroGuia, p.codigoRastreo),
            // C2: Jamás exponer claveRecojo al modelo IA; la clave solo la entrega un humano
            fecha_registro: p.createdAt,
          })),
        },
      };
    },
  },
  {
    definicion: {
      type: "function",
      function: {
        name: "solicitar_soporte_pedido",
        description:
          "Registra una solicitud de garantia, reclamo, demora en entrega o modificacion de un pedido ya despachado y deriva la conversacion a una persona del equipo de Aliv Store.",
        parameters: {
          type: "object",
          properties: {
            numero_orden: {
              type: "string",
              description: "Numero de orden involucrado si se conoce.",
            },
            motivo: {
              type: "string",
              description: "Resumen claro del inconveniente o solicitud post-venta.",
            },
          },
          required: ["motivo"],
          additionalProperties: false,
        },
      },
    },
    descripcionUI: "Registra incidencias post-venta o garantías sobre un pedido y alerta a un asesor humano.",
    async ejecutar(args, ctx) {
      const motivo = String(args.motivo ?? "Soporte post-venta").trim();
      const ordenRef = args.numero_orden ? ` (${String(args.numero_orden).trim()})` : "";

      await db.insert(activities).values({
        type: "follow_up",
        description: `[ALERTA POST-VENTA${ordenRef}] ${motivo}`,
        contactId: ctx.contactId,
        scheduledAt: new Date(),
      });

      return {
        ok: true,
        data: {
          registrado: true,
          mensaje: "Incidencia registrada para atención prioritaria del equipo humano.",
        },
      };
    },
  },
  {
    definicion: {
      type: "function",
      function: {
        name: "confirmar_pedido",
        description:
          "Confirma un pedido web (alivstore.shop) que esta 'Por confirmar' cuando el propio cliente escribe para confirmarlo, por ejemplo con el boton 'Confirmar por WhatsApp' de la pagina de gracias ('Hola Aliv, quiero confirmar mi pedido'). Solo encuentra pedidos de este mismo cliente (mismo telefono). Sin numero, toma su pedido pendiente mas reciente de los ultimos 7 dias. Devuelve productos, total y direccion para repetirselos.",
        parameters: {
          type: "object",
          properties: {
            numero_orden: {
              type: "string",
              description: "Numero del pedido si el cliente lo menciona (ej. '#1234', '1234' o '#ALIV-1234'). Dejar vacio si no lo dice.",
            },
          },
          additionalProperties: false,
        },
      },
    },
    descripcionUI: "Permite al agente confirmar pedidos web pendientes cuando el cliente escribe para confirmarlos (ventana gratuita de 24 h).",
    async ejecutar(args, ctx) {
      // Sin numero (el boton de la pagina de gracias puede no traerlo): el pendiente mas
      // reciente del mismo telefono en 7 dias.
      const filtro =
        condicionNumeroOrden(String(args.numero_orden ?? "")) ??
        and(
          eq(pedidosOrdenes.estado, "por_confirmar_cod"),
          sql`${pedidosOrdenes.createdAt} > now() - interval '7 days'`
        );
      const propios = await contactosDelCliente(ctx.contactId);
      const [pedido] = await db
        .select()
        .from(pedidosOrdenes)
        .where(and(inArray(pedidosOrdenes.contactId, propios), filtro))
        .orderBy(desc(pedidosOrdenes.createdAt))
        .limit(1);

      if (!pedido) {
        return {
          ok: true,
          data: {
            encontrado: false,
            mensaje:
              "No hay un pedido con ese numero asociado a este telefono. Pidele que revise el numero o el telefono con el que compro, o deriva a un asesor.",
          },
        };
      }

      const detalle = {
        numero_orden: pedido.numeroOrden,
        productos: pedido.items,
        total_soles: `S/ ${Number(pedido.total).toFixed(2)}`,
        destino: [pedido.direccionEnvio, pedido.distrito, pedido.ciudad].filter(Boolean).join(", "),
      };

      if (pedido.estado !== "por_confirmar_cod") {
        return {
          ok: true,
          data: {
            encontrado: true,
            ya_estaba: ETIQUETA_ESTADO_PEDIDO[pedido.estado as EstadoPedido] ?? pedido.estado,
            ...detalle,
          },
        };
      }

      await db
        .update(pedidosOrdenes)
        .set({ estado: "confirmado", updatedAt: new Date() })
        .where(eq(pedidosOrdenes.id, pedido.id));
      await sincronizarEtapaPipeline(
        pedido.contactId,
        "confirmado",
        `${pedido.numeroOrden} · ${pedido.items[0]?.titulo ?? "Pedido web"}`,
        Number(pedido.total)
      );
      await db.insert(activities).values({
        type: "note",
        description: `[IA] Pedido web ${pedido.numeroOrden} confirmado por el cliente desde el chat`,
        contactId: pedido.contactId,
      });
      await sincronizarConGoogleDrive().catch(() => {});

      return { ok: true, data: { encontrado: true, confirmado: true, ...detalle } };
    },
  },
];

// ============================================================
// Datos semilla de Pedidos COD en Peru (Lima y Provincias)
// ============================================================

async function sembrarPedidosDemo() {
  const [existente] = await db
    .select({ id: pedidosOrdenes.id })
    .from(pedidosOrdenes)
    .limit(1);
  if (existente) return;

  const clientes = await db
    .select({ id: contacts.id, name: contacts.name })
    .from(contacts)
    .orderBy(contacts.createdAt)
    .limit(6);

  if (clientes.length === 0) return;

  const ejemplos: Array<{
    numeroOrden: string;
    estado: EstadoPedido;
    modalidadPago: string;
    items: ItemPedido[];
    total: string;
    dniCliente: string;
    ciudad: string;
    distrito: string;
    direccionEnvio: string;
    transportadora: string | null;
    numeroGuia: string | null;
    claveRecojo: string | null;
    notas: string;
  }> = [
    {
      numeroOrden: "#ALIV-1001",
      estado: "entregado",
      modalidadPago: "contraentrega",
      items: [
        {
          sku: "ALIV-NUVARA-CERV",
          titulo: "Nuvara – Almohada de Masaje Cervical con Calor, Vibración y Tracción",
          cantidad: 1,
          precioUnitario: 149,
        },
      ],
      total: "149.00",
      dniCliente: "45892103",
      ciudad: "Lima",
      distrito: "Miraflores",
      direccionEnvio: "Av. José Pardo 620 Dpto 502 (Frente a Vivanda)",
      transportadora: "Motorizado Aliv (Lima)",
      numeroGuia: "LIMA-MOTO-042",
      claveRecojo: null,
      notas: "Cobrado por Yape al motorizado al entregar en recepción.",
    },
    {
      numeroOrden: "#ALIV-1002",
      estado: "enviado",
      modalidadPago: "adelanto_agencia",
      items: [
        {
          sku: "ALIV-NAC600",
          titulo: "NAC600 + NAD+ (60 cápsulas)",
          cantidad: 1,
          precioUnitario: 119,
        },
        {
          sku: "ALIV-HERBIA-ROLL",
          titulo: "Herbia – Roll-On de Aceites Esenciales para el Alivio de la Migraña",
          cantidad: 1,
          precioUnitario: 30,
        },
      ],
      total: "149.00",
      dniCliente: "71204982",
      ciudad: "Arequipa",
      distrito: "Yanahuara",
      direccionEnvio: "Agencia Shalom — Av. Parra 314, Arequipa",
      transportadora: "Shalom Empresarial",
      numeroGuia: "SH-9048127",
      claveRecojo: "8421",
      notas: "Envío a agencia Shalom Arequipa. Cliente recoge con DNI y clave.",
    },
    {
      numeroOrden: "#ALIV-1003",
      estado: "confirmado",
      modalidadPago: "contraentrega",
      items: [
        {
          sku: "ALIV-TERMIX-TOB",
          titulo: "Termix Tobillera – Calor y Masaje Inalámbrico",
          cantidad: 1,
          precioUnitario: 79,
        },
      ],
      total: "79.00",
      dniCliente: "48192034",
      ciudad: "Lima",
      distrito: "Santiago de Surco",
      direccionEnvio: "Jr. Monte Rosa 240 Urb. Chacarilla",
      transportadora: "Motorizado Aliv (Lima)",
      numeroGuia: null,
      claveRecojo: null,
      notas: "Programado para ruta de la tarde (2pm a 6pm). Paga en efectivo.",
    },
    {
      numeroOrden: "#ALIV-1004",
      estado: "por_confirmar_cod",
      modalidadPago: "contraentrega",
      items: [
        {
          sku: "ALIV-TERMIX-HOMB",
          titulo: "Termix – Hombrera Térmica con Calor, Vibración y Luz Roja",
          cantidad: 1,
          precioUnitario: 79,
        },
      ],
      total: "79.00",
      dniCliente: "73910284",
      ciudad: "Trujillo",
      distrito: "Víctor Larco",
      direccionEnvio: "Agencia Olva Courier — Av. Larco 820",
      transportadora: null,
      numeroGuia: null,
      claveRecojo: null,
      notas: "Pedido ingresado desde alivstore.shop. Pendiente confirmar agencia exacta.",
    },
    {
      numeroOrden: "#ALIV-1005",
      estado: "enviado",
      modalidadPago: "contraentrega",
      items: [
        {
          sku: "ALIV-MENOMAG",
          titulo: "Meno Mag – Apoyo Integral Perimenopausia y Posmenopausia",
          cantidad: 2,
          precioUnitario: 99,
        },
      ],
      total: "198.00",
      dniCliente: "41029384",
      ciudad: "Lima",
      distrito: "San Borja",
      direccionEnvio: "Av. Aviación 2840 Dpto 201",
      transportadora: "Motorizado Aliv (Lima)",
      numeroGuia: "LIMA-MOTO-051",
      claveRecojo: null,
      notas: "Promoción 2 frascos Meno Mag. Motorizado en ruta.",
    },
  ];

  for (let i = 0; i < ejemplos.length; i++) {
    const ej = ejemplos[i];
    const cliente = clientes[i % clientes.length];
    const dealId = await sincronizarEtapaPipeline(
      cliente.id,
      ej.estado,
      `${ej.numeroOrden} · ${ej.items[0].titulo}`,
      Number(ej.total)
    );
    await db.insert(pedidosOrdenes).values({
      numeroOrden: ej.numeroOrden,
      contactId: cliente.id,
      dealId,
      estado: ej.estado,
      modalidadPago: ej.modalidadPago,
      items: ej.items,
      total: ej.total,
      moneda: "PEN",
      dniCliente: ej.dniCliente,
      ciudad: ej.ciudad,
      distrito: ej.distrito,
      direccionEnvio: ej.direccionEnvio,
      transportadora: ej.transportadora,
      numeroGuia: ej.numeroGuia,
      claveRecojo: ej.claveRecojo,
      notas: ej.notas,
    });
  }
}

const modulo: ModuloServidor = {
  manifiesto,
  paginas: {
    "": () => <PedidosPage />,
  },
  api: {
    "": { GET: listar, POST: crear },
    "[id]": { PUT: actualizar, PATCH: actualizar, DELETE: borrar },
  },
  tools,
  seed: sembrarPedidosDemo,
};

export default modulo;
