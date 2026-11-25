const VENTANA_MS = 15 * 60 * 1000; // 15 minutos
const MAX_INTENTOS = 5;

interface RegistroIntentos {
  count: number;
  resetAt: number;
}

const intentosPorIp = new Map<string, RegistroIntentos>();

// Tope global (todas las IP juntas) por si alguien reparte intentos entre muchas IP.
const MAX_GLOBAL = 30;
const global: RegistroIntentos = { count: 0, resetAt: 0 };

// 24/11 (auditoría CRM-01.3): el primer valor de X-Forwarded-For lo escribe el cliente y
// cambiándolo se saltaba el límite. Render pasa por Cloudflare: IP real en CF-Connecting-IP.
export function obtenerIpCliente(headers: Headers): string {
  const cf = (headers.get("cf-connecting-ip") || headers.get("true-client-ip"))?.trim();
  if (cf) return cf;
  const xff = headers.get("x-forwarded-for");
  if (xff) {
    const partes = xff.split(",").map((s) => s.trim()).filter(Boolean);
    if (partes.length) return partes[partes.length - 1];
  }
  const realIp = headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;
  return "ip-local";
}

export function verificarLimiteIntentosLogin(
  ip: string,
  ahoraMs: number = Date.now()
): {
  permitido: boolean;
  retryAfterSeg: number;
  intentosRestantes: number;
} {
  if (ahoraMs >= global.resetAt) {
    global.count = 0;
    global.resetAt = ahoraMs + VENTANA_MS;
  }
  if (global.count >= MAX_GLOBAL) {
    return {
      permitido: false,
      retryAfterSeg: Math.max(1, Math.ceil((global.resetAt - ahoraMs) / 1000)),
      intentosRestantes: 0,
    };
  }
  const reg = intentosPorIp.get(ip);
  if (!reg || ahoraMs >= reg.resetAt) {
    if (reg) intentosPorIp.delete(ip);
    return {
      permitido: true,
      retryAfterSeg: 0,
      intentosRestantes: MAX_INTENTOS,
    };
  }

  if (reg.count >= MAX_INTENTOS) {
    const retryAfterSeg = Math.max(1, Math.ceil((reg.resetAt - ahoraMs) / 1000));
    return {
      permitido: false,
      retryAfterSeg,
      intentosRestantes: 0,
    };
  }

  return {
    permitido: true,
    retryAfterSeg: 0,
    intentosRestantes: MAX_INTENTOS - reg.count,
  };
}

export function registrarIntentoFallidoLogin(
  ip: string,
  ahoraMs: number = Date.now()
): RegistroIntentos {
  if (ahoraMs >= global.resetAt) {
    global.count = 0;
    global.resetAt = ahoraMs + VENTANA_MS;
  }
  global.count += 1;
  if (intentosPorIp.size > 5000) intentosPorIp.clear();
  const actual = intentosPorIp.get(ip);
  if (!actual || ahoraMs >= actual.resetAt) {
    const nuevo: RegistroIntentos = {
      count: 1,
      resetAt: ahoraMs + VENTANA_MS,
    };
    intentosPorIp.set(ip, nuevo);
    return nuevo;
  }

  actual.count += 1;
  intentosPorIp.set(ip, actual);
  return actual;
}

export function limpiarIntentosLogin(ip: string): void {
  intentosPorIp.delete(ip);
}

export function resetearTodoRateLimitLogin(): void {
  intentosPorIp.clear();
  global.count = 0;
  global.resetAt = 0;
}
