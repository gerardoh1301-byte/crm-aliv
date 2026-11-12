import "server-only";
import { db } from "@/db";
import { contacts, conversations, messages } from "@/db/schema";
import { and, eq, gte, inArray, ne, sql, type SQL } from "drizzle-orm";
import { pedidosOrdenes } from "../../../modules/pedidos/tabla";
import { adelantoRegistrado, esPedidoDeProvincia } from "@/lib/pedidos/adelanto";

/** Contactos del simulador: no cuentan en lo que hay que atender. */
const noSimulador = sql`not (${contacts.tags} @> array['simulador']::text[])`;

/** Cliente sin respuesta hace mas de esto (minutos) = "esperando". */
export const MINUTOS_ESPERA = 10;

export interface AtencionHoy {
  alertas: number;
  esperando: number;
  adelantosPorVerificar: number;
  porConfirmar: number;
  /** Mediana en segundos de la respuesta del bot en las ultimas 24 h; null si no hubo. */
  botMedianaSeg: number | null;
  botRespuestas24h: number;
}

export async function calcularAtencionHoy(soloMios: SQL | undefined): Promise<AtencionHoy> {
  const filtroContacto = soloMios ? and(soloMios, noSimulador) : noSimulador;
  const haceEspera = new Date(Date.now() - MINUTOS_ESPERA * 60_000);
  const hace24h = new Date(Date.now() - 24 * 3600_000);
  const hace48h = new Date(Date.now() - 48 * 3600_000);

  const [convs, pedidos, msgs] = await Promise.all([
    db
      .select({
        needsHuman: conversations.needsHuman,
        lastDirection: conversations.lastDirection,
        lastMessageAt: conversations.lastMessageAt,
      })
      .from(conversations)
      .innerJoin(contacts, eq(conversations.contactId, contacts.id))
      .where(and(filtroContacto, ne(conversations.provider, "simulador"))),
    db
      .select({
        estado: pedidosOrdenes.estado,
        notas: pedidosOrdenes.notas,
        ciudad: pedidosOrdenes.ciudad,
        distrito: pedidosOrdenes.distrito,
        direccionEnvio: pedidosOrdenes.direccionEnvio,
        numeroGuia: pedidosOrdenes.numeroGuia,
      })
      .from(pedidosOrdenes)
      .innerJoin(contacts, eq(pedidosOrdenes.contactId, contacts.id))
      .where(and(filtroContacto, inArray(pedidosOrdenes.estado, ["por_confirmar_cod", "confirmado"]))),
    db
      .select({
        conversationId: messages.conversationId,
        direction: messages.direction,
        origin: messages.origin,
        createdAt: messages.createdAt,
      })
      .from(messages)
      .innerJoin(contacts, eq(messages.contactId, contacts.id))
      .where(and(filtroContacto, gte(messages.createdAt, hace24h), ne(messages.provider, "simulador")))
      .orderBy(messages.conversationId, messages.createdAt),
  ]);

  const alertas = convs.filter((c) => c.needsHuman).length;
  const esperando = convs.filter(
    (c) => c.lastDirection === "in" && c.lastMessageAt && c.lastMessageAt < haceEspera && c.lastMessageAt > hace48h
  ).length;

  const porConfirmar = pedidos.filter((p) => p.estado === "por_confirmar_cod").length;
  const adelantosPorVerificar = pedidos.filter(
    (p) => p.estado === "por_confirmar_cod" && !p.numeroGuia && !adelantoRegistrado(p.notas) && esPedidoDeProvincia(p)
  ).length;

  // Respuesta del bot: entrante seguido directamente por una salida del agente.
  const tiempos: number[] = [];
  for (let i = 0; i < msgs.length - 1; i++) {
    const a = msgs[i];
    const b = msgs[i + 1];
    if (a.conversationId !== b.conversationId) continue;
    if (a.direction === "in" && b.direction === "out" && b.origin === "agent") {
      tiempos.push((b.createdAt.getTime() - a.createdAt.getTime()) / 1000);
    }
  }
  tiempos.sort((x, y) => x - y);
  const botMedianaSeg = tiempos.length ? Math.round(tiempos[Math.floor(tiempos.length / 2)]) : null;

  return { alertas, esperando, adelantosPorVerificar, porConfirmar, botMedianaSeg, botRespuestas24h: tiempos.length };
}
