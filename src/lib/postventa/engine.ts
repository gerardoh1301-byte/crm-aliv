import "server-only";
import { db } from "@/db";
import { activities, contacts, conversations, deals, pipelineStages } from "@/db/schema";
import { and, asc, desc, eq } from "drizzle-orm";
import { deliverMessage } from "@/lib/channels/deliver";
import { esNumeroEntrenador } from "@/lib/alerts/supervisor-alerts";
import { resolverNombreHumanoCliente } from "@/lib/agent/prompt";
import { sincronizarPipelinePostventa } from "@/lib/pipeline/sincronizar";
import { esHorarioPermitidoRescate } from "@/lib/agent/rescate";
import { getConfig } from "@/lib/config";

export interface PostventaMetadata {
  fechaEntrega: string;
  ordenInfo?: string;
  mensajeDia1Enviado?: boolean;
  mensajeDia7Enviado?: boolean;
  mensajeDia25Enviado?: boolean;
  /** Fallos de envío seguidos (plantilla sin aprobar, fuera de la ventana de 24 h...). */
  intentosFallidos?: number;
  ultimoIntentoFallido?: string;
}

/** Tras un fallo se reintenta cada 6 h, máximo 3 veces, para no llenar el chat de errores. */
export const POSVENTA_MAX_INTENTOS = 3;
const POSVENTA_ESPERA_REINTENTO_MS = 6 * 60 * 60 * 1000;

export function posventaEnEspera(meta: PostventaMetadata, ahora: Date = new Date()): boolean {
  if ((meta.intentosFallidos ?? 0) >= POSVENTA_MAX_INTENTOS) return true;
  if (!meta.ultimoIntentoFallido) return false;
  return ahora.getTime() - new Date(meta.ultimoIntentoFallido).getTime() < POSVENTA_ESPERA_REINTENTO_MS;
}

/** Quita prefijos "Postventa · " repetidos del título de origen. */
export function tituloBasePostventa(titulo: string | null | undefined): string {
  return (titulo || "").replace(/^(\s*postventa\s*·\s*)+/i, "").trim();
}

export function buildMensajeDia1(nombreCliente: string): string {
  return `¡Hola, ${nombreCliente}! 👋 Te saluda Aliv Perú. Vemos que ya recibiste tu pedido de NAC600 + NAD+. Recuerda que el tratamiento se toma 2 cápsulas al día con un vaso de agua en el desayuno. ¿Llegó todo en perfecto estado? Estamos aquí ante cualquier duda sobre su toma. 🌿`;
}

export function buildMensajeDia7(nombreCliente: string): string {
  return `¡Hola, ${nombreCliente}! 🌿 Te saluda Aliv Perú. Ya cumples tu primera semana tomando tu NAC600 + NAD+. Cuéntanos, ¿cómo te has sentido en estos primeros días? Recuerda mantener la constancia en tus 2 cápsulas diarias con el desayuno para maximizar la producción natural de glutatión y energía celular.`;
}

export function buildMensajeDia25(nombreCliente: string): string {
  return `¡Hola, ${nombreCliente}! 🌿 Te saluda Aliv Perú. Tu frasco de 60 cápsulas de NAC600 + NAD+ debe estar por los últimos días de tratamiento. Para que no interrumpas tus resultados, queremos ofrecerte nuestra promoción exclusiva de recompra: 2 frascos por S/ 189 o 3 frascos por S/ 199 con envío gratis hasta tu domicilio. ¿Te separamos tu nuevo pedido? ✨`;
}

/**
 * Valida si un contacto es elegible para recibir mensajes automáticos de postventa.
 * Respeta estrictamente si el bot está apagado (aiEnabled = false), si el cliente
 * requiere atención humana (needsHuman = true), si está en modo copiloto o si tiene
 * etiquetas de reclamo, queja o atención manual activa.
 */
