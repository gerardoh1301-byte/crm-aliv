import "server-only";
import { db } from "@/db";
import { contacts, pipelines, pipelineStages, deals } from "@/db/schema";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { getConfig } from "@/lib/config";
import { pedidosOrdenes } from "../../../modules/pedidos/tabla";
import { cleanStr, esEtiquetaDeEtapa, obtenerEtiquetaDeEtapa, quitarLogisticaSiCierra } from "@/lib/tags";

/**
 * Lleva el pipeline por defecto al estado que describe config/cliente.ts.
 *
 * Corre al arrancar (instrumentation.ts) y es idempotente:
 *  - Si no hay pipeline por defecto, lo crea con el nombre de la config.
 *  - Cada etapa de la config se busca por `key`; si no tiene key todavia, por nombre
 *    (para adoptar las etapas que ya existian antes de la config); si no existe, se crea.
 *  - Nombre, color, orden y ganada/perdida se actualizan desde la config.
 *  - Las etapas que estan en la base pero NO en la config se conservan (pueden tener
 *    operaciones) y se ordenan despues; se borran solo si no tienen operaciones y
 *    `borrarSobrantes` es true (no es el default).
 *
 * La UI sigue pudiendo crear etapas a mano; esas quedan sin key y sobreviven.
 */
/**
 * true si la tarjeta tiene un pedido confirmado de verdad (regla de confirmación real):
 * un pedido «por confirmar» sigue siendo intención de compra aunque tenga la etiqueta.
 */
async function tienePedido(dealId: string): Promise<boolean> {
  const [p] = await db
    .select({ id: pedidosOrdenes.id })
    .from(pedidosOrdenes)
    .where(and(eq(pedidosOrdenes.dealId, dealId), sql`${pedidosOrdenes.estado} <> 'por_confirmar_cod'`))
    .limit(1);
  return Boolean(p);
}

