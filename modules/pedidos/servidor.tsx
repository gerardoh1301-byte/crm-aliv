import "server-only";
import { NextResponse } from "next/server";
import { and, desc, eq, ilike, or, sql, type SQL } from "drizzle-orm";
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
import { deliverMessage } from "@/lib/channels/deliver";
import { sincronizarConGoogleDrive } from "@/lib/drive-sync";
import type { ModuloServidor, HandlerModulo, ToolModulo } from "@/lib/modules/types";
import manifiesto from "./manifiesto";
import { pedidosOrdenes, type ItemPedido } from "./tabla";
import {
  ESTADOS_PEDIDO,
  ETIQUETA_ESTADO_PEDIDO,
  type EstadoPedido,
} from "./tipos";
import { PedidosPage } from "./componentes/PedidosPage";

const MAPA_ESTADO_A_ETAPA: Record<EstadoPedido, string> = {
  por_confirmar_cod: "por_confirmar_cod",
  confirmado: "pedido_confirmado",
  preparando: "pedido_confirmado",
  enviado: "en_reparto",
  entregado: "entregado",
  cancelado: "cancelado_rechazado",
};

async function generarNumeroOrden(): Promise<string> {
  const [row] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(pedidosOrdenes);
  const siguiente = 1001 + (Number(row?.total) || 0);
  const candidato = `#ALIV-${siguiente}`;
  const [existe] = await db
    .select({ id: pedidosOrdenes.id })
    .from(pedidosOrdenes)
    .where(eq(pedidosOrdenes.numeroOrden, candidato))
    .limit(1);
  if (!existe) return candidato;
  return `#ALIV-${siguiente}-${Math.floor(100 + Math.random() * 900)}`;
}

async function sincronizarEtapaPipeline(
  contactId: string,
  estado: EstadoPedido,
  tituloOrden: string,
  montoSoles: number
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

    const [abierta] = await db
      .select({ id: deals.id, stageId: deals.stageId })
      .from(deals)
      .where(eq(deals.contactId, contactId))
      .orderBy(desc(deals.updatedAt))
      .limit(1);

    if (abierta) {
      await db
        .update(deals)
        .set({
          value: Math.round(montoSoles),
          title: tituloOrden,
          updatedAt: new Date(),
        })
        .where(eq(deals.id, abierta.id));
      if (abierta.stageId !== stage.id) {
        await setDealStage({ dealId: abierta.id, stageId: stage.id });
      }
      return abierta.id;
    }

    const [nueva] = await db
      .insert(deals)
      .values({
        title: tituloOrden,
        value: Math.round(montoSoles),
        stageId: stage.id,
        contactId,
      })
      .returning({ id: deals.id });
    await setDealStage({ dealId: nueva.id, stageId: stage.id, justCreated: true });
    return nueva.id;
  } catch {
    return null;
  }
}

async function notificarDespachoPorChat(
  contactId: string,
  numeroOrden: string,
  transportadora: string | null,
  numeroGuia: string | null,
  claveRecojo: string | null,
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
    if (numeroGuia) partes.push(`• N° de Guía / Seguimiento: *${numeroGuia}*`);
    if (claveRecojo) partes.push(`• Clave de recojo en agencia: *${claveRecojo}*`);
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
    (acc, it) => acc + it.cantidad * it.precioUnitario,
    0
  );
  const estado = (
    typeof body.estado === "string" &&
    ESTADOS_PEDIDO.includes(body.estado as EstadoPedido)
      ? body.estado
      : "por_confirmar_cod"
  ) as EstadoPedido;

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

  await sincronizarConGoogleDrive().catch(() => {});
  return NextResponse.json(creado, { status: 201 });
};

