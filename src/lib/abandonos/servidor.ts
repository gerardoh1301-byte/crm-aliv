import "server-only";
import { db } from "@/db";
import {
  activities,
  channelAccounts,
  contacts,
  conversations,
  deals,
  messages,
  pipelineStages,
  pipelines,
} from "@/db/schema";
import { and, desc, eq, gte, like, or, sql } from "drizzle-orm";
import { resolveConversationId } from "@/lib/conversations";
import { deliverMessage } from "@/lib/channels/deliver";
import { setDealStage } from "@/lib/deals/stage";
import { resolveDefaultTenantId } from "@/lib/tenants";
import { pedidosOrdenes } from "../../../modules/pedidos/tabla";
import {
  TAG_ABANDONO,
  TAG_CERRADO,
  TAG_PASO1,
  TAG_PASO2,
  TAG_RECUPERADO,
  TAG_RESPONDIO,
  TAGS_FINALES,
  armarMensaje,
  decidirAccion,
  describirPack,
  detectarProducto,
  normalizarCelularPe,
  type ProductoAbandono,
} from "./reglas";

/** Prefijo de las actividades: las métricas y el barrido se apoyan en él. */
export const PREFIJO = "[ABANDONO]";
const ETAPA_ABANDONO = "formulario_abandonado";
/** Etapas tempranas (sin pedido) que un abandono puede ocupar. */
const ETAPAS_TEMPRANAS = ["consulta_catalogo", "carrito_armado", ETAPA_ABANDONO];
/** Un cliente con pedido en estos días no es un abandono: ya compró. */
const DIAS_PEDIDO_RECIENTE = 3;
/** Tras un abandono terminado, uno nuevo solo reinicia la secuencia pasado este tiempo. */
const HORAS_REINICIO = 72;

export interface DatosAbandono {
  telefono: unknown;
  nombre?: unknown;
  ciudad?: unknown;
  direccion?: unknown;
  producto?: unknown;
  total?: unknown;
  url?: unknown;
}

export interface AbandonoGuardado {
  capturadoEn: string;
  producto: ProductoAbandono;
  total: number;
  pack: string;
  ciudad: string | null;
  direccion: string | null;
  url: string | null;
}

const texto = (v: unknown, max = 160): string | null => {
  if (typeof v !== "string" && typeof v !== "number") return null;
  const s = String(v).replace(/[<>]/g, "").replace(/\s+/g, " ").trim();
  return s ? s.slice(0, max) : null;
};

const horaLima = (d: Date): number =>
  Number(
    new Intl.DateTimeFormat("en-US", { timeZone: "America/Lima", hour: "numeric", hour12: false }).format(d)
  ) % 24;

async function etapaPorClave(clave: string): Promise<string | null> {
  const [row] = await db
    .select({ id: pipelineStages.id })
    .from(pipelineStages)
    .innerJoin(pipelines, eq(pipelines.id, pipelineStages.pipelineId))
    .where(and(eq(pipelines.isDefault, true), eq(pipelineStages.key, clave)))
    .limit(1);
  return row?.id ?? null;
}

async function anotar(contactId: string, descripcion: string, dealId?: string | null) {
  await db.insert(activities).values({
    type: "note",
    description: `${PREFIJO} ${descripcion}`,
    contactId,
    dealId: dealId ?? null,
  });
}

async function ponerEtiquetas(contactId: string, agregar: string[], quitar: string[] = []) {
  const [c] = await db.select({ tags: contacts.tags }).from(contacts).where(eq(contacts.id, contactId)).limit(1);
  if (!c) return;
  const fuera = new Set(quitar.map((t) => t.toLowerCase()));
  const tags = (c.tags ?? []).filter((t) => !fuera.has(t.toLowerCase()));
  for (const t of agregar) if (!tags.some((x) => x.toLowerCase() === t.toLowerCase())) tags.push(t);
  await db.update(contacts).set({ tags, updatedAt: new Date() }).where(eq(contacts.id, contactId));
}

/**
 * Registra (o actualiza) un formulario abandonado que llega desde la landing.
 * Idempotente: la landing puede mandar varias veces el mismo celular mientras el
 * cliente escribe; solo la primera crea actividad y tarjeta.
 */
