import "server-only";
import { db } from "@/db";
import { messages } from "@/db/schema";
import { and, desc, eq, gt, isNull, ne, sql } from "drizzle-orm";
import { esSaludoAutomatico } from "./origen-anuncio";
import { puedeEnviarOtroToque, VENTANA_TOQUES_MS } from "./toques";

/**
 * Último mensaje que una persona del equipo escribió desde el teléfono (WhatsApp Business):
 * llegan por Zernio sin `origin`. No cuenta la bienvenida automática de WhatsApp Business.
 */
export async function ultimoMensajeHumanoDesdeTelefono(conversationId: string): Promise<Date | null> {
  const filas = await db
    .select({ createdAt: messages.createdAt, origin: messages.origin, body: messages.body, direction: messages.direction })
    .from(messages)
    .where(
      and(
        eq(messages.conversationId, conversationId),
        eq(messages.direction, "out"),
        isNull(messages.origin),
        gt(messages.createdAt, new Date(Date.now() - 6 * 3_600_000))
      )
    )
    .orderBy(desc(messages.createdAt))
    .limit(5);
  const humano = filas.find((m) => !esSaludoAutomatico(m.direction, m.origin, m.body));
  return humano?.createdAt ?? null;
}

/** ¿Puede salir otro mensaje proactivo a este chat? (tope de 3 seguidos sin respuesta en 72 h) */
export async function puedeEnviarToque(conversationId: string): Promise<boolean> {
  const [ultimoEntrante] = await db
    .select({ createdAt: messages.createdAt })
    .from(messages)
    .where(and(eq(messages.conversationId, conversationId), eq(messages.direction, "in")))
    .orderBy(desc(messages.createdAt))
    .limit(1);
  const desde = new Date(Math.max(ultimoEntrante?.createdAt.getTime() ?? 0, Date.now() - VENTANA_TOQUES_MS));
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(messages)
    .where(
      and(
        eq(messages.conversationId, conversationId),
        eq(messages.direction, "out"),
        gt(messages.createdAt, desde),
        ne(messages.status, "failed")
      )
    );
  return puedeEnviarOtroToque(row?.n ?? 0);
}