async function pedidoAccesible(
  member: Parameters<HandlerModulo>[1]["member"],
  id: string
) {
  const [p] = await db
    .select({
      contactId: pedidosOrdenes.contactId,
      numeroOrden: pedidosOrdenes.numeroOrden,
      total: pedidosOrdenes.total,
      items: pedidosOrdenes.items,
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
  if (body.notas !== undefined) {
    updates.notas = body.notas ? String(body.notas) : null;
  }

  const [row] = await db
    .update(pedidosOrdenes)
    .set(updates)
    .where(eq(pedidosOrdenes.id, params.id))
    .returning();

  if (nuevoEstado) {
    const primerProducto = actual.items?.[0]?.titulo ?? "Pedido Aliv";
    await sincronizarEtapaPipeline(
      actual.contactId,
      nuevoEstado,
      `${actual.numeroOrden} · ${primerProducto}`,
      Number(actual.total) || 0
    );

    await db.insert(activities).values({
      type: "note",
      description: `Pedido ${actual.numeroOrden} actualizado a "${ETIQUETA_ESTADO_PEDIDO[nuevoEstado]}"${
        row.numeroGuia ? ` (Guía: ${row.numeroGuia})` : ""
      }`,
      contactId: actual.contactId,
    });

    if (nuevoEstado === "enviado" && body.notificarCliente === true) {
      await notificarDespachoPorChat(
        actual.contactId,
        row.numeroOrden,
        row.transportadora,
        row.numeroGuia,
        row.claveRecojo,
        row.total
      );
    }
  }

  await sincronizarConGoogleDrive().catch(() => {});
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
              description: "Numero de DNI del cliente (requerido para Shalom/Olva o boleta).",
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
              description: "Direccion exacta con referencia o sede de agencia Shalom / Olva Courier.",
            },
            modalidad_pago: {
              type: "string",
              enum: ["contraentrega", "yape", "plin", "adelanto_agencia"],
              description: "Metodo de pago acordado con el cliente.",
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

      const itemsFinales: ItemPedido[] = [];
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
        itemsFinales.push({
          sku: match.sku,
          titulo: match.titulo,
          cantidad: cant,
          precioUnitario: match.precio,
        });
      }

      if (itemsFinales.length === 0) {
        return { ok: false, error: "No se encontraron productos validos" };
      }

      const totalSoles = itemsFinales.reduce(
        (acc, it) => acc + it.cantidad * it.precioUnitario,
        0
      );
      const ciudad = String(args.ciudad ?? "Lima").trim();
      const distrito = args.distrito ? String(args.distrito).trim() : null;
      const direccionEnvio = String(args.direccion_envio ?? "").trim();
      const dniCliente = args.dni_cliente ? String(args.dni_cliente).trim() : null;
      const modalidadPago =
        typeof args.modalidad_pago === "string" ? args.modalidad_pago : "contraentrega";
      const notas = args.notas ? String(args.notas).trim() : null;

      const numeroOrden = await generarNumeroOrden();
      const dealId = await sincronizarEtapaPipeline(
        ctx.contactId,
        "confirmado",
        `${numeroOrden} · ${itemsFinales[0].titulo}`,
        totalSoles
      );

      const [orden] = await db
        .insert(pedidosOrdenes)
        .values({
          numeroOrden,
          contactId: ctx.contactId,
          dealId,
          estado: "confirmado",
          modalidadPago,
          items: itemsFinales,
          total: totalSoles.toFixed(2),
          moneda: "PEN",
          dniCliente,
          ciudad,
          distrito,
          direccionEnvio,
          notas,
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
        description: `[IA] Pedido COD ${numeroOrden} confirmado por S/ ${totalSoles.toFixed(
          2
        )} (${itemsFinales.map((i) => `${i.cantidad}x ${i.titulo}`).join(", ")}) — Destino: ${
          distrito ? `${distrito}, ` : ""
        }${ciudad}`,
        contactId: ctx.contactId,
      });

      await sincronizarConGoogleDrive().catch(() => {});

      return {
        ok: true,
        data: {
          pedido_id: orden.id,
          numero_orden: numeroOrden,
          estado: "Pedido Confirmado",
          items: itemsFinales,
          total_soles: `S/ ${totalSoles.toFixed(2)}`,
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
          "Consulta el estado actual, productos, monto en Soles, empresa de envio (Motorizado Lima, Shalom, Olva Courier), numero de guia y clave de recojo de los pedidos del cliente.",
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
      let rows;
      if (q) {
        const limpio = q.replace(/^#/, "");
        rows = await db
          .select()
          .from(pedidosOrdenes)
          .where(
            or(
              ilike(pedidosOrdenes.numeroOrden, `%${limpio}%`),
              eq(pedidosOrdenes.contactId, ctx.contactId)
            )
          )
          .orderBy(desc(pedidosOrdenes.createdAt))
          .limit(5);
      } else {
        rows = await db
          .select()
          .from(pedidosOrdenes)
          .where(eq(pedidosOrdenes.contactId, ctx.contactId))
          .orderBy(desc(pedidosOrdenes.createdAt))
          .limit(5);
      }

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
            clave_recojo: p.claveRecojo ?? null,
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
          precioUnitario: 99,
        },
      ],
      total: "99.00",
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
          precioUnitario: 99,
        },
      ],
      total: "99.00",
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
    "[id]": { PATCH: actualizar, DELETE: borrar },
  },
  tools,
  seed: sembrarPedidosDemo,
};

export default modulo;
