import { sql } from "drizzle-orm";
import { db } from "@/db";

/**
 * Registro del consumo de IA por día (hora de Lima), proveedor, modelo y origen.
 * Sirve para ver cuánto falta para la cuota de Gemini antes de que corte con 429.
 * Nunca lanza: si la tabla no existe o la base falla, solo deja un aviso en el log.
 */
export interface UsoIA {
  proveedor: "gemini" | "groq" | "openrouter";
  modelo: string;
  origen: string;
  ok: boolean;
  tokensEntrada?: number;
  tokensSalida?: number;
  tokensCache?: number;
}

/** Extrae los tokens del campo `usage` de una respuesta compatible con OpenAI. */
export function leerUsage(usage: unknown): { entrada: number; salida: number; cache: number } {
  const u = (usage ?? {}) as {
    prompt_tokens?: number;
    completion_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number } | null;
  };
  return {
    entrada: Number(u.prompt_tokens) || 0,
    salida: Number(u.completion_tokens) || 0,
    cache: Number(u.prompt_tokens_details?.cached_tokens) || 0,
  };
}

export async function registrarUsoIA(uso: UsoIA): Promise<void> {
  try {
    await db.execute(sql`
      insert into ia_uso_diario (fecha, proveedor, modelo, origen, llamadas, fallidas, tokens_entrada, tokens_salida, tokens_cache)
      values (
        (now() at time zone 'America/Lima')::date, ${uso.proveedor}, ${uso.modelo}, ${uso.origen},
        ${uso.ok ? 1 : 0}, ${uso.ok ? 0 : 1},
        ${uso.tokensEntrada ?? 0}, ${uso.tokensSalida ?? 0}, ${uso.tokensCache ?? 0}
      )
      on conflict (fecha, proveedor, modelo, origen) do update set
        llamadas = ia_uso_diario.llamadas + excluded.llamadas,
        fallidas = ia_uso_diario.fallidas + excluded.fallidas,
        tokens_entrada = ia_uso_diario.tokens_entrada + excluded.tokens_entrada,
        tokens_salida = ia_uso_diario.tokens_salida + excluded.tokens_salida,
        tokens_cache = ia_uso_diario.tokens_cache + excluded.tokens_cache,
        actualizado = now()
    `);
  } catch (err) {
    console.warn("[ia-uso] no se pudo registrar el consumo:", err instanceof Error ? err.message : err);
  }
}

/** Fire-and-forget: no retrasa la respuesta al cliente. */
export function anotarUsoIA(uso: UsoIA): void {
  void registrarUsoIA(uso);
}
