import "server-only";
import { db } from "@/db";
import { contacts } from "@/db/schema";
import { eq } from "drizzle-orm";
import { listMembers } from "@/lib/team";
import { notifyMember } from "@/lib/notifications";

/**
 * Aviso inmediato al equipo (notificacion interna + push al celular), a cualquier hora.
 * Destinatarios: el dueño del contacto y los administradores; si no hay ninguno, todos
 * los miembros activos. Nunca lanza: un fallo de push no debe frenar al bot.
 */
export async function alertarEquipo(input: {
  contactId: string;
  conversationId?: string | null;
  titulo: string;
  cuerpo: string;
}): Promise<void> {
  try {
    const [contact] = await db
      .select({ ownerId: contacts.ownerId })
      .from(contacts)
      .where(eq(contacts.id, input.contactId))
      .limit(1);
    const miembros = await listMembers({ onlyActive: true });
    const destinatarios = miembros.filter((m) => m.id === contact?.ownerId || m.role === "admin");
    const targets = destinatarios.length > 0 ? destinatarios : miembros;
    const url = input.conversationId ? `/conversations/${input.conversationId}` : `/contacts/${input.contactId}`;
    for (const m of targets) {
      await notifyMember({
        memberId: m.id,
        kind: "system",
        title: input.titulo.slice(0, 120),
        body: input.cuerpo.slice(0, 300),
        url,
        contactId: input.contactId,
        tag: `alerta-${input.contactId}`,
      }).catch((err) => console.warn("[alertas] notifyMember fallo:", err));
    }
  } catch (err) {
    console.warn("[alertas] no se pudo alertar al equipo:", err);
  }
}

export { TAG_NO_REACTIVAR, esMotivoDeBaja } from "./baja";
