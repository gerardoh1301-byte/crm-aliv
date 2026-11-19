import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { activities, contacts, conversations, teamMembers } from "@/db/schema";
import { pedidosOrdenes } from "../../../../../modules/pedidos/tabla";
import { and, eq } from "drizzle-orm";
import { autorizadoPorSecreto } from "@/lib/secreto-worker";
import { requireAdmin } from "@/lib/api-auth";
import { crearOrdenAgenciaGuiaPropiaShalom } from "@/lib/aliclik/api-client";
import { notificarCambioDealAlErp } from "@/lib/finanzas/notificar-erp";
import { notificarSupervisoresCritico } from "@/lib/alerts/supervisor-alerts";
import { notifyMember } from "@/lib/notifications";

export const dynamic = "force-dynamic";

async function autorizar(req: NextRequest): Promise<NextResponse | null> {
  if (autorizadoPorSecreto(req)) return null;
  const auth = await requireAdmin();
  if ("response" in auth) return auth.response;
  return null;
}

/**
 * POST /api/shalom-pro/completar
 *
 * Recibe los datos obtenidos de Shalom PRO (orden, código, clave de 4 dígitos y
 * enlace del PDF subido a Drive "preguias shalom"):
 * 1. Guarda N° orden, código y clave en Pipeline CRM (`pedidos_ordenes`).
 * 2. Registra el pedido en AliClik bajo modalidad:
 *    - Almacén WANKLIC GROUP 2 (Prepara y lleva a la agencia)
 *    - "Yo genero mi guía en Shalom PRO"
 *    - Tipo de pago: Parcial · Caja Paquete XS
 * 3. Sincroniza en tiempo real con ERP Finanzas.
 * 4. Lanza alerta inmediata a supervisores (WhatsApp + campanita CRM) para que
 *    verifiquen que todo esté correcto y procedan con el pago de almacén.
 */
