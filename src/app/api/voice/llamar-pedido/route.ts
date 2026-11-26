import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { contacts } from "@/db/schema";
import { eq, or } from "drizzle-orm";
import { pedidosOrdenes } from "../../../../../modules/pedidos/tabla";
import { dispararLlamadaConfirmacionPedido, obtenerConfigVozIA } from "@/lib/voice/llamar-pedido";
import { PROMPT_AGENTE_VOZ_ALIV } from "@/lib/voice/llamar-pedido-reglas";
import { getCurrentMember } from "@/lib/team";
import { autorizadoPorSecreto } from "@/lib/secreto-worker";

export const dynamic = "force-dynamic";

/**
 * GET /api/voice/llamar-pedido
 * Devuelve el estado de configuración de ElevenLabs + Twilio y el prompt maestro sugerido.
 */
export async function GET(req: NextRequest) {
  const esWorker = autorizadoPorSecreto(req);
  if (!esWorker) {
    const member = await getCurrentMember();
    if (!member) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  const config = await obtenerConfigVozIA();
  return NextResponse.json({
    ok: true,
    enabled: config.enabled,
    configured: Boolean(config.apiKey && config.agentId && config.agentPhoneNumberId),
    agentId: config.agentId,
    agentPhoneNumberId: config.agentPhoneNumberId,
    endpointKind: config.endpointKind,
    webhookPostCallUrl: "https://crm-aliv.onrender.com/api/webhooks/voice-ai",
    promptSugerido: PROMPT_AGENTE_VOZ_ALIV,
  });
}

/**
 * POST /api/voice/llamar-pedido
 * Permite disparar (o reintentar) una llamada de confirmación con IA para cualquier pedido
 * existente por `pedidoId` o `numeroOrden` (ej. "#1190").
 */
export async function POST(req: NextRequest) {
  const esWorker = autorizadoPorSecreto(req);
  if (!esWorker) {
    const member = await getCurrentMember();
    if (!member) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  let body: { pedidoId?: string; numeroOrden?: string; forzar?: boolean } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const qOrden = body.numeroOrden?.trim();
  const qId = body.pedidoId?.trim();
  if (!qOrden && !qId) {
    return NextResponse.json({ error: "Indica pedidoId o numeroOrden (ej. '#1190')" }, { status: 400 });
  }

  const cond = qId
    ? eq(pedidosOrdenes.id, qId)
    : or(
        eq(pedidosOrdenes.numeroOrden, qOrden!.startsWith("#") ? qOrden! : `#${qOrden}`),
        eq(pedidosOrdenes.numeroOrden, qOrden!)
      );

  const [pedido] = await db.select().from(pedidosOrdenes).where(cond!).limit(1);
  if (!pedido) {
    return NextResponse.json({ error: "Pedido no encontrado" }, { status: 404 });
  }

  const [contacto] = await db.select().from(contacts).where(eq(contacts.id, pedido.contactId)).limit(1);
  if (!contacto) {
    return NextResponse.json({ error: "Contacto del pedido no encontrado" }, { status: 404 });
  }

  const esAgencia = pedido.modalidadPago === "adelanto_agencia";
  const productosTexto =
    Array.isArray(pedido.items) && pedido.items.length > 0
      ? pedido.items.map((i) => `${i.cantidad}x ${i.titulo}`).join(", ")
      : "tu pedido de Aliv Perú";

  const res = await dispararLlamadaConfirmacionPedido(
    {
      pedidoId: pedido.id,
      numeroOrden: pedido.numeroOrden,
      contactId: contacto.id,
      nombreCliente: contacto.name,
      telefono: contacto.phone,
      productosTexto,
      totalSoles: Number(pedido.total) || 0,
      ciudad: pedido.ciudad,
      distrito: pedido.distrito,
      direccion: pedido.direccionEnvio,
      dni: pedido.dniCliente,
      esAgencia,
      modalidadEntregaTexto: esAgencia ? "Agencia Shalom (Provincia)" : "Contraentrega Domicilio",
    },
    { forzar: Boolean(body.forzar) }
  );

  return NextResponse.json(res, { status: res.ok || res.omitido ? 200 : 502 });
}
