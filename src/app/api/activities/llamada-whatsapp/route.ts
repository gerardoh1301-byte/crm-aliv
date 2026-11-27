import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { activities, contacts } from "@/db/schema";
import { requireMember } from "@/lib/api-auth";
import { canAccessContact } from "@/lib/team";
import { descripcionLlamadaWhatsApp, TIPO_LLAMADA_WHATSAPP } from "@/lib/llamada-whatsapp";

/** Anota que alguien del equipo presionó «Llamar» (WhatsApp Web) en un contacto. */
export async function POST(request: NextRequest) {
  const auth = await requireMember();
  if ("response" in auth) return auth.response;

  let body: { contactId?: string; dealId?: string | null };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON invalido" }, { status: 400 });
  }
  if (!body.contactId) return NextResponse.json({ error: "Falta el contacto" }, { status: 400 });

  const [contacto] = await db
    .select({ id: contacts.id, ownerId: contacts.ownerId })
    .from(contacts)
    .where(eq(contacts.id, body.contactId))
    .limit(1);
  if (!contacto || !canAccessContact(auth.member, contacto)) {
    return NextResponse.json({ error: "Contacto no encontrado" }, { status: 404 });
  }

  await db.insert(activities).values({
    type: TIPO_LLAMADA_WHATSAPP,
    description: descripcionLlamadaWhatsApp(auth.member.name || auth.member.email),
    contactId: contacto.id,
    dealId: body.dealId || null,
    completedAt: new Date(),
    createdAt: new Date(),
  });
  return NextResponse.json({ ok: true }, { status: 201 });
}