export function esElegibleParaPostventa(
  contact: {
    aiEnabled?: boolean | null;
    needsHuman?: boolean | null;
    tags?: string[] | null;
  },
  conv?: {
    aiEnabled?: boolean | null;
    needsHuman?: boolean | null;
    metadata?: unknown;
  } | null
): { elegible: boolean; motivo?: string } {
  if (!conv) {
    return { elegible: false, motivo: "sin_conversacion" };
  }

  // 1. Interruptor general de IA en contacto y conversación
  if (contact.aiEnabled === false || conv.aiEnabled === false) {
    return { elegible: false, motivo: "ai_desactivada" };
  }

  // 2. Cliente derivado o que requiere atención de un asesor humano
  if (contact.needsHuman === true || conv.needsHuman === true) {
    return { elegible: false, motivo: "requiere_humano" };
  }

  // 3. Modo asistido o agente pausado en metadata
  const convMeta = (conv.metadata as Record<string, unknown> | null) ?? {};
  if (convMeta.agentPaused === true || convMeta.copilotMode === true) {
    return { elegible: false, motivo: "agente_pausado_o_copiloto" };
  }

  // 4. Etiquetas bloqueantes (reclamos, atención manual, cancelado)
  const tags = (contact.tags ?? []).map((t) => t.toLowerCase().trim());
  const tieneTagBloqueante = tags.some(
    (t) =>
      t.includes("no reactivar") ||
      t.includes("reclamo") ||
      t.includes("queja") ||
      t.includes("atencion manual") ||
      t.includes("atendido manual") ||
      t.includes("cancelado") ||
      t.includes("baja")
  );
  if (tieneTagBloqueante) {
    return { elegible: false, motivo: "etiqueta_bloqueante" };
  }

  return { elegible: true };
}

export interface OpcionesDealPostventa {
  /** Fecha real de entrega del pedido (evita reiniciar el reloj a "hoy" en backfills). */
  fechaEntrega?: Date | string | null;
  /** Si true (usado en backfill), nunca reinicia ni sobrescribe una tarjeta de postventa ya existente. */
  soloSiNoExiste?: boolean;
}

/**
 * Resuelve un texto descriptivo del producto real del pedido (para distinguir Termix vs NAC600)
 * combinando `items` de `pedidos_ordenes`, título del deal de venta y número de orden.
 */
export function resolverTituloProductoPostventa(input: {
  numeroOrden?: string | null;
  items?: unknown;
  dealTitle?: string | null;
}): string {
  const nombres: string[] = [];
  if (Array.isArray(input.items)) {
    for (const raw of input.items) {
      if (!raw || typeof raw !== "object") continue;
      const item = raw as Record<string, unknown>;
      const cand =
        (typeof item.titulo === "string" && item.titulo.trim()) ||
        (typeof item.nombre === "string" && item.nombre.trim()) ||
        (typeof item.producto === "string" && item.producto.trim()) ||
        (typeof item.title === "string" && item.title.trim()) ||
        (typeof item.sku === "string" && item.sku.trim()) ||
        "";
      if (cand && !nombres.includes(cand)) nombres.push(cand);
    }
  }
  const prodTexto =
    nombres.join(", ") ||
    (input.dealTitle && input.dealTitle.trim()) ||
    "";
  const orden = (input.numeroOrden || "").trim();
  if (orden && prodTexto) return `${orden} · ${prodTexto}`;
  return prodTexto || orden || "Pedido entregado";
}

/**
 * Evalúa si un pedido entregado entra al backfill de postventa (P1):
 * - Descarta entregas con más de 30 días de antigüedad.
 * - Usa la fecha real de entrega (nunca `hoy`).
 */
export function evaluarBackfillPostventa(
  fechaEntregaReal: Date,
  ahora: Date = new Date(),
  maxDias = 30
): { incluir: boolean; diasTranscurridos: number; motivo?: string } {
  const ts = fechaEntregaReal.getTime();
  if (!Number.isFinite(ts)) {
    return { incluir: false, diasTranscurridos: 999, motivo: "fecha_invalida" };
  }
  const diasTranscurridos = Math.max(
    0,
    Math.floor((ahora.getTime() - ts) / (1000 * 60 * 60 * 24))
  );
  if (diasTranscurridos > maxDias) {
    return { incluir: false, diasTranscurridos, motivo: "mayor_a_30_dias" };
  }
  return { incluir: true, diasTranscurridos };
}

/**
 * Crea o actualiza un deal en el Tablero de Postventa y Recompra cuando un pedido
 * es entregado o se confirma su recepción.
 */