export async function registrarAbandono(
  datos: DatosAbandono,
  ahora: Date = new Date()
): Promise<{ ok: boolean; estado: string; contactId?: string }> {
  const telefono = normalizarCelularPe(datos.telefono);
  if (!telefono) return { ok: false, estado: "telefono_invalido" };

  const productoTxt = texto(datos.producto, 120);
  const producto = detectarProducto(productoTxt);
  const totalNum = Number(String(datos.total ?? "").replace(/[^\d.]/g, ""));
  const total = Number.isFinite(totalNum) && totalNum > 0 && totalNum < 2000 ? totalNum : 0;
  const nombre = texto(datos.nombre, 80);
  const ciudad = texto(datos.ciudad, 80);
  const direccion = texto(datos.direccion, 160);
  const url = texto(datos.url, 300);
  const pack = describirPack(producto, total);

  const [existente] = await db
    .select({ id: contacts.id, name: contacts.name, tags: contacts.tags, customFields: contacts.customFields })
    .from(contacts)
    .where(eq(contacts.phone, telefono))
    .limit(1);

  if (existente) {
    // Ya compró hace poco: no es un abandono (suele ser alguien mirando su propio pedido).
    const [pedido] = await db
      .select({ id: pedidosOrdenes.id })
      .from(pedidosOrdenes)
      .where(
        and(
          eq(pedidosOrdenes.contactId, existente.id),
          gte(pedidosOrdenes.createdAt, new Date(ahora.getTime() - DIAS_PEDIDO_RECIENTE * 86_400_000))
        )
      )
      .limit(1);
    if (pedido) return { ok: true, estado: "ya_tiene_pedido", contactId: existente.id };
  }

  const cf = ((existente?.customFields as Record<string, unknown> | null) ?? {}) as Record<string, unknown>;
  const previo = (cf.abandono ?? null) as AbandonoGuardado | null;
  const tags = (existente?.tags ?? []).map((t) => t.toLowerCase());
  const activo = tags.includes(TAG_ABANDONO) && !TAGS_FINALES.some((t) => tags.includes(t));
  const terminadoReciente =
    tags.includes(TAG_ABANDONO) &&
    !activo &&
    previo?.capturadoEn &&
    ahora.getTime() - new Date(previo.capturadoEn).getTime() < HORAS_REINICIO * 3_600_000;

  if (terminadoReciente) return { ok: true, estado: "reciente_terminado", contactId: existente!.id };

  const guardado: AbandonoGuardado = {
    // Un abandono activo conserva su hora de captura: si no, cada tecla lo reiniciaría.
    capturadoEn: activo && previo?.capturadoEn ? previo.capturadoEn : ahora.toISOString(),
    producto,
    total: total || previo?.total || 0,
    pack: total ? pack : previo?.pack || pack,
    ciudad: ciudad ?? previo?.ciudad ?? null,
    direccion: direccion ?? previo?.direccion ?? null,
    url: url ?? previo?.url ?? null,
  };

  const camposBase = {
    ...cf,
    ...(guardado.ciudad && !cf.departamento_ciudad ? { departamento_ciudad: guardado.ciudad } : {}),
    ...(guardado.direccion && !cf.direccion_envio ? { direccion_envio: guardado.direccion } : {}),
    producto_interes: cf.producto_interes || guardado.pack,
    abandono: guardado,
  };

  let contactId: string;
  if (existente) {
    contactId = existente.id;
    const nuevoNombre = /^(whatsapp|web)\s/i.test(existente.name) && nombre ? nombre : existente.name;
    await db
      .update(contacts)
      .set({ customFields: camposBase, name: nuevoNombre, updatedAt: new Date() })
      .where(eq(contacts.id, contactId));
    // Reinicio: secuencia nueva, sin restos de la anterior.
    await ponerEtiquetas(contactId, [TAG_ABANDONO], activo ? [] : [TAG_PASO1, TAG_PASO2, ...TAGS_FINALES]);
  } else {
    const [creado] = await db
      .insert(contacts)
      .values({
        name: nombre || `Web ${telefono.slice(-4)}`,
        phone: telefono,
        source: "website",
        score: 60,
        tags: [TAG_ABANDONO, "alivstore", producto === "termix" ? "interes:termix" : "interes:nac600"],
        customFields: camposBase,
        tenantId: await resolveDefaultTenantId(),
      })
      .returning({ id: contacts.id });
    contactId = creado.id;
  }

  if (activo) return { ok: true, estado: "actualizado", contactId };

  const dealId = await ubicarTarjeta(contactId, guardado);
  await anotar(
    contactId,
    `Capturado: ${guardado.pack}${guardado.total ? ` por S/ ${guardado.total.toFixed(2)}` : ""}${guardado.ciudad ? ` (${guardado.ciudad})` : ""}. Dejó el formulario web sin enviar.`,
    dealId
  );
  return { ok: true, estado: "registrado", contactId };
}

