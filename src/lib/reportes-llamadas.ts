import "server-only";
import { db } from "@/db";
import { sql } from "drizzle-orm";
import type { TeamMember } from "@/lib/team";
import { quienLlamo, TIPO_LLAMADA_WHATSAPP } from "@/lib/llamada-whatsapp";

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
