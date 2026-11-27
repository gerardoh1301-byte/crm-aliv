import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api-auth";
import { db } from "@/db";
import { deals, activities } from "@/db/schema";
import { desc, eq } from "drizzle-orm";
import { crearOrdenAgenciaServicioCompleto } from "@/lib/aliclik/api-client";
import { pedidosOrdenes } from "../../../../../modules/pedidos/tabla";
import {
  validarDepartamentoODestino,
  validarTelefonoPeruano,
} from "@/lib/pedidos/validacion-datos";

export function extraerOrdenAliclikPrevia(
  notasDeal?: string | null,
  notasPedido?: string | null
): string | null {
  const texto = `${notasDeal ?? ""}\n${notasPedido ?? ""}`;
  const m1 = texto.match(/\[ALICLIK_ORDEN:([^\]]+)\]/i);
  if (m1?.[1]) return m1[1].trim();
  const m2 = texto.match(/\[AliClik Despacho Auto\]\s*Orden\s+([A-Za-z0-9_-]+)/i);
  if (m2?.[1]) return m2[1].trim();
  return null;
}

export function agregarNotaSinBorrar(
  notasPrevias: string | null | undefined,
  nuevaNota: string
): string {
  const prev = (notasPrevias ?? "").trim();
  const nueva = nuevaNota.trim();
  if (!prev) return nueva;
  if (prev.includes(nueva)) return prev;
  return `${prev}\n${nueva}`;
}

