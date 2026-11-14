/**
 * Gestor de Pool y Rotación de Claves de Google Gemini API.
 *
 * Permite configurar múltiples claves (GEMINI_API_KEYS o GEMINI_API_KEY)
 * para multiplicar la cuota gratuita (15 RPM x N claves) y conmutar
 * en 0 milisegundos si alguna clave llega a recibir error 429 (Rate Limit).
 */

interface KeyState {
  key: string;
  cooldownUntil: number; // timestamp ms
  failCount: number;
}

let keysCache: KeyState[] | null = null;
let rrIndex = 0;

export function getAllGeminiKeys(): string[] {
  const envMulti = process.env.GEMINI_API_KEYS || "";
  const envSingle = process.env.GEMINI_API_KEY || "";

  const raw = [
    ...envMulti.split(/[\r\n,]+/),
    envSingle,
  ]
    .map((k) => {
      const match = k.match(/(AQ\.[A-Za-z0-9_\-]+|AIza[A-Za-z0-9_\-]+)/);
      return match ? match[1] : k.trim();
    })
    .filter((k) => k.length >= 10);

  // De-duplicar conservando orden
  return Array.from(new Set(raw));
}

function initKeys(): KeyState[] {
  const keys = getAllGeminiKeys();
  if (!keysCache || keysCache.length !== keys.length) {
    keysCache = keys.map((key) => ({
      key,
      cooldownUntil: 0,
      failCount: 0,
    }));
  }
  return keysCache;
}

/**
 * Obtiene la siguiente clave disponible usando rotación Round-Robin,
 * priorizando claves que NO estén en enfriamiento por 429.
 */
export function getNextGeminiKey(): string | null {
  const pool = initKeys();
  if (pool.length === 0) return null;
  if (pool.length === 1) return pool[0].key;

  const now = Date.now();
  // Buscar a partir del índice actual una clave disponible
  for (let i = 0; i < pool.length; i++) {
    const candidate = pool[(rrIndex + i) % pool.length];
    if (candidate.cooldownUntil <= now) {
      rrIndex = (rrIndex + i + 1) % pool.length;
      return candidate.key;
    }
  }

  // Si todas están en cooldown, usar la que tenga el cooldown más cercano a vencer
  const sorted = [...pool].sort((a, b) => a.cooldownUntil - b.cooldownUntil);
  return sorted[0].key;
}

/**
 * Marca una clave en enfriamiento temporal tras recibir 429 o 503.
 * Por defecto 60 segundos (el período estándar de cuota por minuto de Google).
 */
export function markGeminiKeyRateLimited(key: string, cooldownSec = 60): void {
  const pool = initKeys();
  const entry = pool.find((k) => k.key === key);
  if (entry) {
    entry.cooldownUntil = Date.now() + cooldownSec * 1000;
    entry.failCount += 1;
    console.warn(
      `[gemini-pool] Clave ...${key.slice(-8)} en cooldown por ${cooldownSec}s (total 429: ${entry.failCount})`
    );
  }
}

/**
 * Reinicia la caché (útil para tests).
 */
export function resetGeminiPoolForTest(): void {
  keysCache = null;
  rrIndex = 0;
}
