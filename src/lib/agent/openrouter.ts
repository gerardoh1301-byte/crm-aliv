import OpenAI from "openai";
import { getConfig, marca } from "@/lib/config";
import { getAllGeminiKeys, getNextGeminiKey, markGeminiKeyRateLimited } from "@/lib/gemini-keys";
import { anotarUsoIA, leerUsage } from "@/lib/ia-uso";

const DEFAULT_MODEL = "gemini-3.5-flash-lite";
const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai/";
const GROQ_BASE_URL = "https://api.groq.com/openai/v1";

// Modelos activos y comprobados en la API de Google
const GEMINI_FALLBACK_MODELS = [
  "gemini-3.5-flash-lite",
  "gemini-flash-lite-latest",
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
  "gemini-3.1-flash-lite",
];

const geminiClients = new Map<string, OpenAI>();
let groqClient: OpenAI | null = null;
let openRouterClient: OpenAI | null = null;

function getGroqClient(): OpenAI | null {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return null;
  if (!groqClient) {
    groqClient = new OpenAI({
      apiKey,
      baseURL: GROQ_BASE_URL,
      timeout: 20000,
      maxRetries: 0,
    });
  }
  return groqClient;
}

export function getGeminiClient(specificKey?: string): OpenAI | null {
  const apiKey = specificKey || getNextGeminiKey();
  if (!apiKey) return null;

  let client = geminiClients.get(apiKey);
  if (!client) {
    client = new OpenAI({
      apiKey,
      baseURL: GEMINI_BASE_URL,
      timeout: 12000, // A8: 12s máximo por llamada individual para respetar el tope global de 45s
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

  const groq = getGroqClient();
  if (groq) return groq;

  const openRouter = getOpenRouterClientOnly();
  if (openRouter) return openRouter;

  throw new Error("Ni GEMINI_API_KEYS ni GROQ_API_KEY ni OPENROUTER_API_KEY configuradas");
}

export function getAgentModel(): string {
  if (process.env.AGENT_MODEL) {
    return process.env.AGENT_MODEL;
  }
  return getConfig().agente?.modelo || DEFAULT_MODEL;
}

export function hasOpenRouterKey(): boolean {
  return (
    getAllGeminiKeys().length > 0 ||
    Boolean(process.env.GROQ_API_KEY) ||
    Boolean(process.env.OPENROUTER_API_KEY)
  );
}

/**
 * Ejecuta la llamada al LLM con rotación Round-Robin y conmutación instantánea (failover).
 * Si la clave actual recibe 429 (cuota de 15 RPM) o 503, se conmuta en 0 milisegundos
 * a la siguiente clave del pool para que el cliente reciba respuesta inmediata.
 */
export const MAX_TOTAL_RESPONSE_TIMEOUT_MS = 45_000;

export async function createChatCompletionWithFallback(
  params: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming,
  options?: { timeout?: number; totalTimeoutMs?: number; origen?: string }
): Promise<OpenAI.Chat.Completions.ChatCompletion> {
  const requestedModel = params.model || getAgentModel();
  const origen = options?.origen ?? "otro";

  // Toda llamada pasa por aquí para dejar registrados los tokens (o la falla) del día.
  async function llamar(
    proveedor: "gemini" | "groq" | "openrouter",
    cliente: OpenAI,
    body: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming,
    opts: OpenAI.RequestOptions
  ): Promise<OpenAI.Chat.Completions.ChatCompletion> {
    try {
      const res = await cliente.chat.completions.create(body, opts);
      const t = leerUsage(res.usage);
      anotarUsoIA({ proveedor, modelo: body.model, origen, ok: true, tokensEntrada: t.entrada, tokensSalida: t.salida, tokensCache: t.cache });
      return res;
    } catch (err) {
      anotarUsoIA({ proveedor, modelo: body.model, origen, ok: false });
      throw err;
    }
  }
  const allKeys = getAllGeminiKeys();

  const totalBudgetMs = Math.min(
    options?.totalTimeoutMs ?? MAX_TOTAL_RESPONSE_TIMEOUT_MS,
    MAX_TOTAL_RESPONSE_TIMEOUT_MS
  );
  const deadline = Date.now() + totalBudgetMs;
  const perCallBaseMs = options?.timeout ?? 12_000;

  function buildReqOptions(): OpenAI.RequestOptions | null {
    const remaining = deadline - Date.now();
    if (remaining <= 800) return null;
    return {
      timeout: Math.min(perCallBaseMs, remaining),
      maxRetries: 0,
    };
  }

  const triedKeys = new Set<string>();
  let lastErr: unknown = null;
  // Primer error de Gemini (el proveedor principal). Si los respaldos también fallan, se
  // lanza ESTE y no el último: el 20/11 un 429 de Gemini quedó tapado por un 413 de Groq
  // ("Request too large"), el turno no se reintentó y el cliente recibió "Disculpa la demora".
  let geminiErr: unknown = null;

  // 1. Probar con hasta 3 claves del pool de Gemini y reservar al menos 15s para Groq/OpenRouter.
  // Si el modelo principal se satura o no contesta a tiempo, los intentos siguientes usan el
  // modelo lite: repetir el mismo modelo saturado con otra clave solo gastaba el presupuesto
  // y el cliente recibía "Disculpa la demora" (Groq gratis no acepta un prompt de ~22k tokens).
  const maxAttempts = Math.min(Math.max(allKeys.length, 1), 3);
  let gemini503Count = 0;
  const modeloLite = GEMINI_FALLBACK_MODELS.find((m) => m !== requestedModel) ?? requestedModel;
  let modeloIntento = requestedModel;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    // Si quedan menos de 15s de presupuesto, salir de inmediato a Groq/OpenRouter
    if (deadline - Date.now() < 15_000) {
      console.warn("[agent-llm] Menos de 15s de presupuesto restante. Conmutando a Groq/OpenRouter...");
      break;
    }

    const reqOptions = buildReqOptions();
    if (!reqOptions) break;

    const key = getNextGeminiKey();
    if (!key) break;
    if (triedKeys.has(key) && triedKeys.size >= allKeys.length) break;
    triedKeys.add(key);

    const client = getGeminiClient(key);
    if (!client) continue;

    try {
      return await llamar("gemini", client, 
        {
          ...params,
          model: modeloIntento,
        },
        reqOptions
      );
    } catch (err: unknown) {
      lastErr = err;
      if (!geminiErr) geminiErr = err;
      const error = err as { status?: number; code?: string | number; message?: string };
      const status = error?.status;

      // Sin respuesta a tiempo (status undefined) o error del servidor: pasar al modelo lite.
      if (status === undefined || (typeof status === "number" && status >= 500)) {
        modeloIntento = modeloLite;
      }

      // 503 = Sobrecarga del modelo en Google -> Probar de inmediato modelos alternativos (lite)
      if (status === 503) {
        gemini503Count++;
        console.warn(
          `[agent-llm] Modelo ${requestedModel} saturado (503) en clave ...${key.slice(-8)}. Probando de inmediato modelos Gemini lite alternativos...`
        );
        markGeminiKeyRateLimited(key, 30);

        for (const fallbackModel of GEMINI_FALLBACK_MODELS) {
          if (fallbackModel === requestedModel) continue;
          if (deadline - Date.now() < 12_000) break; // reservar para Groq
          const fbOpts = buildReqOptions();
          if (!fbOpts) break;
          try {
            console.info(`[agent-llm] Intentando modelo Gemini alternativo ${fallbackModel}...`);
            return await llamar("gemini", client, 
              {
                ...params,
                model: fallbackModel,
              },
              fbOpts
            );
          } catch (fbErr: any) {
            console.warn(`[agent-llm] Fallback ${fallbackModel} también falló:`, fbErr?.message || fbErr);
          }
        }

        // Si ya van 2 fallos 503 en Gemini, conmutar a Groq/OpenRouter
        if (gemini503Count >= 2) {
          console.warn("[agent-llm] Gemini sobrecargado persistentemente (503). Conmutando de inmediato a proveedores de respaldo...");
          break;
        }
        continue;
      }

      // 429 = Cuota por minuto excedida
      if (status === 429) {
        console.warn(
          `[agent-llm] Clave ...${key.slice(-8)} recibió 429 (cuota excedida). Conmutando a la siguiente clave del pool...`
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
          const fbOpts = buildReqOptions();
          if (!fbOpts) break;
          try {
            console.info(`[agent-llm] Intentando modelo Gemini alternativo ${fallbackModel}...`);
            return await llamar("gemini", client, 
              {
                ...params,
                model: fallbackModel,
              },
              fbOpts
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

  // 2. Si las claves de Gemini fallaron o agotaron su ventana, conmutar a Groq Cloud dentro del presupuesto de 45s
  const groq = getGroqClient();
  if (groq) {
    // Groq retiró los Llama 3.x (devuelven 404). Lista vigente verificada el 19/11/2026 con
    // GET /openai/v1/models; se puede pisar con GROQ_MODELS="modelo1,modelo2" sin desplegar código.
    const groqModels = (process.env.GROQ_MODELS || "openai/gpt-oss-120b,qwen/qwen3.8-27b")
      .split(",")
      .map((m) => m.trim())
      .filter(Boolean);
    for (const gModel of groqModels) {
      const reqOptions = buildReqOptions();
      if (!reqOptions) break;
      try {
        console.info(`[agent-llm] Intentando failover Groq con ${gModel}...`);
        return await llamar("groq", groq, 
          {
            ...params,
            model: gModel,
          },
          reqOptions
        );
      } catch (gErr) {
        lastErr = gErr;
        console.warn(`[agent-llm] Falló Groq ${gModel}:`, gErr instanceof Error ? gErr.message : gErr);
      }
    }
  }

  // 3. Si Gemini y Groq fallaron o no están, conmutar a OpenRouter dentro del límite de 45s
  const openRouter = getOpenRouterClientOnly();
  if (openRouter) {
    const openRouterCandidates = [
      "google/gemini-2.5-flash",
      "google/gemini-flash-1.5",
      "meta-llama/llama-3.3-70b-instruct",
    ];
    for (const orModel of openRouterCandidates) {
      const reqOptions = buildReqOptions();
      if (!reqOptions) break;
      try {
        console.info(`[agent-llm] Intentando failover OpenRouter con ${orModel}`);
        return await llamar("openrouter", openRouter, 
          {
            ...params,
            model: orModel,
          },
          reqOptions
        );
      } catch (orErr) {
        lastErr = orErr;
        console.warn(`[agent-llm] Falló OpenRouter ${orModel}`);
      }
    }
  }

  if (Date.now() >= deadline) {
    throw new Error("Timeout de IA: límite máximo de 45s alcanzado");
  }

  // Si todos los respaldos fallaron, lanzar el error original para trazabilidad
  throw geminiErr || lastErr || new Error("No hay proveedores de LLM disponibles");
}
