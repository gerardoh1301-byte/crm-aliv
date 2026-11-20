import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { contacts, deals, activities, teamMembers, pipelineStages } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { requireMember } from "@/lib/api-auth";
import { camposContacto } from "@/lib/config";
import { validarCamposPersonalizados } from "@/lib/config/campos";
import { canAccessContact } from "@/lib/team";
import { assignContact } from "@/lib/contacts/assign";
import { purgeContactDocuments } from "@/lib/documents";
import { setDealStage } from "@/lib/deals/stage";
import { obtenerClaveEtapaDeEtiqueta } from "@/lib/tags";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireMember();
  if ("response" in auth) return auth.response;
  const { id } = await params;

  const contactRows = await db
    .select()
    .from(contacts)
    .where(eq(contacts.id, id))
    .limit(1);
  const contact = contactRows[0];

  // 404 tambien para lo ajeno: no confirmar que existe.
  if (!contact || !canAccessContact(auth.member, contact)) {
    return NextResponse.json(
      { error: "Contacto no encontrado" },
      { status: 404 }
    );
  }

  const [owner] = contact.ownerId
    ? await db
        .select({ id: teamMembers.id, name: teamMembers.name, email: teamMembers.email })
        .from(teamMembers)
        .where(eq(teamMembers.id, contact.ownerId))
        .limit(1)
    : [];

  const contactDeals = await db
    .select()
    .from(deals)
    .where(eq(deals.contactId, id));

  const contactActivities = await db
    .select()
    .from(activities)
    .where(eq(activities.contactId, id));

  return NextResponse.json({
    ...contact,
    owner: owner ?? null,
    deals: contactDeals,
    activities: contactActivities,
  });
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireMember();
  if ("response" in auth) return auth.response;
  const { id } = await params;

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON invalido" }, { status: 400 });
  }

  const existingRows = await db
    .select()
    .from(contacts)
    .where(eq(contacts.id, id))
    .limit(1);
  const existing = existingRows[0];

  if (!existing || !canAccessContact(auth.member, existing)) {
    return NextResponse.json(
      { error: "Contacto no encontrado" },
      { status: 404 }
    );
  }

  // El propietario va por `assignContact`: es lo que emite el evento de la
  // automatizacion. Solo el admin reasigna; un asesor no puede regalar ni robar.
  if (body.ownerId !== undefined) {
    if (auth.member.role !== "admin") {
      return NextResponse.json(
        { error: "Solo un administrador puede cambiar el propietario" },
        { status: 403 }
      );
    }
    const result = await assignContact({
      contactId: id,
      ownerId: body.ownerId || null,
      by: { type: "member", member: auth.member },
    });
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
  }

  // Only allow updating specific fields
  const updateData: Record<string, unknown> = { updatedAt: new Date() };
  if (body.name !== undefined) updateData.name = body.name;
  if (body.email !== undefined) updateData.email = body.email;
  if (body.phone !== undefined) updateData.phone = body.phone;
  if (body.company !== undefined) updateData.company = body.company;
  if (body.source !== undefined) updateData.source = body.source;
  if (body.score !== undefined) updateData.score = Math.max(0, Math.min(100, body.score));
  if (body.notes !== undefined) updateData.notes = body.notes;
  if (body.tags !== undefined) {
    updateData.tags = Array.isArray(body.tags)
      ? body.tags
          .map((t: unknown) => (typeof t === "string" ? t.trim() : ""))
          .filter((t: string) => t.length > 0)
      : [];
  }
  if (body.customFields !== undefined) {
    // El formulario de edicion reenvia la ficha entera, incluidos datos internos que
    // escribe el sistema (abandono, agencia_shalom, guia_shalom...). Si llegan sin
    // cambios se ignoran; si alguien intenta cambiarlos, la validacion los rechaza.
    const guardados = (existing.customFields as Record<string, unknown> | null) ?? {};
    const conocidas = new Set(camposContacto().map((c) => c.clave));
    const entrada =
      body.customFields && typeof body.customFields === "object" && !Array.isArray(body.customFields)
        ? Object.fromEntries(
            Object.entries(body.customFields as Record<string, unknown>).filter(
              ([k, v]) => conocidas.has(k) || JSON.stringify(v) !== JSON.stringify(guardados[k])
            )
          )
        : body.customFields;
    // Parcial: se mezclan con lo guardado, solo se validan las claves que vienen.
    const campos = validarCamposPersonalizados(camposContacto(), entrada, { parcial: true });
    if (!campos.ok) {
      return NextResponse.json({ error: campos.error }, { status: 400 });
    }
    updateData.customFields = {
      ...((existing.customFields as Record<string, unknown> | null) ?? {}),
      ...campos.valores,
    };
  }

  const resultRows = await db
    .update(contacts)
    .set(updateData)
    .where(eq(contacts.id, id))
    .returning();
  const result = resultRows[0];

  // Si se actualizan etiquetas y contiene una etiqueta de etapa (ej. "Orden en camino"),
  // sincronizar automáticamente el deal del pipeline a dicha etapa
  if (body.tags !== undefined && Array.isArray(body.tags)) {
    for (const t of body.tags) {
      if (typeof t !== "string") continue;
      const claveEtapa = obtenerClaveEtapaDeEtiqueta(t);
      if (claveEtapa) {
        const [stageRow] = await db
          .select({ id: pipelineStages.id })
          .from(pipelineStages)
          .where(eq(pipelineStages.key, claveEtapa))
          .limit(1);

        if (stageRow) {
          // Solo la tarjeta de venta: nunca la de posventa (antes la movía a "Entregado y
          // Cobrado" y eso creaba una segunda tarjeta de posventa).
          const candidatas = await db
            .select({ id: deals.id, stageId: deals.stageId, title: deals.title, stageKey: pipelineStages.key })
            .from(deals)
            .innerJoin(pipelineStages, eq(deals.stageId, pipelineStages.id))
            .where(eq(deals.contactId, id))
            .orderBy(desc(deals.updatedAt))
            .limit(10);
          const dealRow = candidatas.find(
            (d) => !/^postventa\b/i.test(d.title || "") && !(d.stageKey || "").startsWith("postventa")
          );

          if (dealRow && dealRow.stageId !== stageRow.id) {
            await setDealStage({ dealId: dealRow.id, stageId: stageRow.id });
          }
        }
        break;
      }
    }
  }

  return NextResponse.json(result);
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireMember();
  if ("response" in auth) return auth.response;
  const { id } = await params;

  const existingRows = await db
    .select()
    .from(contacts)
    .where(eq(contacts.id, id))
    .limit(1);
  const existing = existingRows[0];

  if (!existing || !canAccessContact(auth.member, existing)) {
    return NextResponse.json(
      { error: "Contacto no encontrado" },
      { status: 404 }
    );
  }

  // Los archivos del bucket no se van por cascade: primero ellos, despues la fila.
  await purgeContactDocuments(id);
  await db.delete(contacts).where(eq(contacts.id, id));
  return NextResponse.json({ success: true });
}