export async function crearOActualizarDealPostventa(
  contactId: string,
  tituloUOrden?: string,
  montoSoles?: number,
  opts?: OpcionesDealPostventa
): Promise<{ ok: boolean; dealId?: string; omitido?: string }> {
  try {
    tituloUOrden = tituloBasePostventa(tituloUOrden) || undefined;
    const [contacto] = await db
      .select({ id: contacts.id, phone: contacts.phone, name: contacts.name })
      .from(contacts)
      .where(eq(contacts.id, contactId))
      .limit(1);

    if (!contacto) return { ok: false };
    if (contacto.phone && esNumeroEntrenador(contacto.phone)) {
      return { ok: false }; // Los entrenadores no entran en postventa
    }

    const postventaPipeline = await sincronizarPipelinePostventa();

    const stages = await db
      .select()
      .from(pipelineStages)
      .where(eq(pipelineStages.pipelineId, postventaPipeline.id))
      .orderBy(asc(pipelineStages.order));

    const stageDia1 = stages.find((s) => s.key === "postventa_dia_1_3") || stages[0];
    const stageDia7 = stages.find((s) => s.key === "postventa_dia_7") || stageDia1;
    const stageDia25 = stages.find((s) => s.key === "postventa_dia_25") || stageDia7;
    if (!stageDia1) return { ok: false };

    // Buscar si ya tiene un deal en este pipeline
    const dealsPostventa = await db
      .select({
        id: deals.id,
        stageId: deals.stageId,
        title: deals.title,
        value: deals.value,
        notes: deals.notes,
      })
      .from(deals)
      .innerJoin(pipelineStages, eq(deals.stageId, pipelineStages.id))
      .where(and(eq(deals.contactId, contactId), eq(pipelineStages.pipelineId, postventaPipeline.id)))
      .orderBy(desc(deals.updatedAt))
      .limit(1);

    const existingDeal = dealsPostventa[0];
    // P1: En backfill jamás reiniciar ni tocar tarjetas de postventa ya existentes
    if (existingDeal && opts?.soloSiNoExiste) {
      return { ok: false, dealId: existingDeal.id, omitido: "ya_existe" };
    }

    const fechaEntregaDate = opts?.fechaEntrega ? new Date(opts.fechaEntrega) : new Date();
    const fechaValida = Number.isFinite(fechaEntregaDate.getTime()) ? fechaEntregaDate : new Date();
    const dias = Math.max(0, Math.floor((Date.now() - fechaValida.getTime()) / (1000 * 60 * 60 * 24)));
    const stageInicial = dias >= 25 ? stageDia25 : dias >= 7 ? stageDia7 : stageDia1;

    const meta: PostventaMetadata = {
      fechaEntrega: fechaValida.toISOString(),
      ordenInfo: tituloUOrden,
      // Si se crea desde backfill histórico (>7d o >25d), no disparar hitos ya pasados
      mensajeDia1Enviado: Boolean(opts?.soloSiNoExiste && dias >= 7),
      mensajeDia7Enviado: Boolean(opts?.soloSiNoExiste && dias >= 25),
      mensajeDia25Enviado: false,
    };

    if (!existingDeal) {
      const [nuevo] = await db
        .insert(deals)
        .values({
          title: tituloUOrden ? `Postventa · ${tituloUOrden}` : `Postventa · ${contacto.name || "Cliente"}`,
          contactId,
          stageId: stageInicial.id,
          value: montoSoles ? Math.round(montoSoles * 100) : 0,
          notes: JSON.stringify(meta),
        })
        .returning();

      await db.insert(activities).values({
        type: "note",
        description: `Cliente ingresado al Tablero de Postventa y Recompra (${tituloUOrden || "Pedido recibido"}).`,
        contactId,
        dealId: nuevo.id,
      });

      return { ok: true, dealId: nuevo.id };
    } else {
      // Si ya existía (y NO es backfill), reiniciar para el nuevo ciclo de postventa en etapa día 1-3
      await db
        .update(deals)
        .set({
          stageId: stageDia1.id,
          title: tituloUOrden ? `Postventa · ${tituloUOrden}` : existingDeal.title,
          value: montoSoles ? Math.round(montoSoles * 100) : existingDeal.value,
          notes: JSON.stringify(meta),
          updatedAt: new Date(),
        })
        .where(eq(deals.id, existingDeal.id));

      await db.insert(activities).values({
        type: "note",
        description: `Ciclo de postventa reiniciado tras nueva entrega (${tituloUOrden || "Pedido entregado"}).`,
        contactId,
        dealId: existingDeal.id,
      });

      return { ok: true, dealId: existingDeal.id };
    }
  } catch (err) {
    console.error("[postventa] error en crearOActualizarDealPostventa:", err);
    return { ok: false };
  }
}

