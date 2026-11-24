import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { activities, conversations } from "@/db/schema";
import { desc, eq } from "drizzle-orm";
import { requireMember } from "@/lib/api-auth";
import { canAccessContactId, displayName } from "@/lib/team";
import { pedidosOrdenes } from "../../../../../modules/pedidos/tabla";
import { sincronizarEtapaPipeline } from "../../../../../modules/pedidos/servidor";
import { confirmarAdelantoPedido } from "@/lib/pedidos/confirmar-adelanto";
import { deliverMessage } from "@/lib/channels/deliver";
import { mostrarNumeroOrden } from "@/lib/pedidos/numero-formato";
import { MARCA_VALIDADO, mensajeValidado, tipoValidacion, yaValidado } from "@/lib/pedidos/validar-reglas";

/**
 * «Validar y confirmar» (mejora 3). Una PERSONA revisa lo que registró el bot y lo pasa de
 * «Confirmado por bot (por validar)» a «Pedido confirmado (por despachar)»:
 *  - AG: es el mismo «Adelanto confirmado» (Yape de S/20 verificado).
 *  - CE: dirección y referencia revisadas.
 * Después le escribe al cliente que su pedido pasó a despacho. Idempotente: un segundo clic
 * no repite el mensaje.
 */
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const auth = await requireMember();
  if ("response" in auth) return auth.response;
  const { member } = auth;

  const body = (await request.json().catch(() => null)) as { pedidoId?: string } | null;
  if (!body?.pedidoId) return NextResponse.json({ error: "pedidoId es obligatorio" }, { status: 400 });

  const [pedido] = await db.select().from(pedidosOrdenes).where(eq(pedidosOrdenes.id, body.pedidoId)).limit(1);
  if (!pedido) return NextResponse.json({ error: "Pedido no encontrado" }, { status: 404 });
  if (!(await canAccessContactId(member, pedido.contactId))) {
    return NextResponse.json({ error: "Sin acceso a este contacto" }, { status: 403 });
  }
  if (!["por_confirmar_cod", "confirmado"].includes(pedido.estado)) {
    return NextResponse.json({ error: `El pedido ya está en «${pedido.estado}»` }, { status: 409 });
  }
  if (yaValidado(pedido.notas)) {
    return NextResponse.json({ ok: true, yaEstaba: true, mensajeEnviado: false });
  }

  const quien = displayName(member);
  const tipo = tipoValidacion(pedido);
  let actual = pedido;
  if (pedido.estado === "por_confirmar_cod") {
    actual = (await confirmarAdelantoPedido(pedido, quien)).pedido;
  } else {
    const producto = pedido.items?.[0]?.titulo || "Pedido Aliv";
    await sincronizarEtapaPipeline(
      pedido.contactId,
      "confirmado",
      `${pedido.numeroOrden} · ${producto}`,
      Number(pedido.total) || 0,
      pedido.id,
      pedido.dealId
    );
  }

  const hora = new Date().toLocaleString("es-PE", { timeZone: "America/Lima", dateStyle: "short", timeStyle: "short" });
  const marca = `${MARCA_VALIDADO} ${tipo === "yape" ? "Yape" : "Dirección"} validado por ${quien} el ${hora}.`;
  await db
    .update(pedidosOrdenes)
    .set({ notas: [actual.notas, marca].filter(Boolean).join("\n"), updatedAt: new Date() })
    .where(eq(pedidosOrdenes.id, pedido.id));
  await db.insert(activities).values({
    type: "note",
    description: `${marca} Pedido ${pedido.numeroOrden} pasó a «Pedido confirmado (por despachar)».`,
    contactId: pedido.contactId,
    dealId: pedido.dealId,
  });

  // Mensaje al cliente. Si la ventana de 24 h está cerrada o falla el canal, la validación
  // igual queda hecha y la tarjeta avisa que no salió el mensaje.
  let mensajeEnviado = false;
  const [conv] = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(eq(conversations.contactId, pedido.contactId))
    .orderBy(desc(conversations.lastMessageAt))
    .limit(1);
  if (conv) {
    const r = await deliverMessage(conv.id, { text: mensajeValidado(mostrarNumeroOrden(pedido.numeroOrden)) }, "human").catch(
      () => null
    );
    mensajeEnviado = Boolean(r?.ok);
  }

  return NextResponse.json({ ok: true, tipo, mensajeEnviado });
}