/** Pone al contacto en la columna "Formulario abandonado" sin pisar tarjetas avanzadas. */
async function ubicarTarjeta(contactId: string, a: AbandonoGuardado): Promise<string | null> {
  const etapaId = await etapaPorClave(ETAPA_ABANDONO);
  if (!etapaId) return null;
  const titulo = `Formulario web · ${a.pack}`;
  const valor = Math.round((a.total || 0) * 100);

  const [ultima] = await db
    .select({ id: deals.id, stageKey: pipelineStages.key })
    .from(deals)
    .innerJoin(pipelineStages, eq(pipelineStages.id, deals.stageId))
    .where(eq(deals.contactId, contactId))
    .orderBy(desc(deals.updatedAt))
    .limit(1);

  if (ultima) {
    const [conPedido] = await db
      .select({ id: pedidosOrdenes.id })
      .from(pedidosOrdenes)
      .where(eq(pedidosOrdenes.dealId, ultima.id))
      .limit(1);
    if (conPedido || !ETAPAS_TEMPRANAS.includes(ultima.stageKey ?? "")) {
      // Tarjeta de un pedido real o ya avanzada: se crea una aparte para el abandono.
    } else {
      await db.update(deals).set({ title: titulo, value: valor, updatedAt: new Date() }).where(eq(deals.id, ultima.id));
      await setDealStage({ dealId: ultima.id, stageId: etapaId });
      return ultima.id;
    }
  }

  const [nueva] = await db
    .insert(deals)
    .values({ title: titulo, value: valor, stageId: etapaId, contactId, notes: a.url ? `Landing: ${a.url}` : null })
    .returning({ id: deals.id });
  await setDealStage({ dealId: nueva.id, stageId: etapaId, justCreated: true });
  return nueva.id;
}

/**
 * Llamado por el webhook de Shopify y por el barrido (que ve los pedidos creados por
 * chat con crear_pedido_chat): si el contacto venía de un
 * formulario abandonado, lo marca recuperado. Distingue si fue tras nuestro mensaje
 * (rescate real) o si lo terminó solo (no cuenta como mérito del sistema).
 */
export async function marcarAbandonoRecuperado(contactId: string, numeroOrden: string, total: number) {
  const [c] = await db.select({ tags: contacts.tags }).from(contacts).where(eq(contacts.id, contactId)).limit(1);
  const tags = (c?.tags ?? []).map((t) => t.toLowerCase());
  if (!tags.includes(TAG_ABANDONO) || tags.includes(TAG_RECUPERADO)) return;
  if (tags.includes(TAG_CERRADO)) return; // perdido hace tiempo: compra nueva, no rescate
  const trasMensaje = tags.includes(TAG_PASO1) || tags.includes(TAG_PASO2) || tags.includes(TAG_RESPONDIO);
  await ponerEtiquetas(contactId, [TAG_RECUPERADO]);
  await anotar(
    contactId,
    // Sin punto final: las métricas leen el monto con una expresión regular.
    `Recuperado ${trasMensaje ? "tras mensaje" : "por su cuenta"}: pedido ${numeroOrden} por S/ ${Number(total || 0).toFixed(2)}`
  );
}