/**
 * Si un pedido entregado pasa posteriormente a cancelado/rechazado,
 * remueve la tarjeta de postventa para que no se envíen mensajes automáticos a un cliente cancelado.
 */
export async function cancelarDealPostventa(contactId: string): Promise<void> {
  try {
    const postventaPipeline = await sincronizarPipelinePostventa();
    const dealsActivos = await db
      .select({ id: deals.id })
      .from(deals)
      .innerJoin(pipelineStages, eq(deals.stageId, pipelineStages.id))
      .where(
        and(
          eq(deals.contactId, contactId),
          eq(pipelineStages.pipelineId, postventaPipeline.id)
        )
      );

    for (const d of dealsActivos) {
      await db.update(activities).set({ dealId: null }).where(eq(activities.dealId, d.id));
      await db.delete(deals).where(eq(deals.id, d.id));
    }
  } catch (err) {
    console.warn("[postventa] error al cancelar postventa para contacto:", contactId, err);
  }
}

/**
 * Motor de seguimiento automático de postventa:
 * Realiza el envío periódico de mensajes por WhatsApp en Día 1-3, Día 7 y Día 25,
 * avanzando automáticamente el deal por las etapas del pipeline.
 */
export async function procesarSeguimientosPostventaAutomaticos(opts?: {
  forzarHorario?: boolean;
}): Promise<{ procesados: number; enviados: number; errores: number }> {
  const ahora = new Date();
  const forzarHorario = opts?.forzarHorario ?? false;

  if (!forzarHorario && !esHorarioPermitidoRescate(ahora, getConfig().zonaHoraria)) {
    return { procesados: 0, enviados: 0, errores: 0 };
  }

  const postventaPipeline = await sincronizarPipelinePostventa();

  const stages = await db
    .select()
    .from(pipelineStages)
    .where(eq(pipelineStages.pipelineId, postventaPipeline.id))
    .orderBy(asc(pipelineStages.order));

  const stagePorKey = new Map(stages.map((s) => [s.key || "", s]));
  const stageDia1 = stagePorKey.get("postventa_dia_1_3");
  const stageDia7 = stagePorKey.get("postventa_dia_7");
  const stageDia25 = stagePorKey.get("postventa_dia_25");

  if (!stageDia1 || !stageDia7 || !stageDia25) {
    return { procesados: 0, enviados: 0, errores: 0 };
  }

  // Traer deals activos en postventa (que no sean ganados / recompra exitosa)
  const dealsActivos = await db
    .select({
      deal: deals,
      stage: pipelineStages,
      contact: contacts,
    })
    .from(deals)
    .innerJoin(pipelineStages, eq(deals.stageId, pipelineStages.id))
    .innerJoin(contacts, eq(deals.contactId, contacts.id))
    .where(
      and(
        eq(pipelineStages.pipelineId, postventaPipeline.id),
        eq(pipelineStages.isWon, false),
        eq(pipelineStages.isLost, false)
      )
    );

  let procesados = 0;
  let enviados = 0;
  let errores = 0;

  for (const item of dealsActivos) {
    procesados++;
    const { deal, contact } = item;

    if (contact.phone && esNumeroEntrenador(contact.phone)) {
      continue;
    }

    // Parsear notas / metadata
    let meta: PostventaMetadata;
    try {
      meta = deal.notes ? JSON.parse(deal.notes) : { fechaEntrega: deal.createdAt.toISOString() };
    } catch {
      meta = { fechaEntrega: deal.createdAt.toISOString() };
    }
    if (posventaEnEspera(meta, ahora)) continue;
    const metaOriginal: PostventaMetadata = { ...meta };

    const fechaEntrega = meta.fechaEntrega ? new Date(meta.fechaEntrega) : deal.createdAt;
    const diasTranscurridos = Math.floor((ahora.getTime() - fechaEntrega.getTime()) / (1000 * 60 * 60 * 24));

    // Buscar conversación activa
    const [conv] = await db
      .select()
      .from(conversations)
      .where(eq(conversations.contactId, contact.id))
      .orderBy(desc(conversations.lastMessageAt))
      .limit(1);

    // Blindaje de seguridad (R2): validar si el contacto y la conversación son elegibles
    const evaluacion = esElegibleParaPostventa(contact, conv);
    if (!evaluacion.elegible) {
      continue;
    }

    const { nombreLimpio } = resolverNombreHumanoCliente(contact.name);
    const nombre = nombreLimpio || "estimado(a)";
    const esTermix = /termix|tobillera/i.test(deal.title || "") || /termix|tobillera/i.test(meta.ordenInfo || "");

    let mensajeAEnviar: string | null = null;
    let plantillaPostventa: { name: string; language: string; params: string[]; previewText: string } | undefined;
    let nuevoStageId: string | null = null;
    let actividadNota = "";

    const productoLabel = esTermix ? "Tobillera Termix" : "NAC600 + NAD+";

    if (diasTranscurridos >= 25 && !meta.mensajeDia25Enviado) {
      mensajeAEnviar = esTermix
        ? `¡Hola, ${nombre}! 🌿 Te saluda Aliv Perú. Esperamos que sigas recuperando tu movilidad y estabilidad con tu Tobillera Termix. Si deseas un par adicional para el otro pie o un familiar, te mantenemos el precio de promoción especial con envío gratis. ¿Te gustaría aprovecharlo? ✨`
        : buildMensajeDia25(nombre);
      plantillaPostventa = {
        name: "aliv_postventa_recompra",
        language: "es",
        params: [
          nombre,
          productoLabel,
          esTermix
            ? "precio de promoción especial en tu par adicional con envío gratis"
            : "2 frascos por S/ 189 o 3 frascos por S/ 199 con envío gratis",
        ],
        previewText: mensajeAEnviar,
      };
      nuevoStageId = stageDia25.id;
      meta.mensajeDia25Enviado = true;
      actividadNota = `Alerta automática de recompra (Día 25) enviada al cliente.`;
    } else if (diasTranscurridos >= 7 && diasTranscurridos < 25 && !meta.mensajeDia7Enviado) {
      mensajeAEnviar = esTermix
        ? `¡Hola, ${nombre}! 🌿 Te saluda Aliv Perú. Ya llevas una semana usando tu Tobillera Termix. Cuéntanos, ¿cómo ha respondido tu tobillo con el soporte y alivio en tus actividades diarias?`
        : buildMensajeDia7(nombre);
      plantillaPostventa = {
        name: "aliv_postventa_seguimiento",
        language: "es",
        params: [nombre, esTermix ? "tu Tobillera Termix" : "tu NAC600 + NAD+"],
        previewText: mensajeAEnviar,
      };
      nuevoStageId = stageDia7.id;
      meta.mensajeDia7Enviado = true;
      actividadNota = `Seguimiento automático de hábito (Día 7) enviado al cliente.`;
    } else if (diasTranscurridos >= 1 && diasTranscurridos < 7 && !meta.mensajeDia1Enviado) {
      mensajeAEnviar = esTermix
        ? `¡Hola, ${nombre}! 👋 Te saluda Aliv Perú. Vemos que ya recibiste tu Tobillera Termix. Recuerda que es de compresión ajustable y soporte ergonómico para uso diario. ¿Llegó todo en perfecto estado? Estamos atentos ante cualquier duda. 🦶`
        : buildMensajeDia1(nombre);
      plantillaPostventa = {
        name: "aliv_postventa_bienvenida",
        language: "es",
        params: [
          nombre,
          productoLabel,
          esTermix
            ? "compresión ajustable y soporte ergonómico para uso diario"
            : "2 cápsulas al día con un vaso de agua en el desayuno",
        ],
        previewText: mensajeAEnviar,
      };
      meta.mensajeDia1Enviado = true;
      actividadNota = `Mensaje de bienvenida y modo de uso (Día 1-3) enviado al cliente.`;
    }

    if (mensajeAEnviar) {
      try {
        const entrega = await deliverMessage(
          conv.id,
          { text: mensajeAEnviar, ...(plantillaPostventa ? { template: plantillaPostventa } : {}) },
          "agent"
        );
        if (entrega.ok) {
          enviados++;
          const updatePayload: Record<string, unknown> = {
            notes: JSON.stringify(meta),
            updatedAt: new Date(),
          };
          if (nuevoStageId && nuevoStageId !== deal.stageId) {
            updatePayload.stageId = nuevoStageId;
          }
          await db.update(deals).set(updatePayload).where(eq(deals.id, deal.id));

          await db.insert(activities).values({
            type: "note",
            description: actividadNota,
            contactId: contact.id,
            dealId: deal.id,
          });
        } else {
          errores++;
          await registrarFalloPostventa(deal.id, metaOriginal, ahora);
        }
      } catch (err) {
        console.error("[postventa] error enviando seguimiento:", err);
        errores++;
        await registrarFalloPostventa(deal.id, metaOriginal, ahora).catch(() => {});
      }
    }
  }

  return { procesados, enviados, errores };
}

