import OpenAI from "openai";
import { getConfig, marca } from "@/lib/config";

const DEFAULT_MODEL = "gemini-3.1-flash-lite";
const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai/";

// Modelos activos y comprobados en la API de Google
const GEMINI_FALLBACK_MODELS = [
  "gemini-3.1-flash-lite",
  "gemini-flash-lite-latest",
  "gemini-3.5-flash-lite",
];

let geminiClient: OpenAI | null = null;
let openRouterClient: OpenAI | null = null;

function getGeminiClient(): OpenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  if (!geminiClient) {
    geminiClient = new OpenAI({
      apiKey,
      baseURL: GEMINI_BASE_URL,
      timeout: 12000, // 12s tiempo máximo para no demorar la respuesta
      maxRetries: 0,  // Sin reintentos internos del SDK para que nuestro failover actúe de inmediato
    });
  }
  return geminiClient;
}

function getOpenRouterClientOnly(): OpenAI | null {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return null;
  if (!openRouterClient) {
    openRouterClient = new OpenAI({
      apiKey,
      baseURL: OPENROUTER_BASE_URL,
      timeout: 12000,
      maxRetries: 0,
      defaultHeaders: {
        "HTTP-Referer": process.env.APP_BASE_URL || "https://crm-aliv.onrender.com",
        "X-Title": marca().nombre,
      },
    });
  }
  return openRouterClient;
}

/**
 * Cliente primario para el agente.
 * Si GEMINI_API_KEY existe, usa Gemini con su URL oficial.
 * Si no, usa OpenRouter con su propia URL y clave.
 */
export function getOpenRouterClient(): OpenAI {
  const gemini = getGeminiClient();
  if (gemini) return gemini;

  const openRouter = getOpenRouterClientOnly();
  if (openRouter) return openRouter;

  throw new Error("Ni GEMINI_API_KEY ni OPENROUTER_API_KEY configuradas");
}

export function getAgentModel(): string {
  if (process.env.AGENT_MODEL) {
    return process.env.AGENT_MODEL;
  }
  return getConfig().agente?.modelo || DEFAULT_MODEL;
}

export function hasOpenRouterKey(): boolean {
  return Boolean(process.env.GEMINI_API_KEY || process.env.OPENROUTER_API_KEY);
}

/**
 * Ejecuta la llamada al LLM con reintento automático y conmutación por error (failover).
 * Si el proveedor principal devuelve 429 (cuota), 503 (saturación), 404 (modelo inválido)
 * o 500, reintenta de inmediato probando la cadena de modelos garantizados.
 */
const REQUEST_OPTIONS: OpenAI.RequestOptions = {
  timeout: 10000, // 10 segundos tiempo máximo estricto
  maxRetries: 0,  // Sin reintentos internos lentos
};

export async function createChatCompletionWithFallback(
  params: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming,
  options?: { timeout?: number }
): Promise<OpenAI.Chat.Completions.ChatCompletion> {
  const primaryClient = getOpenRouterClient();
  const requestedModel = params.model || getAgentModel();

  // R9: 20s para rondas finales de texto, 12s para llamadas a herramientas
  const timeoutMs = options?.timeout ?? (params.tools && params.tools.length > 0 ? 12000 : 20000);
  const reqOptions: OpenAI.RequestOptions = {
    timeout: timeoutMs,
    maxRetries: 0,
  };

  // 1. Intento primario con el modelo configurado
  try {
    return await primaryClient.chat.completions.create(
      {
        ...params,
        model: requestedModel,
      },
      reqOptions
    );
  } catch (err: unknown) {
    const error = err as { status?: number; code?: string | number; message?: string };
    const status = error?.status;
    console.warn(
      `[agent-llm] Fallo en modelo primario (${requestedModel}, status ${status}): ${error?.message || err}. Iniciando failover...`
    );

    // Si fue error de autenticación 401 puro o 400 de parámetros irrecuperable, propagar
    if (status === 401) {
      throw err;
    }

    // 2. Probar candidatos de respaldo en Gemini
    const gemini = getGeminiClient();
    if (gemini) {
      for (const fallbackModel of GEMINI_FALLBACK_MODELS) {
        if (fallbackModel === requestedModel) continue;
        try {
          console.info(`[agent-llm] Intentando modelo Gemini de respaldo: ${fallbackModel}`);
          return await gemini.chat.completions.create(
            {
              ...params,
              model: fallbackModel,
            },
            reqOptions
          );
        } catch (fbErr: unknown) {
          const fbStatus = (fbErr as { status?: number })?.status;
          console.warn(`[agent-llm] Falló respaldo ${fallbackModel} con status ${fbStatus}`);
        }
      }
    }

    // 2b. 429 = cuota por minuto de la clave: los modelos de respaldo comparten la misma
    // cuota, asi que fallan igual si se prueban al instante. Esperar unos segundos y
    // reintentar rescata la respuesta en vez de dejar al cliente sin contestar.
    if (gemini && (status === 429 || status === 503)) {
      for (const esperaMs of [2500, 6000, 12000]) {
        await new Promise((r) => setTimeout(r, esperaMs));
        try {
          console.info(`[agent-llm] Reintento tras ${status} con ${requestedModel} (espera ${esperaMs} ms)`);
          return await gemini.chat.completions.create({ ...params, model: requestedModel }, reqOptions);
        } catch (retryErr: unknown) {
          const retryStatus = (retryErr as { status?: number })?.status;
          console.warn(`[agent-llm] Reintento falló con status ${retryStatus}`);
          if (retryStatus !== 429 && retryStatus !== 503) break;
        }
      }
    }

    // 3. Si Gemini falló o no está, intentar con OpenRouter si está configurado
    const openRouter = getOpenRouterClientOnly();
    if (openRouter) {
      const openRouterCandidates = [
        "google/gemini-flash-1.5",
        "meta-llama/llama-3.3-70b-instruct",
      ];
      for (const orModel of openRouterCandidates) {
        try {
          console.info(`[agent-llm] Intentando failover OpenRouter con ${orModel}`);
          return await openRouter.chat.completions.create(
            {
              ...params,
              model: orModel,
            },
            reqOptions
          );
        } catch (orErr) {
          console.warn(`[agent-llm] Falló OpenRouter ${orModel}`);
        }
      }
    }

    // Si todos los respaldos fallaron, lanzar el error original para trazabilidad
    throw err;
  }
}
