import "server-only";
import { db } from "@/db";
import { sql } from "drizzle-orm";
import type { TeamMember } from "@/lib/team";
import { descripcionLlamadaWhatsApp, quienLlamo, TIPO_LLAMADA_WHATSAPP } from "@/lib/llamada-whatsapp";

export interface LlamadaRegistrada {
  /** ISO, hora del clic. */
  fecha: string;
  quien: string;
  contacto: string;
  telefono: string | null;
}

/** Clics en «Llamar» (WhatsApp Web) del periodo, más recientes primero. El asesor ve solo los de sus contactos. */
export async function llamadasWhatsApp(member: TeamMember, dias: number): Promise<LlamadaRegistrada[]> {
  const desdeIso = new Date(Date.now() - dias * 86_400_000).toISOString();
  const owner = member.role === "admin" ? sql`` : sql`and ct.owner_id = ${member.id}`;
  const filas = (await db.execute(sql`
    select a.created_at as fecha, a.description as descripcion, ct.name as contacto, ct.phone as telefono
    from activities a join contacts ct on ct.id = a.contact_id
    where a.type = ${TIPO_LLAMADA_WHATSAPP} and a.created_at >= ${desdeIso}::timestamptz ${owner}
    order by a.created_at desc
    limit 500`)) as unknown as Array<Record<string, unknown>>;
  return filas.map((r) => ({
    fecha: new Date(String(r.fecha)).toISOString(),
    quien: quienLlamo(String(r.descripcion ?? "")),
    contacto: String(r.contacto ?? "—"),
    telefono: r.telefono ? String(r.telefono) : null,
  }));
}

/** Clics en «Llamar» hechos por este miembro: hoy (día de Lima) y últimos 7 días. */
export async function misLlamadasWhatsApp(member: TeamMember): Promise<{ hoy: number; semana: number }> {
  const desc = descripcionLlamadaWhatsApp(member.name || member.email);
  const [fila] = (await db.execute(sql`
    select
      count(*) filter (where (a.created_at at time zone 'America/Lima')::date = (now() at time zone 'America/Lima')::date) as hoy,
      count(*) as semana
    from activities a
    where a.type = ${TIPO_LLAMADA_WHATSAPP} and a.description = ${desc}
      and a.created_at >= now() - interval '7 days'`)) as unknown as Array<Record<string, unknown>>;
  return { hoy: Number(fila?.hoy ?? 0), semana: Number(fila?.semana ?? 0) };
}
