import "server-only";
import { db } from "@/db";
import { activities, contacts, conversations, messages } from "@/db/schema";
import { and, desc, eq, gte, isNull } from "drizzle-orm";
import { pedidosOrdenes } from "../../../modules/pedidos/tabla";
import { deliverMessage } from "@/lib/channels/deliver";
import { esPedidoDeProvincia } from "./adelanto";
import { mostrarNumeroOrden } from "./numero-formato";
import { coordenadasDeTexto, geocodificarDireccion, referenciaDeTexto } from "@/lib/aliclik/registrar-orden";
import {
  HORAS_MAX_UBICACION,
  MARCA_UBICACION_GOOGLE,
  MARCA_UBICACION_OK,
  MARCA_UBICACION_RECORDATORIO,
  decidirUbicacionCE,
  mensajeRecordatorioUbicacion,
  ubicacionResuelta,
} from "./ubicacion-ce-reglas";

/** Encendido por defecto; UBICACION_CE=off lo deja en modo prueba (solo informa qué haría). */
export function ubicacionCEActiva(): boolean {
  return (process.env.UBICACION_CE ?? "").trim().toLowerCase() !== "off";
}

const maps = (c: { lat: number; lng: number }) => `https://maps.google.com/?q=${c.lat.toFixed(6)},${c.lng.toFixed(6)}`;

export interface ResultadoUbicacionCE {
  activo: boolean;
  revisados: number;
  detalles: Array<{ pedido: string; accion: string; detalle?: string }>;
}

type FilaPedido = typeof pedidosOrdenes.$inferSelect;

async function anotar(p: FilaPedido, marca: string) {
  await db
    .update(pedidosOrdenes)
    .set({ notas: [p.notas, marca].filter(Boolean).join("\n"), updatedAt: new Date() })
    .where(eq(pedidosOrdenes.id, p.id));
  await db
    .insert(activities)
    .values({ type: "note", description: marca.slice(0, 900), contactId: p.contactId, dealId: p.dealId });
}

export async function procesarUbicacionesCE(opts: { ahora?: Date } = {}): Promise<ResultadoUbicacionCE> {
  const ahora = opts.ahora ?? new Date();
  const activo = ubicacionCEActiva();
  const res: ResultadoUbicacionCE = { activo, revisados: 0, detalles: [] };
  const desde = new Date(ahora.getTime() - HORAS_MAX_UBICACION * 3_600_000);

  // Pedidos del bot contra entrega (los de agencia Shalom no llevan motorizado).
  const pedidos = await db
    .select()
    .from(pedidosOrdenes)
    .where(
      and(
        eq(pedidosOrdenes.estado, "confirmado"),
        eq(pedidosOrdenes.modalidadPago, "contraentrega"),
        isNull(pedidosOrdenes.shopifyOrderId),
        gte(pedidosOrdenes.createdAt, desde)
      )
    )
    .limit(40);

  for (const p of pedidos) {
    if (esPedidoDeProvincia(p) || /shalom/i.test(p.transportadora ?? "")) continue;
    if (ubicacionResuelta(p.notas)) continue;
    res.revisados++;

    // Lo que mandó el cliente desde 2 h antes del pedido (suele dar la dirección antes de registrar).
    const desdeChat = new Date(p.createdAt.getTime() - 2 * 3_600_000);
    const entrantes = await db
      .select({ body: messages.body })
      .from(messages)
      .innerJoin(conversations, eq(conversations.id, messages.conversationId))
      .where(
        and(eq(conversations.contactId, p.contactId), eq(messages.direction, "in"), gte(messages.createdAt, desdeChat))
      )
      .orderBy(desc(messages.createdAt))
      .limit(40);
    const pin = entrantes.map((m) => coordenadasDeTexto(m.body)).find((c) => c !== null) ?? null;
    const tieneReferencia =
      Boolean(referenciaDeTexto(p.direccionEnvio)) || entrantes.some((m) => Boolean(referenciaDeTexto(m.body)));

    const d = decidirUbicacionCE({ ahora, creadoEn: p.createdAt, notas: p.notas, tienePin: Boolean(pin), tieneReferencia });
    if (d.accion === "nada" || d.accion === "esperar") continue;
    const num = mostrarNumeroOrden(p.numeroOrden);

    if (d.accion === "pin_ok" && pin) {
      if (activo) await anotar(p, `${MARCA_UBICACION_OK} Pin del cliente: ${maps(pin)}`);
      res.detalles.push({ pedido: num, accion: "pin_ok" });
      continue;
    }

    if (d.accion === "recordar") {
      const [conv] = await db
        .select({ id: conversations.id, aiEnabled: conversations.aiEnabled, nombre: contacts.name })
        .from(conversations)
        .innerJoin(contacts, eq(contacts.id, conversations.contactId))
        .where(and(eq(conversations.contactId, p.contactId), eq(conversations.channel, "whatsapp")))
        .orderBy(desc(conversations.lastMessageAt))
        .limit(1);
      const texto = mensajeRecordatorioUbicacion({
        nombre: conv?.nombre ?? null,
        numeroVisible: num,
        faltaPin: d.faltaPin,
        faltaReferencia: d.faltaReferencia,
      });
      if (!activo) {
        res.detalles.push({ pedido: num, accion: "recordaria", detalle: texto });
        continue;
      }
      // Si una persona tomó el chat no se le escribe; el plan B llega 10 min después igual.
      let detalle = conv ? "chat en manos de una persona, no se envió" : "sin chat de WhatsApp";
      if (conv?.aiEnabled) {
        const r = await deliverMessage(conv.id, { text: texto }, "agent").catch((e: unknown) => ({
          ok: false as const,
          error: e instanceof Error ? e.message : String(e),
        }));
        detalle = r.ok ? "enviado" : `falló (${r.error ?? "sin detalle"})`;
      }
      const falta = [d.faltaPin && "ubicación", d.faltaReferencia && "referencia"].filter(Boolean).join(" y ");
      await anotar(p, `${MARCA_UBICACION_RECORDATORIO} ${ahora.toISOString()} Recordatorio de ${falta}: ${detalle}.`);
      res.detalles.push({ pedido: num, accion: "recordatorio", detalle });
      continue;
    }

    // Plan B: Google ubica la dirección escrita.
    const g = await geocodificarDireccion({ direccion: p.direccionEnvio ?? "", distrito: p.distrito, ciudad: p.ciudad });
    const marca = g.ok
      ? `${MARCA_UBICACION_GOOGLE} Sin pin del cliente. Punto de Google (${
          /ROOFTOP|RANGE_INTERPOLATED/.test(g.coordenadas.precision ?? "") ? "exacto" : "aproximado, confirmar con el cliente"
        }): ${maps(g.coordenadas)}${g.coordenadas.direccionGoogle ? ` — ${g.coordenadas.direccionGoogle}` : ""}`
      : `${MARCA_UBICACION_GOOGLE} Sin pin y Google no ubicó la dirección (${g.error}). Confirmar la dirección con el cliente antes de despachar.`;
    if (activo) await anotar(p, marca);
    res.detalles.push({ pedido: num, accion: "plan_b", detalle: marca });
  }
  return res;
}
