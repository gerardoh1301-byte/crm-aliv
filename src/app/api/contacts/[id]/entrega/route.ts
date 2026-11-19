import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { contacts, deals } from "@/db/schema";
import { pedidosOrdenes } from "@modules/pedidos/tabla";
import { and, desc, eq, notInArray } from "drizzle-orm";
import { requireMember } from "@/lib/api-auth";
import { canAccessContact } from "@/lib/team";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireMember();
  if ("response" in auth) return auth.response;
  const { id } = await params;

  let body: {
    agenciaShalom?: string;
    dni?: string;
    direccion?: string;
    ciudad?: string;
    distrito?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const [existing] = await db
    .select()
    .from(contacts)
    .where(eq(contacts.id, id))
    .limit(1);

  if (!existing || !canAccessContact(auth.member, existing)) {
    return NextResponse.json({ error: "Contacto no encontrado" }, { status: 404 });
  }

  const customFieldsActuales =
    (existing.customFields as Record<string, unknown> | null) ?? {};

  const nuevaAgencia = body.agenciaShalom?.trim() || "";
  const nuevoDni = body.dni?.trim() || "";
  const nuevaDireccion = body.direccion?.trim() || "";
  const nuevaCiudad = body.ciudad?.trim() || "";
  const nuevoDistrito = body.distrito?.trim() || "";

  const customFieldsActualizados: Record<string, unknown> = {
    ...customFieldsActuales,
  };

  if (nuevaAgencia) {
    customFieldsActualizados.agencia_shalom = nuevaAgencia;
    customFieldsActualizados.direccion_envio = nuevaAgencia;
  } else if (nuevaDireccion) {
    customFieldsActualizados.direccion_envio = nuevaDireccion;
  }

  if (nuevoDni) {
    customFieldsActualizados.dni_ruc = nuevoDni;
    customFieldsActualizados.dni = nuevoDni;
  }
  if (nuevaCiudad) {
    customFieldsActualizados.departamento_ciudad = nuevaCiudad;
  }
  if (nuevoDistrito) {
    customFieldsActualizados.distrito = nuevoDistrito;
  }

  // 1. Actualizar contacto
  const [contactoActualizado] = await db
    .update(contacts)
    .set({
      customFields: customFieldsActualizados,
      updatedAt: new Date(),
    })
    .where(eq(contacts.id, id))
    .returning();

  // 2. Actualizar ÚNICAMENTE el pedido activo/en curso asociado al contacto (R9: no compras pasadas ya entregadas ni canceladas)
  const direccionFinal = nuevaAgencia || nuevaDireccion || (customFieldsActualizados.direccion_envio as string) || null;
  const dniFinal = nuevoDni || (customFieldsActualizados.dni_ruc as string) || null;
  const ciudadFinal = nuevaCiudad || (customFieldsActualizados.departamento_ciudad as string) || null;
  const distritoFinal = nuevoDistrito || (customFieldsActualizados.distrito as string) || null;

  const [pedidoActivo] = await db
    .select({ id: pedidosOrdenes.id })
    .from(pedidosOrdenes)
    .where(
      and(
        eq(pedidosOrdenes.contactId, id),
        notInArray(pedidosOrdenes.estado, ["entregado", "cancelado"])
      )
    )
    .orderBy(desc(pedidosOrdenes.createdAt))
    .limit(1);

  if (pedidoActivo) {
    await db
      .update(pedidosOrdenes)
      .set({
        direccionEnvio: direccionFinal,
        dniCliente: dniFinal,
        ciudad: ciudadFinal,
        distrito: distritoFinal,
        updatedAt: new Date(),
      })
      .where(eq(pedidosOrdenes.id, pedidoActivo.id));
  }

  return NextResponse.json({
    success: true,
    contact: contactoActualizado,
    direccionFinal,
    dniFinal,
    ciudadFinal,
  });
}
