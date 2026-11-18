import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { contacts, deals } from "@/db/schema";
import { pedidosOrdenes } from "@modules/pedidos/tabla";
import { eq } from "drizzle-orm";
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

  // 2. Actualizar pedidos_ordenes asociados al contacto
  const direccionFinal = nuevaAgencia || nuevaDireccion || (customFieldsActualizados.direccion_envio as string) || null;
  const dniFinal = nuevoDni || (customFieldsActualizados.dni_ruc as string) || null;
  const ciudadFinal = nuevaCiudad || (customFieldsActualizados.departamento_ciudad as string) || null;
  const distritoFinal = nuevoDistrito || (customFieldsActualizados.distrito as string) || null;

  await db
    .update(pedidosOrdenes)
    .set({
      direccionEnvio: direccionFinal,
      dniCliente: dniFinal,
      ciudad: ciudadFinal,
      distrito: distritoFinal,
      updatedAt: new Date(),
    })
    .where(eq(pedidosOrdenes.contactId, id));

  return NextResponse.json({
    success: true,
    contact: contactoActualizado,
    direccionFinal,
    dniFinal,
    ciudadFinal,
  });
}
