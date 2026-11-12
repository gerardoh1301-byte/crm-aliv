import OpenAI from "openai";
import { getConfig, marca } from "@/lib/config";

const DEFAULT_MODEL = "gemini-3.5-flash";
const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai/";

let geminiClient: OpenAI | null = null;
let openRouterClient: OpenAI | null = null;

function getGeminiClient(): OpenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  if (!geminiClient) {
    geminiClient = new OpenAI({
      apiKey,
      baseURL: GEMINI_BASE_URL,
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
 * Si no, usa OpenRouter con su propia URL y clave (evita el bug de mezclar claves).
 */
export function getOpenRouterClient(): OpenAI {
  const gemini = getGeminiClient();
  if (gemini) return gemini;

  const openRouter = getOpenRouterClientOnly();
  if (openRouter) return openRouter;

  throw new Error("Ni GEMINI_API_KEY ni OPENROUTER_API_KEY configuradas");
}

export function getAgentModel(): string {
  if (process.env.GEMINI_API_KEY) {
    return process.env.AGENT_MODEL || "gemini-3.5-flash";
  }
  return process.env.AGENT_MODEL || getConfig().agente.modelo || DEFAULT_MODEL;
}

export function hasOpenRouterKey(): boolean {
  return Boolean(process.env.GEMINI_API_KEY || process.env.OPENROUTER_API_KEY);
}

/**
 * Ejecuta la llamada al LLM con reintento automático y conmutación por error (failover).
 * Si el proveedor principal devuelve 429 (cuota) o 503 (saturación), reintenta
 * con una breve pausa y un modelo de respaldo (gemini-2.5-flash u OpenRouter).
 */
export async function createChatCompletionWithFallback(
  params: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming
): Promise<OpenAI.Chat.Completions.ChatCompletion> {
  const primaryClient = getOpenRouterClient();
  const primaryModel = params.model;

  try {
    return await primaryClient.chat.completions.create(params);
  } catch (err: unknown) {
    const error = err as { status?: number; code?: string | number; message?: string };
    const status = error?.status;
    const isRateLimitOrUnavailable = status === 429 || status === 503 || status === 500;

    console.warn(
      `[agent-llm] Fallo en modelo primario (${primaryModel}, status ${status}): ${error?.message || err}. Iniciando failover...`
    );

    if (!isRateLimitOrUnavailable && status !== undefined) {
      // Si fue error de validación o 400/401 no transitorio, propagar
      throw err;
    }

    // Espera breve de cortesía antes del respaldo (1.5 segundos)
    await new Promise((resolve) => setTimeout(resolve, 1500));

    // Determinar cliente y modelo de respaldo
    let fallbackClient = getOpenRouterClientOnly();
    let fallbackModel = "google/gemini-2.5-flash";

    if (!fallbackClient && process.env.GEMINI_API_KEY) {
      // Si solo tenemos Gemini directo, cambiar al modelo estable de respaldo
      fallbackClient = getGeminiClient();
      fallbackModel = primaryModel.includes("3.5") ? "gemini-2.5-flash" : "gemini-2.0-flash";
    }

    if (!fallbackClient) {
      throw err;
    }

    console.info(`[agent-llm] Intentando llamada con modelo de respaldo: ${fallbackModel}`);
    return await fallbackClient.chat.completions.create({
      ...params,
      model: fallbackModel,
    });
  }
}