export async function POST(req: NextRequest) {
  // 24/11 (auditoría CRM-03): solo un miembro con sesión válida puede despachar
  const auth = await requireAdmin();
  if ("response" in auth) return auth.response;
  if (process.env.ALICLIK_DESPACHO_ENABLED !== "true") {
    return NextResponse.json(
      {
        ok: false,
        error: "Registro automático por AliClik desactivado por decisión logística.",
      },
      { status: 410 }
    );
  }
  try {
    const body = await req.json();
    const {
      dealId,
      contactId,
      pedidoId,
      clienteNombre,
      clienteTelefono,
      clienteDni,
      departamento,
      provincia,
      distrito,
      agenciaShalomNombre,
      agenciaShalomDireccion,
      dropShalomId,
      fechaEnvio,
      tipoMercancia,
      productos,
      total,
      nota,
    } = body;

    if (!clienteNombre || !clienteTelefono || !agenciaShalomNombre) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Faltan datos obligatorios: Nombre, Teléfono o Agencia Shalom",
        },
        { status: 400 }
      );
    }

    // M2: Validar teléfono peruano (9 dígitos empezando con 9)
    const checkTel = validarTelefonoPeruano(clienteTelefono);
    if (!checkTel.valido) {
      return NextResponse.json(
        { ok: false, error: checkTel.error },
        { status: 400 }
      );
    }

    // M2: Validar departamento o destino si se envía
    const destinoEval = departamento || provincia || distrito;
    if (destinoEval) {
      const checkDep = validarDepartamentoODestino(destinoEval);
      if (!checkDep.valido) {
        return NextResponse.json(
          { ok: false, error: checkDep.error },
          { status: 400 }
        );
      }
    }

    // A10: Prohibido suponer productos ("NAC600 x1, S/119") si no llegan productos válidos
    if (!Array.isArray(productos) || productos.length === 0) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Faltan los productos del pedido. No se puede asumir un producto por defecto.",
        },
        { status: 400 }
      );
    }

    const items = productos
      .map((p: any) => ({
        nombre: String(p?.nombre || p?.titulo || "").trim(),
        cantidad: Number(p?.cantidad) || 0,
        precioUnitario: Number(p?.precioUnitario ?? p?.precio) || 0,
      }))
      .filter((p) => p.nombre.length > 0 && p.cantidad > 0);

    if (items.length === 0) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Los productos enviados no son válidos (nombre y cantidad mayor a 0 son obligatorios).",
        },
        { status: 400 }
      );
    }

    // A10: Verificar idempotencia (si la operación o el pedido ya tienen orden en AliClik, rechazar)
    let dealActual: { id: string; title: string | null; notes: string | null } | null = null;
    if (dealId) {
      const [d] = await db
        .select({ id: deals.id, title: deals.title, notes: deals.notes })
        .from(deals)
        .where(eq(deals.id, dealId))
        .limit(1);
      dealActual = d ?? null;
    }

    let pedidoActual: {
      id: string;
      notas: string | null;
      items: unknown;
      total: string | null;
    } | null = null;
    if (pedidoId) {
      const [p] = await db
        .select({
          id: pedidosOrdenes.id,
          notas: pedidosOrdenes.notas,
          items: pedidosOrdenes.items,
          total: pedidosOrdenes.total,
        })
        .from(pedidosOrdenes)
        .where(eq(pedidosOrdenes.id, pedidoId))
        .limit(1);
      pedidoActual = p ?? null;
    } else if (dealId) {
      const [p] = await db
        .select({
          id: pedidosOrdenes.id,
          notas: pedidosOrdenes.notas,
          items: pedidosOrdenes.items,
          total: pedidosOrdenes.total,
        })
        .from(pedidosOrdenes)
        .where(eq(pedidosOrdenes.dealId, dealId))
        .orderBy(desc(pedidosOrdenes.createdAt))
        .limit(1);
      pedidoActual = p ?? null;
    } else if (contactId) {
      const [p] = await db
        .select({
          id: pedidosOrdenes.id,
          notas: pedidosOrdenes.notas,
          items: pedidosOrdenes.items,
          total: pedidosOrdenes.total,
        })
        .from(pedidosOrdenes)
        .where(eq(pedidosOrdenes.contactId, contactId))
        .orderBy(desc(pedidosOrdenes.createdAt))
        .limit(1);
      pedidoActual = p ?? null;
    }

    const ordenExistente = extraerOrdenAliclikPrevia(
      dealActual?.notes,
      pedidoActual?.notas
    );
    if (ordenExistente) {
      return NextResponse.json(
        {
          ok: false,
          ordenAliClik: ordenExistente,
          error: `Esta operación ya tiene la orden ${ordenExistente} registrada en AliClik. Se bloqueó el reintento para evitar duplicar el despacho.`,
        },
        { status: 409 }
      );
    }

    const montoTotal =
      Number(total) > 0
        ? Number(total)
        : items.reduce((acc, it) => acc + it.cantidad * it.precioUnitario, 0);

    // Validación cruzada de seguridad contra el pedido real en BD para evitar enviar NAC600 x1 cuando el pedido es Termix x2
    const dbItems = Array.isArray(pedidoActual?.items)
      ? (pedidoActual.items as Array<{ titulo?: string; cantidad?: number }>)
      : [];
    const textoPedidoBD = `${dbItems.map((i) => i.titulo || "").join(" ")} ${dealActual?.title || ""}`.toLowerCase();
    const esTermixEnBD =
      textoPedidoBD.includes("termix") ||
      textoPedidoBD.includes("tobill") ||
      Math.round(montoTotal) === 79 ||
      Math.round(montoTotal) === 139;

    const itemsVerificados = items.map((it) => {
      let nombre = it.nombre;
      let cantidad = it.cantidad;
      // Si el pedido en BD es Termix Tobillera pero el cliente envió NAC600 por error de fallback, corregirlo
      if (esTermixEnBD && !/termix|tobill/i.test(nombre)) {
        nombre = "TERMIX TOBILLERA";
      }
      // Si vino cantidad 1 pero en BD tiene más unidades o el monto corresponde a un pack
      const cantBD = dbItems.reduce((acc, d) => acc + (Number(d.cantidad) || 0), 0);
      if (cantidad === 1) {
        if (cantBD > 1) {
          cantidad = cantBD;
        } else if (/termix|tobill/i.test(nombre)) {
          if (Math.round(montoTotal) === 139) cantidad = 2;
          else if (Math.round(montoTotal) === 189) cantidad = 3;
        } else {
          if (Math.round(montoTotal) === 199) cantidad = 3;
          else if (Math.round(montoTotal) === 189) cantidad = 2;
        }
      }
      return {
        nombre,
        cantidad,
        precioUnitario:
          cantidad > 0 ? Math.round((montoTotal / cantidad) * 100) / 100 : montoTotal,
      };
    });

    // 1. Crear la orden en AliClik con servicio completo
    const resultAliclik = await crearOrdenAgenciaServicioCompleto({
      clienteNombre,
      clienteTelefono: checkTel.telefono9Digitos || clienteTelefono,
      clienteDni,
      departamento,
      provincia,
      distrito,
      agenciaShalomNombre,
      agenciaShalomDireccion,
      dropShalomId: Number(dropShalomId) || undefined,
      fechaEnvio,
      tipoMercancia: tipoMercancia || "Caja Paquete XS",
      productos: itemsVerificados,
      total: montoTotal,
      nota,
    });

    const ordenAliClik = resultAliclik.orderNumber;
    const nuevaNotaDeal = `[AliClik Despacho Auto] Orden ${ordenAliClik} creada con Alidriver y Servicio Completo Shalom. [ALICLIK_ORDEN:${ordenAliClik}]`;

    // 2. Registrar en el Deal agregando la nota SIN borrar las anteriores (A10)
    if (dealActual) {
      await db
        .update(deals)
        .set({
          notes: agregarNotaSinBorrar(dealActual.notes, nuevaNotaDeal),
          updatedAt: new Date(),
        })
        .where(eq(deals.id, dealActual.id));
    }

    // 3. Guardar el número de orden de AliClik en el pedido (A10)
    if (pedidoActual) {
      await db
        .update(pedidosOrdenes)
        .set({
          notas: agregarNotaSinBorrar(
            pedidoActual.notas,
            `[ALICLIK_ORDEN:${ordenAliClik}] Despachado con AliClik (${agenciaShalomNombre})`
          ),
          updatedAt: new Date(),
        })
        .where(eq(pedidosOrdenes.id, pedidoActual.id));
    }

    if (contactId) {
      await db.insert(activities).values({
        contactId,
        dealId: dealId || null,
        type: "note",
        description: `🚀 [AliClik Despacho Auto] Orden ${ordenAliClik} creada con modalidad 'Lo hace AliClik (Servicio completo)' y Courier Alidriver. Destino: ${agenciaShalomNombre}. DNI: ${clienteDni || "No indicado"}.`,
        createdAt: new Date(),
      });
    }

    return NextResponse.json({
      ok: true,
      ordenAliClik,
      mensaje: `¡Orden ${ordenAliClik} registrada con éxito en AliClik! Ellos se encargarán del rotulado y de llevar el paquete a Shalom.`,
    });
  } catch (error: any) {
    console.error("Error en /api/aliclik/crear-orden:", error);
    return NextResponse.json(
      { ok: false, error: error.message || "Error al registrar en AliClik" },
      { status: 500 }
    );
  }
}
