import OpenAI from "openai";
import { getConfig, marca } from "@/lib/config";
import { getAllGeminiKeys, getNextGeminiKey, markGeminiKeyRateLimited } from "@/lib/gemini-keys";
import { anotarUsoIA, leerUsage } from "@/lib/ia-uso";

const DEFAULT_MODEL = "gemini-3.5-flash-lite";
const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai/";
const GROQ_BASE_URL = "https://api.groq.com/openai/v1";

// Modelos activos en la API de Google. gemini-2.5-flash y gemini-2.5-flash-lite se quitaron
// el 24/11/2026: devolvían 404 y solo hacían perder tiempo cuando Gemini estaba saturado.
const GEMINI_FALLBACK_MODELS = [
  "gemini-3.5-flash-lite",
  "gemini-flash-lite-latest",
  "gemini-3.1-flash-lite",
];

/** Tiempo que Gemini nunca puede tocar: es para que OpenRouter alcance a responder. */
export const RESERVA_RESPALDO_MS = 15_000;
/** Por debajo de esto no vale la pena empezar otra llamada a Gemini. */
const MINIMO_GEMINI_MS = 3_000;
/** Tras un 503 o un corte por tiempo, Gemini se salta durante este lapso. */
export const PAUSA_GEMINI_SATURADO_MS = 3 * 60_000;

let geminiSaturadoHasta = 0;

export function marcarGeminiSaturado(ahora = Date.now()): void {
  geminiSaturadoHasta = ahora + PAUSA_GEMINI_SATURADO_MS;
}

export function geminiSaturado(ahora = Date.now()): boolean {
  return ahora < geminiSaturadoHasta;
}

/** Solo para pruebas. */
export function reiniciarEstadoGemini(): void {
  geminiSaturadoHasta = 0;
}

/**
 * Timeout de la próxima llamada a Gemini sin tocar la reserva del respaldo, o null si ya
 * no queda tiempo para Gemini.
 */
export function tiempoParaGemini(restanteMs: number, reservaMs: number, porLlamadaMs: number): number | null {
  const disponible = restanteMs - reservaMs;
  if (disponible < MINIMO_GEMINI_MS) return null;
  return Math.min(porLlamadaMs, disponible);
}

/**
 * Timeout de la llamada a OpenRouter: al menos 15 s (el prompt del asistente es largo)
 * si quedan, nunca más que lo que queda. null si ya no alcanza.
 */
export function tiempoParaRespaldo(restanteMs: number, porLlamadaMs: number): number | null {
  if (restanteMs <= 800) return null;
  return Math.min(Math.max(porLlamadaMs, RESERVA_RESPALDO_MS), restanteMs);
}

const geminiClients = new Map<string, OpenAI>();
let groqClient: OpenAI | null = null;
let openRouterClient: OpenAI | null = null;

/**
 * Groq queda apagado por defecto (auditoría 21/11): retiró los Llama 3.x (404) y su plan
 * gratis rechaza el prompt (413), así que en vez de salvar el turno lo hacía fallar.
 * Se vuelve a encender con GROQ_ENABLED=on si algún día hay un plan que lo admita.
 */
