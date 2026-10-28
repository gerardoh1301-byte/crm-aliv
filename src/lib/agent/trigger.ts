import { claimAgentJob, markJobDone, markJobFailed, queueConfig } from "./queue";
import { runAgentForContact, runAgentForConversation } from "./index";

async function procesarJobEnMemoria(jobId: string, tag: string): Promise<void> {
  const claim = await claimAgentJob(jobId);
  if (!claim.ok) return;
  try {
    const run = claim.conversationId
      ? await runAgentForConversation(claim.conversationId)
      : await runAgentForContact(claim.contactId);
    if (run.ok) {
      await markJobDone(jobId, run.reason);
    } else {
      await markJobFailed(jobId, run.reason ?? "unknown");
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    console.error(`[${tag}] error en ejecucion directa del job ${jobId}:`, err);
    await markJobFailed(jobId, msg);
  }
}

/**
 * Dispara el worker del agente para una lista de jobs.
 *
 * Se llama desde dentro de `after()`: devuelve 200 al proveedor primero y luego espera
 * el debounce. Procesa directamente en memoria en el mismo proceso Node (evitando fallos
 * por DNS/loopback o falta de APP_BASE_URL), y usa la ruta HTTP si esta configurada en
 * entornos distribuidos.
 */
export async function triggerAgentWorker(
  jobIds: string[],
  baseUrl: string,
  tag = "agent-trigger"
): Promise<void> {
  const unique = Array.from(new Set(jobIds)).filter(Boolean);
  if (unique.length === 0) return;

  const secret = process.env.AGENT_WORKER_SECRET;

  await Promise.all(
    unique.map(async (jobId) => {
      await new Promise((r) => setTimeout(r, queueConfig.debounceMs + 250));

      // Si no hay URL publica o secreto configurado, ejecutamos en proceso sin perder el job
      if (!baseUrl || !secret) {
        await procesarJobEnMemoria(jobId, tag);
        return;
      }

      try {
        const res = await fetch(`${baseUrl}/api/agent/process`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-agent-secret": secret,
          },
          body: JSON.stringify({ jobId }),
        });
        if (!res.ok) {
          await procesarJobEnMemoria(jobId, tag);
        }
      } catch {
        // Fallback inmediato en proceso si el loopback HTTP falla en Docker/VPS
        await procesarJobEnMemoria(jobId, tag);
      }
    })
  );
}

/**
 * URL publica de la app para que el webhook pueda llamarse a si mismo.
 */
export function getWorkerBaseUrl(_headers?: Headers): string {
  const fromEnv = process.env.APP_BASE_URL || process.env.NEXT_PUBLIC_APP_URL;
  if (fromEnv) return fromEnv.replace(/\/$/, "");

  if (process.env.NODE_ENV === "production") {
    return "";
  }

  return "http://localhost:3000";
}
