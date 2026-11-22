import { db } from "@/db";
import { agentJobs, contacts, conversations } from "@/db/schema";
import { and, eq, gte, isNull, lt, lte, ne, or } from "drizzle-orm";

const DEBOUNCE_MS = 6000;
const STALE_PROCESSING_MS = 3 * 60 * 1000; // A8: 3 minutos para rescatar trabajos atascados en processing

/**
 * Encola un job para procesar el agente IA.
 * - Si ya hay un job pending para la misma CONVERSACION, NO crea uno nuevo:
 *   solo extiende su `process_after` para "absorber" mensajes en rafaga.
 * - Si no hay, crea uno nuevo.
 *
 * La unidad de debounce es la conversacion, no el contacto: la misma persona puede
 * escribirte por WhatsApp y por Instagram, y son dos hilos que hay que responder por
 * separado. Sin `conversationId` (flujo WhatsApp por Meta, todavia sin migrar) se cae
 * al comportamiento viejo por contacto, aislado de los jobs que si tienen conversacion.
 */
export async function enqueueAgentJob(
  contactId: string,
  triggerMessageId: string,
  conversationId?: string | null,
  /** Espera antes de procesar (por defecto el debounce de 6 s; los reintentos usan minutos). */
  esperaMs: number = DEBOUNCE_MS
): Promise<{ jobId: string; created: boolean }> {
  const processAfter = new Date(Date.now() + esperaMs);

  const pendingFilter = conversationId
    ? and(
        eq(agentJobs.conversationId, conversationId),
        eq(agentJobs.status, "pending")
      )
    : and(
        eq(agentJobs.contactId, contactId),
        isNull(agentJobs.conversationId),
        eq(agentJobs.status, "pending")
      );

  const [existing] = await db
    .select({ id: agentJobs.id })
    .from(agentJobs)
    .where(pendingFilter)
    .limit(1);

  if (existing) {
    await db
      .update(agentJobs)
      .set({
        processAfter,
        triggerMessageId,
        updatedAt: new Date(),
      })
      .where(eq(agentJobs.id, existing.id));
    return { jobId: existing.id, created: false };
  }

  const [created] = await db
    .insert(agentJobs)
    .values({
      contactId,
      conversationId: conversationId ?? null,
      status: "pending",
      processAfter,
      triggerMessageId,
    })
    .returning({ id: agentJobs.id });

  return { jobId: created.id, created: true };
}

/**
 * Intenta tomar un job para procesar.
 * - Si el job ya no esta pending, no hace nada (otro worker lo tomo).
 * - Si su processAfter aun es futuro, no hace nada (debounce activo, otro setTimeout vendra).
 * - Si OK, marca processing y devuelve el job + contacto.
 */
export async function claimAgentJob(jobId: string): Promise<
  | { ok: true; contactId: string; conversationId: string | null; attempts: number }
  | { ok: false; reason: string }
