import "server-only";
import { db } from "@/db";
import { activities, contacts, conversations, messages } from "@/db/schema";
import { and, desc, eq, gte, isNull, like, lte } from "drizzle-orm";
import { deliverMessage } from "@/lib/channels/deliver";
import { esNumeroEntrenador } from "@/lib/alerts/supervisor-alerts";
import { pedidosOrdenes } from "../../../modules/pedidos/tabla";
import { PREFIJO_SEGUIMIENTO } from "./seguimiento-reglas";
import {
  PREFIJO_TOQUE_CALIENTE,
  VENTANA_TOQUE_CALIENTE,
  decidirToqueCaliente,
  mensajeToqueCaliente,
  type EscenarioToqueCaliente,
} from "./toque-caliente-reglas";

/** Solo envía con TOQUE_CALIENTE=on; sin la variable, informa qué enviaría (modo prueba). */
export function toqueCalienteActivo(): boolean {
  return (process.env.TOQUE_CALIENTE ?? "").trim().toLowerCase() === "on";
}

/** Registro del modo prueba (en memoria, últimos 200): qué habría enviado y a quién. */
export interface RegistroPrueba {
  fecha: string;
  contactId: string;
  nombre: string | null;
  escenario: EscenarioToqueCaliente;
  ultimoBot: string;
  mensaje: string;
}
declare global {
  var __toqueCalientePrueba: RegistroPrueba[] | undefined;
}
export function registroPruebaToqueCaliente(): RegistroPrueba[] {
  return globalThis.__toqueCalientePrueba ?? [];
}

export interface ResultadoToqueCaliente {
  activo: boolean;
  revisados: number;
  enviados: number;
  detalles: Array<{ contactId: string; escenario?: EscenarioToqueCaliente; accion: string; motivo?: string; mensaje?: string }>;
}

