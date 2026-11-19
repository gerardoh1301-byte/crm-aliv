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
 * Crea o reinicia un deal en el Tablero de Postventa y Recompra cuando un pedido
 * es entregado o se confirma su recepción.
 */
export async function crearOActualizarDealPostventa(
  contactId: string,
  tituloUOrden?: string,
  montoSoles?: number
): Promise<{ ok: boolean; dealId?: string }> {
  try {
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
    const nowIso = new Date().toISOString();
    const meta: PostventaMetadata = {
      fechaEntrega: nowIso,
      ordenInfo: tituloUOrden,
      mensajeDia1Enviado: false,
      mensajeDia7Enviado: false,
      mensajeDia25Enviado: false,
    };

    if (!existingDeal) {
      const [nuevo] = await db
        .insert(deals)
        .values({
          title: tituloUOrden ? `Postventa · ${tituloUOrden}` : `Postventa · ${contacto.name || "Cliente"}`,
          contactId,
          stageId: stageDia1.id,
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
      // Si ya existía, reiniciar para el nuevo ciclo de postventa en etapa día 1-3
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

    const fechaEntrega = meta.fechaEntrega ? new Date(meta.fechaEntrega) : deal.createdAt;
    const diasTranscurridos = Math.floor((ahora.getTime() - fechaEntrega.getTime()) / (1000 * 60 * 60 * 24));

    // Buscar conversación activa
    const [conv] = await db
      .select()
      .from(conversations)
      .where(eq(conversations.contactId, contact.id))
      .orderBy(desc(conversations.lastMessageAt))
      .limit(1);

    if (!conv) continue;

    // Si la conversación tiene el agente pausado, no enviar mensajes automáticos
    const convMeta = (conv.metadata as Record<string, unknown> | null) ?? {};
    if (convMeta.agentPaused === true) continue;

    const { nombreLimpio } = resolverNombreHumanoCliente(contact.name);
    const nombre = nombreLimpio || "estimado(a)";
    const esTermix = /termix|tobillera/i.test(deal.title || "") || /termix|tobillera/i.test(meta.ordenInfo || "");

    let mensajeAEnviar: string | null = null;
    let nuevoStageId: string | null = null;
    let actividadNota = "";

    if (diasTranscurridos >= 25 && !meta.mensajeDia25Enviado) {
      mensajeAEnviar = esTermix
        ? `¡Hola, ${nombre}! 🌿 Te saluda Aliv Perú. Esperamos que sigas recuperando tu movilidad y estabilidad con tu Tobillera Termix. Si deseas un par adicional para el otro pie o un familiar, te mantenemos el precio de promoción especial con envío gratis. ¿Te gustaría aprovecharlo? ✨`
        : buildMensajeDia25(nombre);
      nuevoStageId = stageDia25.id;
      meta.mensajeDia25Enviado = true;
      actividadNota = `Alerta automática de recompra (Día 25) enviada al cliente.`;
    } else if (diasTranscurridos >= 7 && diasTranscurridos < 25 && !meta.mensajeDia7Enviado) {
      mensajeAEnviar = esTermix
        ? `¡Hola, ${nombre}! 🌿 Te saluda Aliv Perú. Ya llevas una semana usando tu Tobillera Termix. Cuéntanos, ¿cómo ha respondido tu tobillo con el soporte y alivio en tus actividades diarias?`
        : buildMensajeDia7(nombre);
      nuevoStageId = stageDia7.id;
      meta.mensajeDia7Enviado = true;
      actividadNota = `Seguimiento automático de hábito (Día 7) enviado al cliente.`;
    } else if (diasTranscurridos >= 1 && diasTranscurridos < 7 && !meta.mensajeDia1Enviado) {
      mensajeAEnviar = esTermix
        ? `¡Hola, ${nombre}! 👋 Te saluda Aliv Perú. Vemos que ya recibiste tu Tobillera Termix. Recuerda que es de compresión ajustable y soporte ergonómico para uso diario. ¿Llegó todo en perfecto estado? Estamos atentos ante cualquier duda. 🦶`
        : buildMensajeDia1(nombre);
      meta.mensajeDia1Enviado = true;
      actividadNota = `Mensaje de bienvenida y modo de uso (Día 1-3) enviado al cliente.`;
    }

    if (mensajeAEnviar) {
      try {
        const entrega = await deliverMessage(conv.id, { text: mensajeAEnviar }, "agent");
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
        }
      } catch (err) {
        console.error("[postventa] error enviando seguimiento:", err);
        errores++;
      }
    }
  }

  return { procesados, enviados, errores };
}