> {
  const [job] = await db
    .select()
    .from(agentJobs)
    .where(eq(agentJobs.id, jobId))
    .limit(1);

  if (!job) return { ok: false, reason: "job_not_found" };

  const now = Date.now();
  const esStaleProcessing =
    job.status === "processing" &&
    job.updatedAt.getTime() <= now - STALE_PROCESSING_MS &&
    job.attempts < 3;

  if (job.status !== "pending" && !esStaleProcessing) {
    return { ok: false, reason: `status_${job.status}` };
  }

  if (job.status === "pending" && job.processAfter.getTime() > now) {
    return { ok: false, reason: "debounce_still_active" };
  }

  // Candado de concurrencia: evitar que 2 ejecuciones atiendan la misma conversación al mismo tiempo
  // Si ya hay un job en status 'processing' activo (< 2 min), este job espera en serie.
  const busyFilter = job.conversationId
    ? and(
        eq(agentJobs.conversationId, job.conversationId),
        eq(agentJobs.status, "processing"),
        ne(agentJobs.id, jobId),
        gte(agentJobs.updatedAt, new Date(Date.now() - 2 * 60 * 1000))
      )
    : and(
        eq(agentJobs.contactId, job.contactId),
        isNull(agentJobs.conversationId),
        eq(agentJobs.status, "processing"),
        ne(agentJobs.id, jobId),
        gte(agentJobs.updatedAt, new Date(Date.now() - 2 * 60 * 1000))
      );

  const [activeJob] = await db
    .select({ id: agentJobs.id })
    .from(agentJobs)
    .where(busyFilter)
    .limit(1);

  if (activeJob) {
    await db
      .update(agentJobs)
      .set({
        processAfter: new Date(Date.now() + 4000),
        updatedAt: new Date(),
      })
      .where(eq(agentJobs.id, jobId));
    return { ok: false, reason: "conversation_busy_processing" };
  }

  // Pre-check rapido del contacto
  const [contact] = await db
    .select({ aiEnabled: contacts.aiEnabled, needsHuman: contacts.needsHuman })
    .from(contacts)
    .where(eq(contacts.id, job.contactId))
    .limit(1);

  if (!contact) {
    await db
      .update(agentJobs)
      .set({ status: "failed", error: "contact_not_found", updatedAt: new Date() })
      .where(eq(agentJobs.id, jobId));
    return { ok: false, reason: "contact_not_found" };
  }

  if (!contact.aiEnabled) {
    await db
      .update(agentJobs)
      .set({
        status: "done",
        error: "ai_disabled",
        updatedAt: new Date(),
      })
      .where(eq(agentJobs.id, jobId));
    return { ok: false, reason: "bot_off" };
  }

  // El toggle del contacto es el kill-switch global; el de la conversacion apaga el bot
  // en un canal sin apagarlo en los otros (derivar a humano por Instagram no deberia
  // callar al bot en WhatsApp).
  if (job.conversationId) {
    const [conv] = await db
      .select({
        aiEnabled: conversations.aiEnabled,
        needsHuman: conversations.needsHuman,
      })
      .from(conversations)
      .where(eq(conversations.id, job.conversationId))
      .limit(1);

    if (conv && !conv.aiEnabled) {
      await db
        .update(agentJobs)
        .set({
          status: "done",
          error: "ai_disabled_conversation",
          updatedAt: new Date(),
        })
        .where(eq(agentJobs.id, jobId));
      return { ok: false, reason: "bot_off" };
    }
  }

  // Marcar processing (soporta también rescate de jobs colgados en processing > 3 min)
  const updated = await db
    .update(agentJobs)
    .set({
      status: "processing",
      attempts: job.attempts + 1,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(agentJobs.id, jobId),
        or(
          eq(agentJobs.status, "pending"),
          and(
            eq(agentJobs.status, "processing"),
            lte(agentJobs.updatedAt, new Date(now - STALE_PROCESSING_MS))
          )
        )
      )
    )
    .returning({ id: agentJobs.id });

  if (updated.length === 0) {
    return { ok: false, reason: "race_condition" };
  }

  return {
    ok: true,
    contactId: job.contactId,
    conversationId: job.conversationId,
    attempts: job.attempts + 1,
  };
}

export async function markJobDone(
  jobId: string,
  reason?: string
): Promise<void> {
  await db
    .update(agentJobs)
    .set({
      status: "done",
      error: reason ?? null,
      updatedAt: new Date(),
    })
    .where(eq(agentJobs.id, jobId));
}

export async function markJobFailed(
  jobId: string,
  error: string
): Promise<void> {
  await db
    .update(agentJobs)
    .set({
      status: "failed",
      error,
      updatedAt: new Date(),
    })
    .where(eq(agentJobs.id, jobId));
}

/**
 * Recoge jobs pendientes vencidos y jobs colgados en 'processing' por más de 3 minutos
 * (A8: por si Render se reinició a mitad de un turno). Pensado para llamarse desde un cron periódico.
 */
export async function findStaleJobs(): Promise<
  Array<{ id: string; contactId: string; conversationId: string | null }>
> {
  const now = new Date();
  const staleProcessingLimit = new Date(now.getTime() - STALE_PROCESSING_MS);

  // Devolver a 'pending' los trabajos que quedaron atrapados en 'processing' > 3 min (máx 3 intentos)
  await db
    .update(agentJobs)
    .set({
      status: "pending",
      processAfter: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(agentJobs.status, "processing"),
        lte(agentJobs.updatedAt, staleProcessingLimit),
        lt(agentJobs.attempts, 3)
      )
    );

  const rows = await db
    .select({
      id: agentJobs.id,
      contactId: agentJobs.contactId,
      conversationId: agentJobs.conversationId,
    })
    .from(agentJobs)
    .where(
      or(
        and(eq(agentJobs.status, "pending"), lte(agentJobs.processAfter, now)),
        and(
          eq(agentJobs.status, "processing"),
          lte(agentJobs.updatedAt, staleProcessingLimit),
          lt(agentJobs.attempts, 3)
        )
      )
    )
    .limit(50);
  return rows;
}

export const queueConfig = {
  debounceMs: DEBOUNCE_MS,
};