export async function procesarToquesCalientes(opts: { ahora?: Date; limite?: number } = {}): Promise<ResultadoToqueCaliente> {
  const ahora = opts.ahora ?? new Date();
  const activo = toqueCalienteActivo();
  const res: ResultadoToqueCaliente = { activo, revisados: 0, enviados: 0, detalles: [] };

  // Chats cuyo último mensaje cae dentro de la ventana (12 a 45 min).
  const desde = new Date(ahora.getTime() - VENTANA_TOQUE_CALIENTE.maxMin * 60_000);
  const hasta = new Date(ahora.getTime() - VENTANA_TOQUE_CALIENTE.minMin * 60_000);
  const candidatas = await db
    .select({
      convId: conversations.id,
      lastInboundAt: conversations.lastInboundAt,
      contactId: contacts.id,
      name: contacts.name,
      phone: contacts.phone,
      tags: contacts.tags,
    })
    .from(conversations)
    .innerJoin(contacts, eq(conversations.contactId, contacts.id))
    .where(
      and(
        eq(conversations.aiEnabled, true),
        eq(contacts.aiEnabled, true),
        eq(conversations.channel, "whatsapp"),
        gte(conversations.lastMessageAt, desde),
        lte(conversations.lastMessageAt, hasta)
      )
    )
    .orderBy(desc(conversations.lastMessageAt))
    .limit(opts.limite ?? 30);

  for (const c of candidatas) {
    // Supervisores prueban el bot: no se les manda toque.
    if (esNumeroEntrenador(c.phone)) continue;
    res.revisados++;

    const recientes = await db
      .select({ direction: messages.direction, origin: messages.origin, body: messages.body, createdAt: messages.createdAt })
      .from(messages)
      .where(eq(messages.conversationId, c.convId))
      .orderBy(desc(messages.createdAt))
      .limit(5);
    // El bot suele responder en varias burbujas (foto + texto): se leen juntas las del bot
    // posteriores al último mensaje del cliente.
    const ultimoRaw = recientes[0];
    const burbujasBot: string[] = [];
    for (const m of recientes) {
      if (m.direction !== "out" || m.origin !== "agent") break;
      burbujasBot.unshift(m.body ?? "");
    }
    const ultimo = ultimoRaw ? { ...ultimoRaw, body: burbujasBot.length ? burbujasBot.join("\n") : ultimoRaw.body } : null;
    const [ultimoEntrante] = await db
      .select({ createdAt: messages.createdAt })
      .from(messages)
      .where(and(eq(messages.conversationId, c.convId), eq(messages.direction, "in")))
      .orderBy(desc(messages.createdAt))
      .limit(1);
    const ultimoEntranteEn = ultimoEntrante?.createdAt ?? c.lastInboundAt ?? null;

    const [toquePrevio] = await db
      .select({ id: activities.id })
      .from(activities)
      .where(
        and(
          eq(activities.contactId, c.contactId),
          like(activities.description, `${PREFIJO_TOQUE_CALIENTE}%`),
          gte(activities.createdAt, ultimoEntranteEn ?? new Date(0))
        )
      )
      .limit(1);
    const [promesa] = await db
      .select({ id: activities.id })
      .from(activities)
      .where(
        and(
          eq(activities.contactId, c.contactId),
          like(activities.description, `${PREFIJO_SEGUIMIENTO}%`),
          isNull(activities.completedAt)
        )
      )
      .limit(1);
    const [pedido] = await db
      .select({ estado: pedidosOrdenes.estado })
      .from(pedidosOrdenes)
      .where(eq(pedidosOrdenes.contactId, c.contactId))
      .orderBy(desc(pedidosOrdenes.createdAt))
      .limit(1);

    const decision = decidirToqueCaliente({
      ahora,
      ultimo: ultimo
        ? { direction: ultimo.direction as "in" | "out", origin: ultimo.origin, body: ultimo.body, createdAt: ultimo.createdAt }
        : null,
      ultimoEntranteEn,
      tags: c.tags,
      estadoPedido: pedido?.estado ?? null,
      yaTocado: Boolean(toquePrevio),
      promesaPendiente: Boolean(promesa),
      aiActivo: true,
    });
    if (decision.accion !== "enviar") {
      res.detalles.push({ contactId: c.contactId, accion: decision.accion, motivo: decision.motivo });
      continue;
    }

    const texto = mensajeToqueCaliente(decision.escenario, c.name);
    if (!activo) {
      const reg = (globalThis.__toqueCalientePrueba ??= []);
      const clave = `${c.contactId}|${ultimo!.createdAt.toISOString()}`;
      if (!reg.some((r) => `${r.contactId}|${r.fecha}` === clave)) {
        reg.unshift({
          fecha: ultimo!.createdAt.toISOString(),
          contactId: c.contactId,
          nombre: c.name,
          escenario: decision.escenario,
          ultimoBot: String(ultimo!.body ?? "").slice(0, 400),
          mensaje: texto,
        });
        reg.length = Math.min(reg.length, 200);
      }
      res.detalles.push({ contactId: c.contactId, escenario: decision.escenario, accion: "enviaria", mensaje: texto });
      continue;
    }

    // E6: tope de 3 mensajes nuestros seguidos sin respuesta.
    const { puedeEnviarToque } = await import("./toques-servidor");
    if (!(await puedeEnviarToque(c.convId))) {
      res.detalles.push({ contactId: c.contactId, accion: "omitir", motivo: "ya hay 3 mensajes nuestros sin respuesta" });
      continue;
    }

    // Video real de despachos (opcional): solo si Gerardo cargó uno en TOQUE_CALIENTE_VIDEO_URL.
    const video = (process.env.TOQUE_CALIENTE_VIDEO_URL ?? "").trim();
    const entrega = await deliverMessage(
      c.convId,
      decision.escenario === "adelanto" && /^https:\/\//.test(video)
        ? { text: texto, attachments: [{ type: "video", url: video }] }
        : { text: texto },
      "agent"
    );
    // Se deja constancia aunque falle, para no reintentar en cada barrido.
    await db.insert(activities).values({
      type: "note",
      contactId: c.contactId,
      description: `${PREFIJO_TOQUE_CALIENTE} ${decision.escenario}: ${
        entrega.ok ? `enviado "${texto}"` : `falló el envío (${entrega.error ?? "sin detalle"})`
      }`.slice(0, 900),
    });
    if (!entrega.ok) {
      res.detalles.push({ contactId: c.contactId, escenario: decision.escenario, accion: "fallo", motivo: entrega.error });
      continue;
    }
    res.enviados++;
    res.detalles.push({ contactId: c.contactId, escenario: decision.escenario, accion: "enviado", mensaje: texto });
  }
  return res;
}
