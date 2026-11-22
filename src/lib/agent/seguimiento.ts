import "server-only";
import { db } from "@/db";
import { activities, contacts, conversations, messages } from "@/db/schema";
import { and, desc, eq, gt, isNull, like, lte } from "drizzle-orm";
import { deliverMessage } from "@/lib/channels/deliver";
import { pedidosOrdenes } from "../../../modules/pedidos/tabla";
import {
  PREFIJO_SEGUIMIENTO,
  ajustarAHorario,
  decidirSeguimiento,
  detectarPromesa,
  mensajeSeguimiento,
} from "./seguimiento-reglas";

const RE_CONV = /conv:([0-9a-f-]{36})/i;

/**
 * Si el último mensaje del cliente promete volver, agenda (o mueve) un recordatorio.
 * Un solo recordatorio pendiente por contacto.
 */
export async function registrarPromesaSiAplica(
  contactId: string,
  conversationId: string,
  textoCliente: string,
  ahora: Date = new Date()
): Promise<Date | null> {
  const cuando = detectarPromesa(textoCliente, ahora);
  if (!cuando) return null;
  const programado = ajustarAHorario(cuando);
  const cita = textoCliente.replace(/\s+/g, " ").slice(0, 120);
  const descripcion = `${PREFIJO_SEGUIMIENTO} conv:${conversationId} El cliente dijo: "${cita}". Si no vuelve, el bot le escribe una vez.`;

  const [pendiente] = await db
    .select({ id: activities.id })
    .from(activities)
    .where(
      and(
        eq(activities.contactId, contactId),
        like(activities.description, `${PREFIJO_SEGUIMIENTO}%`),
        isNull(activities.completedAt)
      )
    )
    .limit(1);

  if (pendiente) {
    await db
      .update(activities)
      .set({ scheduledAt: programado, description: descripcion, createdAt: ahora })
      .where(eq(activities.id, pendiente.id));
  } else {
    await db.insert(activities).values({
      type: "follow_up",
      description: descripcion,
      contactId,
      scheduledAt: programado,
      createdAt: ahora,
    });
  }
  return programado;
}

export interface ResultadoSeguimientos {
  revisados: number;
  enviados: number;
  cerrados: number;
  detalles: Array<{ contactId: string | null; accion: string; detalle?: string }>;
}

/** Barrido: escribe a quien prometió volver y no volvió. */
export async function procesarSeguimientos(opts: { ahora?: Date; limite?: number } = {}): Promise<ResultadoSeguimientos> {
  const ahora = opts.ahora ?? new Date();
  const res: ResultadoSeguimientos = { revisados: 0, enviados: 0, cerrados: 0, detalles: [] };

  const vencidos = await db
    .select({
      id: activities.id,
      contactId: activities.contactId,
      description: activities.description,
      scheduledAt: activities.scheduledAt,
      createdAt: activities.createdAt,
    })
    .from(activities)
    .where(
      and(
        like(activities.description, `${PREFIJO_SEGUIMIENTO}%`),
        isNull(activities.completedAt),
        lte(activities.scheduledAt, ahora)
      )
    )
    .limit(opts.limite ?? 20);

  for (const a of vencidos) {
    res.revisados++;
    const cerrar = async (motivo: string) => {
      await db
        .update(activities)
        .set({ completedAt: ahora, description: `${a.description} [Cerrado: ${motivo}]` })
        .where(eq(activities.id, a.id));
      res.cerrados++;
      res.detalles.push({ contactId: a.contactId, accion: "cerrado", detalle: motivo });
    };
    if (!a.contactId || !a.scheduledAt) {
      await cerrar("sin contacto");
      continue;
    }
    const convId = a.description.match(RE_CONV)?.[1] ?? null;
    const [contact] = await db
      .select({ name: contacts.name, aiEnabled: contacts.aiEnabled })
      .from(contacts)
      .where(eq(contacts.id, a.contactId))
      .limit(1);
    const [conv] = convId
      ? await db
          .select({ id: conversations.id, aiEnabled: conversations.aiEnabled })
          .from(conversations)
          .where(eq(conversations.id, convId))
          .limit(1)
      : [];
    const [ultimoEntrante] = convId
      ? await db
          .select({ createdAt: messages.createdAt })
          .from(messages)
          .where(and(eq(messages.conversationId, convId), eq(messages.direction, "in")))
          .orderBy(desc(messages.createdAt))
          .limit(1)
      : [];
    const [pedido] = await db
      .select({ id: pedidosOrdenes.id })
      .from(pedidosOrdenes)
      .where(and(eq(pedidosOrdenes.contactId, a.contactId), gt(pedidosOrdenes.createdAt, a.createdAt)))
      .limit(1);

    const decision = decidirSeguimiento({
      ahora,
      programadoPara: a.scheduledAt,
      creadoEn: a.createdAt,
      ultimoEntranteEn: ultimoEntrante?.createdAt ?? null,
      pedidoDespues: Boolean(pedido),
      aiActivo: Boolean(contact?.aiEnabled) && Boolean(conv?.aiEnabled ?? true) && Boolean(conv),
    });
    if (decision.accion === "esperar") continue;
    if (decision.accion === "cerrar") {
      await cerrar(decision.motivo);
      continue;
    }

    const pideDatos = /pas(o|ar)|dato|direcci|dni|yape|captura|ubicaci/i.test(a.description);
    const texto = mensajeSeguimiento(contact?.name, pideDatos ? "datos" : "general");
    // E6: tope de 3 mensajes nuestros seguidos sin respuesta (bot, equipo y automáticos).
    const { puedeEnviarToque } = await import("./toques-servidor");
    if (!(await puedeEnviarToque(conv!.id))) {
      await cerrar("ya hay 3 mensajes nuestros sin respuesta");
      continue;
    }
    const entrega = await deliverMessage(conv!.id, { text: texto }, "agent");
    if (!entrega.ok) {
      await cerrar(`no se pudo enviar: ${entrega.error ?? "error"}`);
      continue;
    }
    await db
      .update(activities)
      .set({ completedAt: ahora, description: `${a.description} [Enviado: "${texto}"]` })
      .where(eq(activities.id, a.id));
    res.enviados++;
    res.detalles.push({ contactId: a.contactId, accion: "enviado" });
  }
  return res;
}