/** Busca o abre la conversación de WhatsApp del contacto (igual que la automatización de pedidos). */
async function conversacionWhatsapp(contactId: string): Promise<string | null> {
  const existente = await resolveConversationId(contactId);
  if (existente) return existente;
  const [contact] = await db
    .select({ id: contacts.id, name: contacts.name, phone: contacts.phone, tenantId: contacts.tenantId })
    .from(contacts)
    .where(eq(contacts.id, contactId))
    .limit(1);
  if (!contact?.phone) return null;
  const [previa] = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(
      and(
        eq(conversations.channel, "whatsapp"),
        or(eq(conversations.contactId, contact.id), eq(conversations.participantId, contact.phone))
      )
    )
    .orderBy(desc(conversations.createdAt))
    .limit(1);
  if (previa) return previa.id;
  const [account] = await db
    .select()
    .from(channelAccounts)
    .where(and(eq(channelAccounts.platform, "whatsapp"), eq(channelAccounts.status, "active")))
    .limit(1);
  const [creada] = await db
    .insert(conversations)
    .values({
      tenantId: contact.tenantId,
      accountId: account?.id ?? null,
      contactId: contact.id,
      channel: "whatsapp",
      provider: account?.provider ?? "zernio",
      externalId: `zernio:${contact.phone}`,
      participantId: contact.phone,
      participantName: contact.name,
      status: "active",
    })
    .returning({ id: conversations.id });
  return creada?.id ?? null;
}

/** Envío activo solo con ABANDONOS_ENVIO=on (las plantillas deben estar aprobadas en Meta). */
export function envioActivo(): boolean {
  return (process.env.ABANDONOS_ENVIO ?? "").toLowerCase() === "on";
}

export interface ResultadoBarrido {
  revisados: number;
  enviados: number;
  recuperados: number;
  respondieron: number;
  cerrados: number;
  envioActivo: boolean;
  detalles: Array<{ contactId: string; accion: string; detalle?: string }>;
}