export async function sincronizarPipeline(opts?: { borrarSobrantes?: boolean }) {
  const { pipeline } = getConfig();

  let [principal] = await db
    .select()
    .from(pipelines)
    .where(eq(pipelines.isDefault, true))
    .limit(1);

  if (!principal) {
    [principal] = await db
      .insert(pipelines)
      .values({ name: pipeline.nombre, isDefault: true, order: 0 })
      .returning();
  } else if (principal.name !== pipeline.nombre) {
    await db
      .update(pipelines)
      .set({ name: pipeline.nombre, updatedAt: new Date() })
      .where(eq(pipelines.id, principal.id));
  }

  const existentes = await db
    .select()
    .from(pipelineStages)
    .where(eq(pipelineStages.pipelineId, principal.id))
    .orderBy(asc(pipelineStages.order));

  const porClave = new Map(existentes.filter((e) => e.key).map((e) => [e.key as string, e]));
  const sinClave = existentes.filter((e) => !e.key);
  const usadas = new Set<string>();
  let creadas = 0;
  let actualizadas = 0;

  for (let i = 0; i < pipeline.etapas.length; i++) {
    const etapa = pipeline.etapas[i];
    let fila = porClave.get(etapa.clave);
    if (!fila) {
      const idx = sinClave.findIndex(
        (e) => e.name.trim().toLowerCase() === etapa.nombre.trim().toLowerCase()
      );
      if (idx >= 0) fila = sinClave.splice(idx, 1)[0];
    }

    const valores = {
      key: etapa.clave,
      name: etapa.nombre,
      color: etapa.color,
      order: i,
      isWon: etapa.ganada,
      isLost: etapa.perdida,
    };

    if (fila) {
      usadas.add(fila.id);
      const cambio =
        fila.key !== valores.key ||
        fila.name !== valores.name ||
        fila.color !== valores.color ||
        fila.order !== valores.order ||
        fila.isWon !== valores.isWon ||
        fila.isLost !== valores.isLost;
      if (cambio) {
        await db.update(pipelineStages).set(valores).where(eq(pipelineStages.id, fila.id));
        actualizadas++;
      }
    } else {
      await db.insert(pipelineStages).values({ pipelineId: principal.id, ...valores });
      creadas++;
    }
  }

  // Sobrantes: lo que esta en la base y no en la config.
  const sobrantes = existentes.filter((e) => !usadas.has(e.id));
  let conservadas = 0;
  let borradas = 0;
  for (let j = 0; j < sobrantes.length; j++) {
    const s = sobrantes[j];
    const [{ n }] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(deals)
      .where(eq(deals.stageId, s.id));
    if (opts?.borrarSobrantes && n === 0) {
      await db.delete(pipelineStages).where(eq(pipelineStages.id, s.id));
      borradas++;
    } else {
      const orden = pipeline.etapas.length + j;
      if (s.order !== orden) {
        await db.update(pipelineStages).set({ order: orden }).where(eq(pipelineStages.id, s.id));
      }
      conservadas++;
    }
  }

  // Los demas pipelines no son el default.
  if (existentes.length === 0 && creadas > 0) {
    await db
      .update(pipelines)
      .set({ isDefault: false })
      .where(and(eq(pipelines.isDefault, true), inArray(pipelines.id, [principal.id])))
      .then(() => db.update(pipelines).set({ isDefault: true }).where(eq(pipelines.id, principal.id)));
  }

  // Colocar las operaciones de los contactos que tienen la etiqueta "Agendar entrega" en la etapa "agendar_entrega"
  const [stageAgendar] = await db
    .select({ id: pipelineStages.id })
    .from(pipelineStages)
    .where(and(eq(pipelineStages.pipelineId, principal.id), eq(pipelineStages.key, "agendar_entrega")))
    .limit(1);

  if (stageAgendar) {
    const agendarStageId = stageAgendar.id;
    const todosContactos = await db
      .select({ id: contacts.id, name: contacts.name, tags: contacts.tags })
      .from(contacts);

    const contactosConAgendar = todosContactos.filter((c) =>
      (c.tags || []).some((t) => cleanStr(t) === "agendar entrega")
    );

    for (const c of contactosConAgendar) {
      const [deal] = await db
        .select({ id: deals.id, stageId: deals.stageId })
        .from(deals)
        .innerJoin(pipelineStages, eq(deals.stageId, pipelineStages.id))
        .where(and(eq(deals.contactId, c.id), eq(pipelineStages.pipelineId, principal.id)))
        .orderBy(desc(deals.updatedAt))
        .limit(1);

      if (deal) {
        // No retroceder ni reactivar si ya fue entregado, está en camino o fue cancelado/rechazado
        const [dealStage] = await db
          .select({
            key: pipelineStages.key,
            isWon: pipelineStages.isWon,
            isLost: pipelineStages.isLost,
          })
          .from(pipelineStages)
          .where(eq(pipelineStages.id, deal.stageId))
          .limit(1);

        if (
          dealStage?.isWon ||
          dealStage?.isLost ||
          dealStage?.key === "adelanto_pagado" ||
          dealStage?.key === "por_validar" ||
          dealStage?.key === "en_reparto" ||
          dealStage?.key === "entregado" ||
          dealStage?.key === "cancelado_rechazado"
        ) {
          continue;
        }

        // Solo una tarjeta con pedido real puede estar en "Pedido confirmado": la etiqueta
        // sola (abandono, chat, rescate) dejaba ahí tarjetas sin pedido en cada reinicio.
        if (!(await tienePedido(deal.id))) continue;

        if (deal.stageId !== agendarStageId) {
          await db
            .update(deals)
            .set({ stageId: agendarStageId, updatedAt: new Date() })
            .where(eq(deals.id, deal.id));
        }
      }
      // Sin tarjeta no se inventa una: sin pedido no hay nada que despachar.
    }
  }


  // Colocar las operaciones de los contactos que tienen la etiqueta "adelanto pagado" en la etapa "adelanto_pagado"
  const [stageAdelanto] = await db
    .select({ id: pipelineStages.id })
    .from(pipelineStages)
    .where(and(eq(pipelineStages.pipelineId, principal.id), eq(pipelineStages.key, "adelanto_pagado")))
    .limit(1);

  if (stageAdelanto) {
    const adelantoStageId = stageAdelanto.id;
    const todosContactos = await db
      .select({ id: contacts.id, name: contacts.name, tags: contacts.tags })
      .from(contacts);

    const contactosConAdelanto = todosContactos.filter((c) =>
      (c.tags || []).some((t) => cleanStr(t) === "adelanto pagado")
    );

    for (const c of contactosConAdelanto) {
      const [deal] = await db
        .select({ id: deals.id, stageId: deals.stageId })
        .from(deals)
        .innerJoin(pipelineStages, eq(deals.stageId, pipelineStages.id))
        .where(and(eq(deals.contactId, c.id), eq(pipelineStages.pipelineId, principal.id)))
        .orderBy(desc(deals.updatedAt))
        .limit(1);

      if (deal) {
        const [dealStage] = await db
          .select({
            key: pipelineStages.key,
            isWon: pipelineStages.isWon,
            isLost: pipelineStages.isLost,
          })
          .from(pipelineStages)
          .where(eq(pipelineStages.id, deal.stageId))
          .limit(1);

        if (
          dealStage?.isWon ||
          dealStage?.isLost ||
          dealStage?.key === "entregado" ||
          dealStage?.key === "cancelado_rechazado"
        ) {
          continue;
        }

        if (!(await tienePedido(deal.id))) continue;

        if (deal.stageId !== adelantoStageId) {
          await db
            .update(deals)
            .set({ stageId: adelantoStageId, updatedAt: new Date() })
            .where(eq(deals.id, deal.id));
        }
      }
    }
  }

  // Sincronizar también el pipeline secundario de Postventa y Recompra
  try {
    await sincronizarPipelinePostventa();
  } catch (err) {
    console.warn("[pipeline] Error al sincronizar pipeline postventa:", err);
  }

  return { pipelineId: principal.id, creadas, actualizadas, conservadas, borradas };
}