export async function POST(req: NextRequest) {
  const denied = await autorizar(req);
  if (denied) return denied;

  try {
    const body = (await req.json()) as {
      pedidoId: string;
      numeroOrdenShalom: string;
      codigoShalom: string;
      claveRetiro: string;
      driveFileName?: string;
      driveFileUrl?: string;
      aliclikOrdenManual?: string;
      registrarEnAliclik?: boolean;
    };

    if (!body?.pedidoId || !body?.numeroOrdenShalom || !body?.codigoShalom || !body?.claveRetiro) {
      return NextResponse.json(
        { ok: false, error: "pedidoId, numeroOrdenShalom, codigoShalom y claveRetiro son obligatorios" },
        { status: 400 }
      );
    }

    const [pedido] = await db
      .select()
      .from(pedidosOrdenes)
      .where(eq(pedidosOrdenes.id, body.pedidoId))
      .limit(1);

    if (!pedido) {
      return NextResponse.json({ ok: false, error: "Pedido no encontrado" }, { status: 404 });
    }

    // Q1: Idempotencia estricta — si ya tiene guía o marca de registro previo, no duplicar orden en AliClik ni alertas
    const notasPrevias = pedido.notas || "";
    const matchAliExistente = notasPrevias.match(/\[ALICLIK_WANKLIC_ORDEN:([^\]]+)\]/i);
    if (
      pedido.numeroGuia ||
      notasPrevias.includes("[SHALOM_PRO_REGISTRADO:") ||
      Boolean(matchAliExistente)
    ) {
      return NextResponse.json({
        ok: true,
        duplicado: true,
        pedido,
        aliclikOrderNumber: matchAliExistente?.[1]?.trim() || null,
        supervisoresNotificados: 0,
      });
    }

    const [contacto] = await db
      .select()
      .from(contacts)
      .where(eq(contacts.id, pedido.contactId))
      .limit(1);

    const [conv] = await db
      .select({ id: conversations.id })
      .from(conversations)
      .where(eq(conversations.contactId, pedido.contactId))
      .limit(1);

    const guiaLimpia = String(body.numeroOrdenShalom).trim();
    const codigoLimpio = String(body.codigoShalom).trim().toUpperCase();
    const claveLimpia = String(body.claveRetiro).replace(/\D/g, "").slice(0, 4);

    // 1. Registrar en AliClik (WANKLIC GROUP 2 + Yo genero mi guía en Shalom PRO) si corresponde
    let aliclikOrderNumber: string | null = body.aliclikOrdenManual || null;
    let aliclikError: string | null = null;

    if (body.registrarEnAliclik !== false && !aliclikOrderNumber) {
      try {
        const rawItems = Array.isArray(pedido.items)
          ? (pedido.items as unknown as Array<Record<string, unknown>>)
          : [];
        const productos = rawItems.length
          ? rawItems.map((it) => ({
              nombre: String(it.titulo || it.nombre || it.producto || "NAC600"),
              cantidad: Number(it.cantidad || 1),
              precioUnitario: Number(it.precio || it.precioUnitario || 0),
            }))
          : [{ nombre: "NAC600", cantidad: 1, precioUnitario: Number(pedido.total) || 199 }];

        const resAli = await crearOrdenAgenciaGuiaPropiaShalom({
          clienteNombre: contacto?.name || "Cliente Aliv",
          clienteTelefono: contacto?.phone || "",
          clienteDni: pedido.dniCliente || "",
          departamento: pedido.ciudad || "",
          distrito: pedido.distrito || "",
          agenciaShalomNombre: pedido.direccionEnvio || pedido.ciudad || "",
          productos,
          total: Number(pedido.total) || 199,
          claveRetiro: claveLimpia,
          numeroOrdenShalom: guiaLimpia,
          codigoShalom: codigoLimpio,
          guiaShalomUrl: body.driveFileUrl,
        });
        aliclikOrderNumber = resAli.orderNumber;
      } catch (errAli) {
        aliclikError = errAli instanceof Error ? errAli.message : String(errAli);
        console.error("[shalom-pro/completar] Error registrando en AliClik:", aliclikError);
      }
    }

    // 2. Actualizar pedido en Pipeline CRM (N° orden, código, clave y marcas)
    const marcasNuevas = [
      `[SHALOM_PRO_REGISTRADO:${guiaLimpia}|COD:${codigoLimpio}|CLAVE:${claveLimpia}]`,
      body.driveFileUrl ? `[DRIVE_PREGUIA:${body.driveFileUrl}]` : null,
      aliclikOrderNumber ? `[ALICLIK_WANKLIC_ORDEN:${aliclikOrderNumber}]` : null,
    ]
      .filter(Boolean)
      .join("\n");

    const notasActualizadas = [pedido.notas, marcasNuevas].filter(Boolean).join("\n");

    const [actualizado] = await db
      .update(pedidosOrdenes)
      .set({
        numeroGuia: guiaLimpia,
        codigoRastreo: codigoLimpio,
        claveRecojo: claveLimpia,
        transportadora: "Shalom",
        notas: notasActualizadas,
        updatedAt: new Date(),
      })
      .where(eq(pedidosOrdenes.id, pedido.id))
      .returning();

    // 3. Registrar actividad
    await db.insert(activities).values({
      type: "note",
      description:
        `[SHALOM PRO + WANKLIC] Preguía generada automáticamente · Orden Shalom: ${guiaLimpia} · Código: ${codigoLimpio} · Clave: ${claveLimpia}` +
        (body.driveFileName ? ` · Drive: ${body.driveFileName}` : "") +
        (aliclikOrderNumber ? ` · AliClik (WANKLIC GROUP 2): ${aliclikOrderNumber}` : "") +
        (aliclikError ? ` · ⚠️ Error AliClik: ${aliclikError}` : ""),
      contactId: pedido.contactId,
      dealId: pedido.dealId,
    });

    // 4. Sincronizar con ERP Finanzas en tiempo real
    if (pedido.dealId) {
      notificarCambioDealAlErp(pedido.dealId).catch(() => {});
    }

    // 5. Alerta inmediata a supervisores (WhatsApp + campanita CRM) para verificar y pagar almacén
    const detalleAlerta =
      `Pedido ${pedido.numeroOrden} registrado en Shalom PRO y AliClik (Almacén WANKLIC GROUP 2 · Guía propia · Parcial · Caja Paquete XS).\n` +
      `• Orden Shalom: ${guiaLimpia} | Código: ${codigoLimpio} | Clave 4 dígitos: ${claveLimpia}\n` +
      (aliclikOrderNumber ? `• Orden AliClik: ${aliclikOrderNumber}\n` : "") +
      (body.driveFileUrl ? `• Preguía Drive: ${body.driveFileUrl}\n` : "") +
      (aliclikError ? `• ⚠️ Revisar registro AliClik: ${aliclikError}\n` : "") +
      `✅ Por favor verificar que todos los datos estén correctos y proceder con el *PAGO DE ALMACÉN*.`;

    const supRes = await notificarSupervisoresCritico({
      tipo: "shalom_preguia_pago_almacen",
      titulo: `Preguía lista · Pagar almacén (${pedido.numeroOrden})`,
      detalle: detalleAlerta,
      clienteNombre: contacto?.name,
      clienteTelefono: contacto?.phone,
      contactId: pedido.contactId,
      conversationId: conv?.id ?? null,
    });

    const admins = await db
      .select({ id: teamMembers.id })
      .from(teamMembers)
      .where(and(eq(teamMembers.role, "admin"), eq(teamMembers.active, true)));

    for (const admin of admins) {
      await notifyMember({
        memberId: admin.id,
        kind: "shalom_preguia_pago_almacen",
        title: `📦 Preguía Shalom lista (${pedido.numeroOrden}) · Pagar almacén`,
        body: `${contacto?.name || "Cliente"} · Shalom ${guiaLimpia} (${codigoLimpio}) · Clave ${claveLimpia}${aliclikOrderNumber ? ` · AliClik ${aliclikOrderNumber}` : ""}. Verificar y proceder con pago de almacén.`,
        url: conv?.id ? `/conversations/${conv.id}` : "/pipeline",
        contactId: pedido.contactId,
        tag: `shalom-preguia-${pedido.id}`,
      }).catch(() => {});
    }

    return NextResponse.json({
      ok: true,
      pedido: actualizado,
      aliclikOrderNumber,
      aliclikError,
      supervisoresNotificados: supRes.notificados,
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Error completando flujo Shalom PRO" },
      { status: 500 }
    );
  }
}
