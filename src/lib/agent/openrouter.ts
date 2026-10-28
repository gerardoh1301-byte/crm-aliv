import OpenAI from "openai";
import { getConfig, marca } from "@/lib/config";

const DEFAULT_MODEL = "gemini-3.5-flash";
const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai/";

let client: OpenAI | null = null;

/**
 * Cliente OpenAI-compatible apuntando a Google Gemini Oficial o OpenRouter.
 */
export function getOpenRouterClient(): OpenAI {
  const geminiKey = process.env.GEMINI_API_KEY;
  const openRouterKey = process.env.OPENROUTER_API_KEY;
  const apiKey = geminiKey || openRouterKey;

  if (!apiKey) {
    throw new Error("Ni GEMINI_API_KEY ni OPENROUTER_API_KEY configuradas");
  }

  if (!client) {
    const isGemini = Boolean(geminiKey && !openRouterKey);
    client = new OpenAI({
      apiKey,
      baseURL: isGemini ? GEMINI_BASE_URL : OPENROUTER_BASE_URL,
      defaultHeaders: isGemini
        ? {}
        : {
            "HTTP-Referer": process.env.APP_BASE_URL || "http://localhost:3000",
            "X-Title": marca().nombre,
          },
    });
  }
  return client;
}

/** AGENT_MODEL (entorno) -> config.agente.modelo -> default del nucleo. */
export function getAgentModel(): string {
  if (process.env.GEMINI_API_KEY && !process.env.OPENROUTER_API_KEY) {
    return process.env.AGENT_MODEL || "gemini-3.5-flash";
  }
  return process.env.AGENT_MODEL || getConfig().agente.modelo || DEFAULT_MODEL;
}

export function hasOpenRouterKey(): boolean {
  return Boolean(process.env.GEMINI_API_KEY || process.env.OPENROUTER_API_KEY);
}