async function registrarFalloPostventa(dealId: string, meta: PostventaMetadata, ahora: Date) {
  const nueva: PostventaMetadata = {
    ...meta,
    intentosFallidos: (meta.intentosFallidos ?? 0) + 1,
    ultimoIntentoFallido: ahora.toISOString(),
  };
  await db.update(deals).set({ notes: JSON.stringify(nueva) }).where(eq(deals.id, dealId));
}

/**
 * Backfill seguro para incorporar al Tablero de Postventa pedidos ya entregados (P1 / R12):
 * - Usa la fecha real de entrega (`updatedAt ?? createdAt`), nunca "hoy".
 * - Salta entregas de más de 30 días.
 * - Nunca reinicia ni sobreescribe tarjetas de postventa ya existentes.
 * - Pasa el producto real (`items` + título del deal) para distinguir Termix vs NAC600.
 */
export async function backfillPedidosEntregadosAPostventa(): Promise<{
  ingresados: number;
  omitidosAntiguos: number;
  omitidosExistentes: number;
}> {
  try {
    const { pedidosOrdenes } = await import("../../../modules/pedidos/tabla");
    const entregados = await db
      .select({
        id: pedidosOrdenes.id,
        contactId: pedidosOrdenes.contactId,
        numeroOrden: pedidosOrdenes.numeroOrden,
        items: pedidosOrdenes.items,
        total: pedidosOrdenes.total,
        updatedAt: pedidosOrdenes.updatedAt,
        createdAt: pedidosOrdenes.createdAt,
        dealTitle: deals.title,
      })
      .from(pedidosOrdenes)
      .leftJoin(deals, eq(deals.id, pedidosOrdenes.dealId))
      .where(eq(pedidosOrdenes.estado, "entregado"))
      .orderBy(desc(pedidosOrdenes.updatedAt));

    let ingresados = 0;
    let omitidosAntiguos = 0;
    let omitidosExistentes = 0;
    const vistos = new Set<string>();

    for (const ord of entregados) {
      if (!ord.contactId || vistos.has(ord.contactId)) continue;
      vistos.add(ord.contactId);

      const fechaReal = ord.updatedAt ?? ord.createdAt;
      const evalFecha = evaluarBackfillPostventa(fechaReal);
      if (!evalFecha.incluir) {
        omitidosAntiguos++;
        continue;
      }

      const tituloProducto = resolverTituloProductoPostventa({
        numeroOrden: ord.numeroOrden,
        items: ord.items,
        dealTitle: ord.dealTitle,
      });

      const res = await crearOActualizarDealPostventa(
        ord.contactId,
        tituloProducto,
        Number(ord.total) || 0,
        {
          fechaEntrega: fechaReal,
          soloSiNoExiste: true,
        }
      );
      if (res.ok) {
        ingresados++;
      } else if (res.omitido === "ya_existe") {
        omitidosExistentes++;
      }
    }
    return { ingresados, omitidosAntiguos, omitidosExistentes };
  } catch (err) {
    console.error("[postventa] error en backfill:", err);
    return { ingresados: 0, omitidosAntiguos: 0, omitidosExistentes: 0 };
  }
}

