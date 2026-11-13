import { describe, it, expect, beforeEach } from "vitest";
import {
  getAllGeminiKeys,
  getNextGeminiKey,
  markGeminiKeyRateLimited,
  resetGeminiPoolForTest,
} from "@/lib/gemini-keys";

describe("Pool y Rotación de Claves Gemini (GEMINI_API_KEYS)", () => {
  const originalEnvKeys = process.env.GEMINI_API_KEYS;
  const originalEnvKey = process.env.GEMINI_API_KEY;

  beforeEach(() => {
    resetGeminiPoolForTest();
    delete process.env.GEMINI_API_KEYS;
    delete process.env.GEMINI_API_KEY;
  });

  it("parsea múltiples claves separadas por coma o salto de línea y deduplica", () => {
    process.env.GEMINI_API_KEYS = "key_alpha_123456789, key_beta_123456789\nkey_gamma_123456789";
    process.env.GEMINI_API_KEY = "key_alpha_123456789"; // Duplicada

    const keys = getAllGeminiKeys();
    expect(keys).toEqual([
      "key_alpha_123456789",
      "key_beta_123456789",
      "key_gamma_123456789",
    ]);
  });

  it("rota las claves usando Round-Robin", () => {
    process.env.GEMINI_API_KEYS = "key_1_123456789, key_2_123456789, key_3_123456789";

    const first = getNextGeminiKey();
    const second = getNextGeminiKey();
    const third = getNextGeminiKey();
    const fourth = getNextGeminiKey();

    expect(first).toBe("key_1_123456789");
    expect(second).toBe("key_2_123456789");
    expect(third).toBe("key_3_123456789");
    expect(fourth).toBe("key_1_123456789"); // Da la vuelta
  });

  it("omite inmediatamente una clave que esté en cooldown por 429", () => {
    process.env.GEMINI_API_KEYS = "key_1_123456789, key_2_123456789";

    // Marcamos key_1 en cooldown
    markGeminiKeyRateLimited("key_1_123456789", 60);

    // Las siguientes peticiones deben usar únicamente key_2
    expect(getNextGeminiKey()).toBe("key_2_123456789");
    expect(getNextGeminiKey()).toBe("key_2_123456789");
  });
});
