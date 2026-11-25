import "server-only";
import { db } from "@/db";
import { contacts } from "@/db/schema";
import { eq } from "drizzle-orm";
import { indicaPostulante, TAG_POSTULANTE } from "./postulante";

/**
 * Pone la etiqueta «postulante» apenas un mensaje lo muestra (ver indicaPostulante). Con la
 * etiqueta, el rescate, el toque en caliente y los seguimientos de venta ya no le escriben.
 */
export async function marcarPostulanteSiCorresponde(params: {
  contactId: string;
  direction: string;
  body: string | null | undefined;
  metadata?: unknown;
}): Promise<boolean> {
  if (!indicaPostulante(params)) return false;
  const [c] = await db.select({ tags: contacts.tags }).from(contacts).where(eq(contacts.id, params.contactId)).limit(1);
  if (!c || (c.tags ?? []).some((t) => t.toLowerCase().trim() === TAG_POSTULANTE)) return false;
  const { aplicarEtiquetaAContacto } = await import("./etiquetado");
  await aplicarEtiquetaAContacto({
    contactId: params.contactId,
    etiqueta: TAG_POSTULANTE,
    accion: "agregar",
    motivo: "Escribió por el aviso de empleo (detectado al recibir el mensaje)",
  });
  return true;
}
