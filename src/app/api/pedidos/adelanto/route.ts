import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { activities, contacts, conversations } from "@/db/schema";
import { and, desc, eq, inArray } from "drizzle-orm";
import { requireMember } from "@/lib/api-auth";
import { canAccessContactId, displayName } from "@/lib/team";
import { pedidosOrdenes } from "../../../../../modules/pedidos/tabla";
import { sincronizarEtapaPipeline } from "../../../../../modules/pedidos/servidor";
import { adelantoRegistrado, esPedidoDeProvincia } from "@/lib/pedidos/adelanto";

/**
 * "Adelanto confirmado" (semiautomatico) para pedidos de provincia por Shalom.
 *
 * GET  ?contactId=  -> pedidos abiertos del contacto, marcando cuales son de provincia.
 * POST { pedidoId } -> una PERSONA confirma que verifico el Yape de S/20: queda registrado
 *                      quien y cuando, el pedido pasa a "confirmado" y se cierra la alerta
 *                      "requiere humano" del chat. El registro en Shalom Pro y el envio del
 *                      mensaje se hacen despues con el modal de seguimiento de siempre.
 *
 * El bot nunca llama a esta ruta: el adelanto solo lo confirma una persona.
 */

export const dynamic = "force-dynamic";

const ESTADOS_ABIERTOS = ["por_confirmar_cod", "confirmado", "preparando"];


export async function GET(request: NextRequest) {
  const auth = await requireMember();
  if ("response" in auth) return auth.response;
  const contactId = request.nextUrl.searchParams.get("contactId");
  if (!contactId) return NextResponse.json({ error: "contactId es obligatorio" }, { status: 400 });
  if (!(await canAccessContactId(auth.member, contactId))) {
    return NextResponse.json({ error: "Sin acceso a este contacto" }, { status: 403 });
  }

  const filas = await db
    .select({
      id: pedidosOrdenes.id,
      numeroOrden: pedidosOrdenes.numeroOrden,
      dealId: pedidosOrdenes.dealId,
      estado: pedidosOrdenes.estado,
      items: pedidosOrdenes.items,
      total: pedidosOrdenes.total,
      dniCliente: pedidosOrdenes.dniCliente,
      ciudad: pedidosOrdenes.ciudad,
      distrito: pedidosOrdenes.distrito,
      direccionEnvio: pedidosOrdenes.direccionEnvio,
      numeroGuia: pedidosOrdenes.numeroGuia,
      codigoRastreo: pedidosOrdenes.codigoRastreo,
      claveRecojo: pedidosOrdenes.claveRecojo,
      notas: pedidosOrdenes.notas,
      createdAt: pedidosOrdenes.createdAt,
    })
    .from(pedidosOrdenes)
    .where(and(eq(pedidosOrdenes.contactId, contactId), inArray(pedidosOrdenes.estado, ESTADOS_ABIERTOS)))
    .orderBy(desc(pedidosOrdenes.createdAt))
    .limit(5);

  const [contacto] = await db
    .select({ name: contacts.name, phone: contacts.phone })
    .from(contacts)
    .where(eq(contacts.id, contactId))
    .limit(1);


  return NextResponse.json({
    contacto: contacto ?? null,
    pedidos: filas.map((p) => ({
      ...p,
      esProvincia: esPedidoDeProvincia(p),
      adelantoConfirmado: adelantoRegistrado(p.notas),
    })),
  });
}

export async function POST(request: NextRequest) {
  const auth = await requireMember();
  if ("response" in auth) return auth.response;
  const { member } = auth;

  const body = (await request.json().catch(() => null)) as { pedidoId?: string; soloDatos?: boolean; dni?: string } | null;
  if (!body?.pedidoId) return NextResponse.json({ error: "pedidoId es obligatorio" }, { status: 400 });

  const [pedido] = await db.select().from(pedidosOrdenes).where(eq(pedidosOrdenes.id, body.pedidoId)).limit(1);
  if (!pedido) return NextResponse.json({ error: "Pedido no encontrado" }, { status: 404 });
  if (!(await canAccessContactId(member, pedido.contactId))) {
    return NextResponse.json({ error: "Sin acceso a este contacto" }, { status: 403 });
  }

  // Guardar datos corregidos por el asesor (por ahora el DNI para la guia), sin confirmar nada.
  if (body.soloDatos) {
    const dni = String(body.dni ?? "").replace(/\D/g, "").slice(0, 12) || null;
    const [act] = await db
      .update(pedidosOrdenes)
      .set({ dniCliente: dni, updatedAt: new Date() })
      .where(eq(pedidosOrdenes.id, pedido.id))
      .returning();
    return NextResponse.json({ ok: true, pedido: act });
  }

  const ahora = new Date();
  const hora = ahora.toLocaleString("es-PE", { timeZone: "America/Lima", dateStyle: "short", timeStyle: "short" });
  const quien = displayName(member);
  const marca = `[ADELANTO VERIFICADO] S/20 verificado por ${quien} el ${hora}.`;

  const nuevoEstado = pedido.estado === "por_confirmar_cod" ? "confirmado" : pedido.estado;
  const [actualizado] = await db
    .update(pedidosOrdenes)
    .set({
      estado: nuevoEstado,
      modalidadPago: "adelanto_agencia",
      notas: pedido.notas?.includes("[ADELANTO VERIFICADO]") ? pedido.notas : [pedido.notas, marca].filter(Boolean).join("\n"),
      updatedAt: ahora,
    })
    .where(eq(pedidosOrdenes.id, pedido.id))
    .returning();

  if (nuevoEstado !== pedido.estado) {
    const primerProducto = (actualizado.items as Array<{ titulo?: string }>)?.[0]?.titulo || "Pedido Aliv";
    await sincronizarEtapaPipeline(
      actualizado.contactId,
      "confirmado",
      `${actualizado.numeroOrden} · ${primerProducto}`,
      Number(actualizado.total) || 0,
      actualizado.id,
      actualizado.dealId
    );
  }

  await db.insert(activities).values({
    type: "note",
    description: `${marca} Pedido ${actualizado.numeroOrden}. Siguiente paso: registrar el envío en Shalom Pro y enviar el seguimiento al cliente.`,
    contactId: actualizado.contactId,
    dealId: actualizado.dealId,
  });

  // La alerta "requiere humano" ya fue atendida. El bot sigue como este (no se toca aiEnabled).
  await db
    .update(conversations)
    .set({ needsHuman: false, needsHumanReason: null, needsHumanAt: null, updatedAt: ahora })
    .where(eq(conversations.contactId, actualizado.contactId));
  await db
    .update(contacts)
    .set({ needsHuman: false, needsHumanReason: null, needsHumanAt: null, updatedAt: ahora })
    .where(eq(contacts.id, actualizado.contactId));

  return NextResponse.json({ ok: true, pedido: actualizado });
}
