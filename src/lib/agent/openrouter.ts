import OpenAI from "openai";
import { getConfig, marca } from "@/lib/config";
import { getAllGeminiKeys, getNextGeminiKey, markGeminiKeyRateLimited } from "@/lib/gemini-keys";

const DEFAULT_MODEL = "gemini-3.1-flash-lite";
const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai/";

// Modelos activos y comprobados en la API de Google
const GEMINI_FALLBACK_MODELS = [
  "gemini-3.1-flash-lite",
  "gemini-flash-lite-latest",
  "gemini-3.8-flash",
  "gemini-3.5-flash-lite",
];

const geminiClients = new Map<string, OpenAI>();
let openRouterClient: OpenAI | null = null;

export function getGeminiClient(specificKey?: string): OpenAI | null {
  const apiKey = specificKey || getNextGeminiKey();
  if (!apiKey) return null;

  let client = geminiClients.get(apiKey);
  if (!client) {
    client = new OpenAI({
      apiKey,
      baseURL: GEMINI_BASE_URL,
      timeout: 12000, // 12s tiempo máximo para no demorar la respuesta
      maxRetries: 0,  // Sin reintentos internos del SDK para que nuestro failover actúe de inmediato
    });
    geminiClients.set(apiKey, client);
  }
  return client;
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
 * Si existen claves de Gemini en el pool, usa Gemini rotativo.
 * Si no, usa OpenRouter con su propia URL y clave.
 */
export function getOpenRouterClient(): OpenAI {
  const gemini = getGeminiClient();
  if (gemini) return gemini;

  const openRouter = getOpenRouterClientOnly();
  if (openRouter) return openRouter;

  throw new Error("Ni GEMINI_API_KEYS ni OPENROUTER_API_KEY configuradas");
}

export function getAgentModel(): string {
  if (process.env.AGENT_MODEL) {
    return process.env.AGENT_MODEL;
  }
  return getConfig().agente?.modelo || DEFAULT_MODEL;
}

export function hasOpenRouterKey(): boolean {
  return getAllGeminiKeys().length > 0 || Boolean(process.env.OPENROUTER_API_KEY);
}

/**
 * Ejecuta la llamada al LLM con rotación Round-Robin y conmutación instantánea (failover).
 * Si la clave actual recibe 429 (cuota de 15 RPM) o 503, se conmuta en 0 milisegundos
 * a la siguiente clave del pool para que el cliente reciba respuesta inmediata.
 */
export async function createChatCompletionWithFallback(
  params: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming,
  options?: { timeout?: number }
): Promise<OpenAI.Chat.Completions.ChatCompletion> {
  const requestedModel = params.model || getAgentModel();
  const allKeys = getAllGeminiKeys();

  const timeoutMs = options?.timeout ?? (params.tools && params.tools.length > 0 ? 12000 : 20000);
  const reqOptions: OpenAI.RequestOptions = {
    timeout: timeoutMs,
    maxRetries: 0,
  };

  const triedKeys = new Set<string>();
  let lastErr: unknown = null;

  // 1. Probar con las claves del pool de Gemini
  const maxAttempts = Math.max(allKeys.length, 1);
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const key = getNextGeminiKey();
    if (!key) break;
    if (triedKeys.has(key) && triedKeys.size >= allKeys.length) break;
    triedKeys.add(key);

    const client = getGeminiClient(key);
    if (!client) continue;

    try {
      return await client.chat.completions.create(
        {
          ...params,
          model: requestedModel,
        },
        reqOptions
      );
    } catch (err: unknown) {
      lastErr = err;
      const error = err as { status?: number; code?: string | number; message?: string };
      const status = error?.status;

      // 429 = Cuota por minuto excedida / 503 = Sobrecarga temporal de Google
      if (status === 429 || status === 503) {
        console.warn(
          `[agent-llm] Clave ...${key.slice(-8)} recibió ${status} (cuota/saturación). Conmutando de inmediato a la siguiente clave del pool...`
        );
        markGeminiKeyRateLimited(key, 60);
        continue;
      }

      // 401 = Clave no válida
      if (status === 401) {
        console.error(`[agent-llm] Clave ...${key.slice(-8)} no válida (401). Se descarta temporalmente.`);
        markGeminiKeyRateLimited(key, 3600);
        continue;
      }

      // 404 = Modelo no disponible -> probar modelos alternativos con esta misma clave
      if (status === 404) {
        for (const fallbackModel of GEMINI_FALLBACK_MODELS) {
          if (fallbackModel === requestedModel) continue;
          try {
            console.info(`[agent-llm] Intentando modelo Gemini alternativo ${fallbackModel}...`);
            return await client.chat.completions.create(
              {
                ...params,
                model: fallbackModel,
              },
              reqOptions
            );
          } catch {
            // continuar
          }
        }
      }

      console.warn(
        `[agent-llm] Error en clave ...${key.slice(-8)} (status ${status}): ${error?.message || err}. Probando siguiente clave...`
      );
    }
  }

  // 2. Si todas las claves de Gemini fallaron o están agotadas, conmutar a OpenRouter si está configurado
  const openRouter = getOpenRouterClientOnly();
  if (openRouter) {
    const openRouterCandidates = [
      "google/gemini-2.5-flash",
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
  throw lastErr || new Error("No hay proveedores de LLM disponibles");
}