function getGroqClient(): OpenAI | null {
  if (process.env.GROQ_ENABLED !== "on") return null;
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

  const openRouter = getOpenRouterClientOnly();
  if (openRouter) return openRouter;

  const groq = getGroqClient();
  if (groq) return groq;

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

  // El 24/11 a las 8:01 Gemini estaba saturado (503) y los reintentos se comían todo el
  // presupuesto: OpenRouter llegaba con 0 s y Gerardo recibió «la IA no respondió». Ahora
  // Gemini nunca toca la reserva del respaldo, y si Gemini se saturó hace poco se va
  // directo a OpenRouter.
  const openRouter = getOpenRouterClientOnly();
  const reserva = openRouter ? RESERVA_RESPALDO_MS : 0;
  let openRouterProbado = false;

  function opcionesGemini(): OpenAI.RequestOptions | null {
    const t = tiempoParaGemini(deadline - Date.now(), reserva, perCallBaseMs);
    return t ? { timeout: t, maxRetries: 0 } : null;
  }

  async function probarOpenRouter(): Promise<OpenAI.Chat.Completions.ChatCompletion | null> {
    if (!openRouter) return null;
    openRouterProbado = true;
    const candidatos = (process.env.OPENROUTER_MODELS || "google/gemini-2.5-flash,openai/gpt-4o-mini")
      .split(",")
      .map((m) => m.trim())
      .filter(Boolean);
    for (const orModel of candidatos) {
      const t = tiempoParaRespaldo(deadline - Date.now(), perCallBaseMs);
      if (!t) break;
      try {
        console.info(`[agent-llm] Intentando OpenRouter con ${orModel} (${Math.round(t / 1000)} s)`);
        return await llamar("openrouter", openRouter, { ...params, model: orModel }, { timeout: t, maxRetries: 0 });
      } catch (orErr) {
        lastErr = orErr;
        console.warn(`[agent-llm] Falló OpenRouter ${orModel}:`, orErr instanceof Error ? orErr.message : orErr);
      }
    }
    return null;
  }

  // 0. Gemini saturado hace poco: no perder tiempo, primero OpenRouter.
  if (openRouter && geminiSaturado()) {
    console.warn("[agent-llm] Gemini saturado hace menos de 3 min: voy directo a OpenRouter.");
    const r = await probarOpenRouter();
    if (r) return r;
  }

  // 1. Probar con hasta 3 claves del pool de Gemini sin tocar la reserva del respaldo.
  // Si el modelo principal se satura o no contesta a tiempo, los intentos siguientes usan el
  // modelo lite: repetir el mismo modelo saturado con otra clave solo gastaba el presupuesto.
  const maxAttempts = Math.min(Math.max(allKeys.length, 1), 3);
  let gemini503Count = 0;
  const modeloLite = GEMINI_FALLBACK_MODELS.find((m) => m !== requestedModel) ?? requestedModel;
  let modeloIntento = requestedModel;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const reqOptions = opcionesGemini();
    if (!reqOptions) {
      if (reserva) console.warn("[agent-llm] Se acabó el tiempo para Gemini: paso al respaldo (OpenRouter).");
      break;
    }

    const key = getNextGeminiKey();
    if (!key) break;
    if (triedKeys.has(key) && triedKeys.size >= allKeys.length) break;
    triedKeys.add(key);

    const client = getGeminiClient(key);
    if (!client) continue;

    try {
      return await llamar("gemini", client, { ...params, model: modeloIntento }, reqOptions);
    } catch (err: unknown) {
      lastErr = err;
      if (!geminiErr) geminiErr = err;
      const error = err as { status?: number; code?: string | number; message?: string };
      const status = error?.status;

      // Sin respuesta a tiempo (status undefined) o error del servidor: Google está lento o
      // saturado. Se marca para que las próximas llamadas vayan directo al respaldo.
      if (status === undefined || (typeof status === "number" && status >= 500)) {
        modeloIntento = modeloLite;
        marcarGeminiSaturado();
      }

      // 503 = Sobrecarga del modelo en Google -> un intento con otro modelo lite y, si
      // también falla, al respaldo.
      if (status === 503) {
        gemini503Count++;
        console.warn(`[agent-llm] Modelo ${modeloIntento} saturado (503) en clave ...${key.slice(-8)}.`);
        markGeminiKeyRateLimited(key, 30);

        if (openRouter) {
          console.warn("[agent-llm] Gemini saturado (503): paso de inmediato a OpenRouter.");
          break;
        }
        for (const fallbackModel of GEMINI_FALLBACK_MODELS) {
          if (fallbackModel === requestedModel) continue;
          const fbOpts = opcionesGemini();
          if (!fbOpts) break;
          try {
            console.info(`[agent-llm] Intentando modelo Gemini alternativo ${fallbackModel}...`);
            return await llamar("gemini", client, { ...params, model: fallbackModel }, fbOpts);
          } catch (fbErr: any) {
            console.warn(`[agent-llm] Fallback ${fallbackModel} también falló:`, fbErr?.message || fbErr);
          }
        }
        if (gemini503Count >= 2) break;
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
          if (fallbackModel === modeloIntento) continue;
          const fbOpts = opcionesGemini();
          if (!fbOpts) break;
          try {
            console.info(`[agent-llm] Intentando modelo Gemini alternativo ${fallbackModel}...`);
            return await llamar("gemini", client, { ...params, model: fallbackModel }, fbOpts);
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

  // 2. Respaldo pagado en OpenRouter con el tiempo reservado (si no se probó ya al inicio).
  //    Los modelos se pueden cambiar sin desplegar con OPENROUTER_MODELS="modelo1,modelo2".
  if (!openRouterProbado) {
    const r = await probarOpenRouter();
    if (r) return r;
  }

  // 3. Groq solo si está encendido a propósito (GROQ_ENABLED=on).
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

  if (Date.now() >= deadline) {
    throw new Error("Timeout de IA: límite máximo de 45s alcanzado");
  }

  // Si todos los respaldos fallaron, lanzar el error original para trazabilidad
  throw geminiErr || lastErr || new Error("No hay proveedores de LLM disponibles");
}
