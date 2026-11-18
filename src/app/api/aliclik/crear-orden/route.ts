import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { deals, contacts, activities } from "@/db/schema";
import { eq } from "drizzle-orm";
import { crearOrdenAgenciaServicioCompleto } from "@/lib/aliclik/api-client";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      dealId,
      contactId,
      clienteNombre,
      clienteTelefono,
      clienteDni,
      departamento,
      provincia,
      distrito,
      agenciaShalomNombre,
      productos,
      total,
      nota,
    } = body;

    if (!clienteNombre || !clienteTelefono || !agenciaShalomNombre) {
      return NextResponse.json(
        { ok: false, error: "Faltan datos obligatorios: Nombre, Teléfono o Agencia Shalom" },
        { status: 400 }
      );
    }

    const items = Array.isArray(productos) && productos.length > 0
      ? productos
      : [{ nombre: "NAC600", cantidad: 1, precioUnitario: Number(total) || 119 }];

    // 1. Crear la orden en AliClik con servicio completo (Alidriver lleva a Shalom y AliClik genera guía/rótulo)
    const resultAliclik = await crearOrdenAgenciaServicioCompleto({
      clienteNombre,
      clienteTelefono,
      clienteDni,
      departamento,
      provincia,
      distrito,
      agenciaShalomNombre,
      productos: items,
      total: Number(total) || 119,
      nota,
    });

    const ordenAliClik = resultAliclik.orderNumber;

    // 2. Registrar en el CRM
    if (dealId) {
      // Actualizar el Deal con el número de orden de AliClik y nota
      await db
        .update(deals)
        .set({
          notes: `[AliClik Despacho Auto] Orden ${ordenAliClik} creada con Alidriver y Servicio Completo Shalom.`,
          updatedAt: new Date(),
        })
        .where(eq(deals.id, dealId));
    }

    if (contactId) {
      // Registrar actividad en el historial del contacto
      await db.insert(activities).values({
        contactId,
        dealId: dealId || null,
        type: "note",
        description: `🚀 [AliClik Despacho Auto] Orden ${ordenAliClik} creada con modalidad 'Lo hace AliClik (Servicio completo)' y Courier Alidriver. AliClik generará la guía en Shalom PRO y rotulará el paquete. Destino: ${agenciaShalomNombre}. DNI: ${clienteDni || "No indicado"}.`,
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