/** Barrido: lo llama /api/agent/abandonos desde barridos.ts cada pocos minutos. */
export async function procesarAbandonos(opts: { ahora?: Date; limite?: number } = {}): Promise<ResultadoBarrido> {
  const ahora = opts.ahora ?? new Date();
  const limite = opts.limite ?? 15;
  const res: ResultadoBarrido = {
    revisados: 0,
    enviados: 0,
    recuperados: 0,
    respondieron: 0,
    cerrados: 0,
    envioActivo: envioActivo(),
    detalles: [],
  };

  const finales = sql.raw(`ARRAY[${TAGS_FINALES.map((t) => `'${t}'`).join(",")}]::text[]`);
  const candidatos = await db
    .select({
      id: contacts.id,
      name: contacts.name,
      tags: contacts.tags,
      customFields: contacts.customFields,
      updatedAt: contacts.updatedAt,
    })
    .from(contacts)
    .where(
      and(
        sql`${contacts.tags} @> ARRAY[${TAG_ABANDONO}]::text[]`,
        sql`not (${contacts.tags} && ${finales})`
      )
    )
    .orderBy(contacts.updatedAt)
    .limit(limite);

  for (const c of candidatos) {
    res.revisados++;
    const a = ((c.customFields as Record<string, unknown> | null)?.abandono ?? null) as AbandonoGuardado | null;
    const capturadoEn = a?.capturadoEn ? new Date(a.capturadoEn) : c.updatedAt;

    const pasos = await db
      .select({ description: activities.description, createdAt: activities.createdAt })
      .from(activities)
      .where(and(eq(activities.contactId, c.id), like(activities.description, `${PREFIJO} Paso %`)))
      .orderBy(desc(activities.createdAt))
      .limit(10);
    const fechaPaso = (n: 1 | 2) =>
      pasos.find((p) => p.description.startsWith(`${PREFIJO} Paso ${n} enviado`) && p.createdAt >= capturadoEn)
        ?.createdAt ?? null;

    // Si ya venía conversando (6 h antes de la captura) o escribió después, lo atiende el bot.
    const [entrante] = await db
      .select({ id: messages.id })
      .from(messages)
      .innerJoin(conversations, eq(conversations.id, messages.conversationId))
      .where(
        and(
          eq(conversations.contactId, c.id),
          eq(messages.direction, "in"),
          gte(messages.createdAt, new Date(capturadoEn.getTime() - 6 * 3_600_000))
        )
      )
      .limit(1);

    const [pedido] = await db
      .select({ numeroOrden: pedidosOrdenes.numeroOrden, total: pedidosOrdenes.total })
      .from(pedidosOrdenes)
      .where(
        and(
          eq(pedidosOrdenes.contactId, c.id),
          gte(pedidosOrdenes.createdAt, new Date(capturadoEn.getTime() - 10 * 60_000))
        )
      )
      .orderBy(desc(pedidosOrdenes.createdAt))
      .limit(1);

    const decision = decidirAccion(
      {
        tags: c.tags ?? [],
        capturadoEn,
        paso1En: fechaPaso(1),
        paso2En: fechaPaso(2),
        respondioDespues: Boolean(entrante),
        pedidoDespues: Boolean(pedido),
        horaLima: horaLima(ahora),
      },
      ahora
    );

    if (decision.accion === "esperar") continue;

    if (decision.accion === "recuperado") {
      await marcarAbandonoRecuperado(c.id, pedido!.numeroOrden, Number(pedido!.total));
      res.recuperados++;
      res.detalles.push({ contactId: c.id, accion: "recuperado" });
      continue;
    }

    if (decision.accion === "respondio") {
      await ponerEtiquetas(c.id, [TAG_RESPONDIO]);
      await anotar(c.id, "Respondió por WhatsApp: lo atiende el bot con el contexto del formulario.");
      res.respondieron++;
      res.detalles.push({ contactId: c.id, accion: "respondio" });
      continue;
    }

    if (decision.accion === "cerrar") {
      await ponerEtiquetas(c.id, [TAG_CERRADO]);
      await anotar(c.id, `Cerrado sin compra: ${decision.motivo}.`);
      const cancelado = await etapaPorClave("cancelado_rechazado");
      const [tarjeta] = await db
        .select({ id: deals.id })
        .from(deals)
        .innerJoin(pipelineStages, eq(pipelineStages.id, deals.stageId))
        .where(and(eq(deals.contactId, c.id), eq(pipelineStages.key, ETAPA_ABANDONO)))
        .limit(1);
      if (tarjeta && cancelado) await setDealStage({ dealId: tarjeta.id, stageId: cancelado });
      res.cerrados++;
      res.detalles.push({ contactId: c.id, accion: "cerrado", detalle: decision.motivo });
      continue;
    }

    // paso1 / paso2
    if (!res.envioActivo) {
      res.detalles.push({ contactId: c.id, accion: `${decision.accion}_pendiente`, detalle: "ABANDONOS_ENVIO apagado" });
      continue;
    }
    // Un error de envío se reintenta como mucho cada 6 h (plantilla sin aprobar, número inválido).
    const [errorReciente] = await db
      .select({ id: activities.id })
      .from(activities)
      .where(
        and(
          eq(activities.contactId, c.id),
          like(activities.description, `${PREFIJO} Error%`),
          gte(activities.createdAt, new Date(ahora.getTime() - 6 * 3_600_000))
        )
      )
      .limit(1);
    if (errorReciente) continue;

    const convId = await conversacionWhatsapp(c.id);
    const n = decision.accion === "paso1" ? 1 : 2;
    if (!convId) {
      await anotar(c.id, `Error paso ${n}: el contacto no tiene número de WhatsApp.`);
      continue;
    }
    const msg = armarMensaje(decision.accion, {
      nombre: c.name,
      producto: a?.producto ?? "nac600",
      total: a?.total ?? 0,
    });
    const entrega = await deliverMessage(
      convId,
      { text: msg.texto, template: { ...msg.plantilla, previewText: msg.texto } },
      "agent"
    );
    if (!entrega.ok) {
      await anotar(c.id, `Error paso ${n}: ${entrega.error ?? "no se pudo enviar"}.`);
      res.detalles.push({ contactId: c.id, accion: `error_paso${n}`, detalle: entrega.error });
      continue;
    }
    await ponerEtiquetas(c.id, [n === 1 ? TAG_PASO1 : TAG_PASO2]);
    await anotar(c.id, `Paso ${n} enviado (${msg.plantilla.name}).`);
    res.enviados++;
    res.detalles.push({ contactId: c.id, accion: `paso${n}` });
  }

  return res;
}