export const PIPELINE_POSTVENTA_NOMBRE = "Postventa y Recompra";

export const ETAPAS_POSTVENTA = [
  {
    clave: "postventa_dia_1_3",
    nombre: "Día 1-3: Producto recibido (Bienvenida)",
    color: "#3b82f6",
    order: 0,
    isWon: false,
    isLost: false,
  },
  {
    clave: "postventa_dia_7",
    nombre: "Día 7: Control de hábito y satisfacción",
    color: "#8b5cf6",
    order: 1,
    isWon: false,
    isLost: false,
  },
  {
    clave: "postventa_dia_25",
    nombre: "Día 25: Alerta de recompra NAC600",
    color: "#f59e0b",
    order: 2,
    isWon: false,
    isLost: false,
  },
  {
    clave: "postventa_recompra_exitosa",
    nombre: "Recompra lograda (Fidelizado)",
    color: "#10b981",
    order: 3,
    isWon: true,
    isLost: false,
  },
];

export async function sincronizarPipelinePostventa() {
  let [postventa] = await db
    .select()
    .from(pipelines)
    .where(eq(pipelines.name, PIPELINE_POSTVENTA_NOMBRE))
    .limit(1);

  if (!postventa) {
    [postventa] = await db
      .insert(pipelines)
      .values({ name: PIPELINE_POSTVENTA_NOMBRE, isDefault: false, order: 1 })
      .returning();
  }

  const existentes = await db
    .select()
    .from(pipelineStages)
    .where(eq(pipelineStages.pipelineId, postventa.id))
    .orderBy(asc(pipelineStages.order));

  const porClave = new Map(existentes.filter((e) => e.key).map((e) => [e.key as string, e]));

  for (let i = 0; i < ETAPAS_POSTVENTA.length; i++) {
    const etapa = ETAPAS_POSTVENTA[i];
    const fila =
      porClave.get(etapa.clave) ||
      existentes.find((e) => e.name.trim().toLowerCase() === etapa.nombre.trim().toLowerCase());

    const valores = {
      key: etapa.clave,
      name: etapa.nombre,
      color: etapa.color,
      order: i,
      isWon: etapa.isWon,
      isLost: etapa.isLost,
    };

    if (fila) {
      await db.update(pipelineStages).set(valores).where(eq(pipelineStages.id, fila.id));
    } else {
      await db.insert(pipelineStages).values({ pipelineId: postventa.id, ...valores });
    }
  }

  return postventa;
}

