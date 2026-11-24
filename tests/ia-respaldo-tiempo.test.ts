import { beforeEach, describe, expect, it, vi } from "vitest";

// Cada cliente OpenAI responde según su baseURL: Gemini con el error que fije la prueba,
// OpenRouter con éxito. Así se prueba el orden real de los intentos.
const llamadas: { proveedor: string; modelo: string; timeout?: number }[] = [];
let errorGemini: { status?: number; message: string } | null = null;

vi.mock("openai", () => {
  class OpenAI {
    baseURL: string;
    constructor(opts: { baseURL: string }) {
      this.baseURL = opts.baseURL;
    }
    chat = {
      completions: {
        create: async (body: { model: string }, opts?: { timeout?: number }) => {
          const proveedor = this.baseURL.includes("openrouter") ? "openrouter" : "gemini";
          llamadas.push({ proveedor, modelo: body.model, timeout: opts?.timeout });
          if (proveedor === "gemini" && errorGemini) throw Object.assign(new Error(errorGemini.message), errorGemini);
          return { choices: [{ message: { content: proveedor } }], usage: {} };
        },
      },
    };
  }
  return { default: OpenAI };
});
vi.mock("@/lib/ia-uso", () => ({ anotarUsoIA: vi.fn(), leerUsage: () => ({ entrada: 0, salida: 0, cache: 0 }) }));
vi.mock("@/lib/config", () => ({ getConfig: () => ({}), marca: () => ({ nombre: "Prueba" }) }));
vi.mock("@/lib/gemini-keys", () => {
  const claves = ["clave-uno-aaaaaaaa", "clave-dos-bbbbbbbb", "clave-tres-cccccccc"];
  let i = 0;
  return {
    getAllGeminiKeys: () => claves,
    getNextGeminiKey: () => claves[i++ % claves.length],
    markGeminiKeyRateLimited: vi.fn(),
  };
});

const ia = await import("@/lib/agent/openrouter");

beforeEach(() => {
  llamadas.length = 0;
  errorGemini = null;
  ia.reiniciarEstadoGemini();
  process.env.OPENROUTER_API_KEY = "or-prueba";
});

const pedir = (totalTimeoutMs = 40_000) =>
  ia.createChatCompletionWithFallback(
    { model: "gemini-3.5-flash-lite", messages: [{ role: "user", content: "hola" }] },
    { origen: "prueba", timeout: 20_000, totalTimeoutMs }
  );

describe("tiempos del respaldo", () => {
  it("Gemini nunca usa la reserva de OpenRouter", () => {
    expect(ia.tiempoParaGemini(40_000, 15_000, 20_000)).toBe(20_000);
    expect(ia.tiempoParaGemini(25_000, 15_000, 12_000)).toBe(10_000);
    expect(ia.tiempoParaGemini(17_000, 15_000, 12_000)).toBeNull();
    expect(ia.tiempoParaGemini(17_000, 0, 12_000)).toBe(12_000);
  });

  it("OpenRouter recibe al menos 15 s si quedan, nunca más de lo que queda", () => {
    expect(ia.tiempoParaRespaldo(16_000, 12_000)).toBe(15_000);
    expect(ia.tiempoParaRespaldo(40_000, 20_000)).toBe(20_000);
    expect(ia.tiempoParaRespaldo(9_000, 12_000)).toBe(9_000);
    expect(ia.tiempoParaRespaldo(500, 12_000)).toBeNull();
  });

  it("la marca de Gemini saturado dura 3 minutos", () => {
    ia.marcarGeminiSaturado(1_000);
    expect(ia.geminiSaturado(1_000 + 60_000)).toBe(true);
    expect(ia.geminiSaturado(1_000 + ia.PAUSA_GEMINI_SATURADO_MS)).toBe(false);
  });
});

describe("Gemini saturado (24/11 8:01)", () => {
  it("con un 503 pasa de inmediato a OpenRouter y responde", async () => {
    errorGemini = { status: 503, message: "503 status code (no body)" };
    const r = await pedir();
    expect(r.choices[0].message.content).toBe("openrouter");
    expect(llamadas.map((l) => l.proveedor)).toEqual(["gemini", "openrouter"]);
    expect(llamadas[1].timeout).toBeGreaterThanOrEqual(15_000);
  });

  it("la llamada siguiente va directo a OpenRouter sin tocar Gemini", async () => {
    errorGemini = { status: 503, message: "saturado" };
    await pedir();
    llamadas.length = 0;
    const r = await pedir();
    expect(r.choices[0].message.content).toBe("openrouter");
    expect(llamadas.map((l) => l.proveedor)).toEqual(["openrouter"]);
  });

  it("sin OpenRouter configurado sigue probando modelos Gemini", async () => {
    delete process.env.OPENROUTER_API_KEY;
    errorGemini = { status: 503, message: "saturado" };
    await expect(pedir()).rejects.toThrow();
    expect(llamadas.every((l) => l.proveedor === "gemini")).toBe(true);
    expect(llamadas.some((l) => l.modelo === "gemini-2.5-flash")).toBe(false);
  });

  it("si Gemini responde, no se usa OpenRouter", async () => {
    const r = await pedir();
    expect(r.choices[0].message.content).toBe("gemini");
    expect(llamadas.map((l) => l.proveedor)).toEqual(["gemini"]);
  });
});
