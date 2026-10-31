import { NextRequest, NextResponse } from "next/server";
import { and, eq, gt, sql } from "drizzle-orm";
import { db } from "@/db";
import { conversations, notifications, teamMembers } from "@/db/schema";
import { notifyMember } from "@/lib/notifications";
import { autorizadoPorSecreto } from "@/lib/secreto-worker";

export const dynamic = "force-dynamic";

/**
 * GET /api/alertas — barrido de chats sin respuesta (lo llama `barridos.ts`).
 *
 * El bot contesta en segundos, asi que un chat cuyo ultimo mensaje es del cliente y
 * lleva mas de ALERTA_SIN_RESPUESTA_MIN (60) minutos significa que algo fallo o que
 * espera a una persona. Avisa a los admins por la campanita y Web Push: gratis, a
 * diferencia de un WhatsApp al numero del dueno, que Meta cobra como plantilla.
 *
 * Una alerta por mensaje del cliente: si ya se aviso despues de su ultimo mensaje, no
 * se repite. Solo de 8:00 a 22:00 (Lima); lo de la noche sale en el primer barrido.
 */
const ZONA = "America/Lima";
const MAX_POR_BARRIDO = 10;

function horaLima(): number {
  return Number(
    new Intl.DateTimeFormat("en-US", { timeZone: ZONA, hour: "numeric", hour12: false }).format(new Date())
  );
}

export async function GET(request: NextRequest) {
  if (!autorizadoPorSecreto(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const hora = horaLima();
  if (hora < 8 || hora >= 22) {
    return NextResponse.json({ ok: true, omitido: "fuera de horario" });
  }

  const umbralMin = Number(process.env.ALERTA_SIN_RESPUESTA_MIN) || 60;
  const pendientes = await db
    .select({
      id: conversations.id,
      contactId: conversations.contactId,
      canal: conversations.channel,
      nombre: conversations.participantName,
      ultimo: conversations.lastMessageBody,
      ultimoEntrante: conversations.lastInboundAt,
    })
    .from(conversations)
    .where(
      and(
        eq(conversations.lastDirection, "in"),
        sql`${conversations.lastInboundAt} < now() - make_interval(mins => ${umbralMin}::int)`,
        sql`${conversations.lastInboundAt} > now() - interval '24 hours'`
      )
    )
    .limit(50);

  const admins = await db
    .select({ id: teamMembers.id })
    .from(teamMembers)
    .where(and(eq(teamMembers.role, "admin"), eq(teamMembers.active, true)));

  let enviadas = 0;
  for (const c of pendientes) {
    if (enviadas >= MAX_POR_BARRIDO || !c.ultimoEntrante) break;

    if (c.contactId) {
      const [yaAvisada] = await db
        .select({ id: notifications.id })
        .from(notifications)
        .where(
          and(
            eq(notifications.kind, "alerta_sin_respuesta"),
            eq(notifications.contactId, c.contactId),
            gt(notifications.createdAt, c.ultimoEntrante)
          )
        )
        .limit(1);
      if (yaAvisada) continue;
    }

    const minutos = Math.floor((Date.now() - c.ultimoEntrante.getTime()) / 60_000);
    const nombre = (c.nombre ?? "Cliente").trim().split(/\s+/)[0];
    for (const admin of admins) {
      await notifyMember({
        memberId: admin.id,
        kind: "alerta_sin_respuesta",
        title: `Chat sin respuesta hace ${minutos} min`,
        body: `${nombre} · ${c.canal}: "${(c.ultimo ?? "").slice(0, 80)}"`,
        url: `/conversations/${c.id}`,
        contactId: c.contactId,
        tag: `sin-respuesta-${c.id}`,
      }).catch((err) => console.warn("[alertas] no se pudo notificar:", err));
    }
    enviadas++;
  }

  return NextResponse.json({ ok: true, pendientes: pendientes.length, alertas: enviadas });
}