/**
 * Sincroniza las etiquetas de los contactos que tienen operaciones en el pipeline.
 * Para cada contacto, toma la etapa de su operación más reciente y actualiza
 * su etiqueta en el chat para que coincida exactamente con su etapa actual.
 */
export async function sincronizarEtiquetasDesdePipeline(): Promise<{ actualizados: number }> {
  const dealsConEtapa = await db
    .select({
      contactId: deals.contactId,
      stageId: deals.stageId,
      stageKey: pipelineStages.key,
      stageName: pipelineStages.name,
      stageIsWon: pipelineStages.isWon,
      stageIsLost: pipelineStages.isLost,
    })
    .from(deals)
    .innerJoin(pipelineStages, eq(deals.stageId, pipelineStages.id))
    .orderBy(desc(deals.updatedAt), desc(deals.createdAt));

  const etapaPorContacto = new Map<
    string,
    { key: string | null; name: string; isWon: boolean | null; isLost: boolean | null }
  >();

  for (const d of dealsConEtapa) {
    if (d.contactId && !etapaPorContacto.has(d.contactId)) {
      etapaPorContacto.set(d.contactId, {
        key: d.stageKey,
        name: d.stageName,
        isWon: d.stageIsWon,
        isLost: d.stageIsLost,
      });
    }
  }

  let actualizados = 0;
  for (const [contactId, etapa] of etapaPorContacto.entries()) {
    const nuevaEtiqueta = obtenerEtiquetaDeEtapa(etapa);
    if (!nuevaEtiqueta) continue;

    const [contacto] = await db
      .select({ id: contacts.id, tags: contacts.tags })
      .from(contacts)
      .where(eq(contacts.id, contactId))
      .limit(1);

    if (!contacto) continue;

    const tagsActuales: string[] = contacto.tags ?? [];

    // Si ya tiene "Agendar entrega" y la nueva etapa mapeada es "Pendiente de adelanto",
    // proteger y conservar "Agendar entrega" (la entrega ya fue agendada/coordinada).
    const tieneAgendarEntrega = tagsActuales.some((t) => cleanStr(t) === "agendar entrega");
    if (tieneAgendarEntrega && cleanStr(nuevaEtiqueta) === "pendiente de adelanto") {
      continue;
    }

    const sinEtapas = quitarLogisticaSiCierra(
      tagsActuales.filter((t) => !esEtiquetaDeEtapa(t)),
      nuevaEtiqueta
    );
    const tieneEtiqueta = tagsActuales.some((t) => t.toLowerCase() === nuevaEtiqueta.toLowerCase());
    const tieneOtrasEtapas = tagsActuales.some(
      (t) => esEtiquetaDeEtapa(t) && t.toLowerCase() !== nuevaEtiqueta.toLowerCase()
    );
    const sobraLogistica = sinEtapas.length !== tagsActuales.filter((t) => !esEtiquetaDeEtapa(t)).length;

    if (!tieneEtiqueta || tieneOtrasEtapas || sobraLogistica) {
      const finalTags = [...sinEtapas, nuevaEtiqueta];
      await db
        .update(contacts)
        .set({ tags: finalTags, updatedAt: new Date() })
        .where(eq(contacts.id, contactId));
      actualizados++;
    }
  }

  return { actualizados };
}
