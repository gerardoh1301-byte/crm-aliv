const VENTANA_MS = 15 * 60 * 1000; // 15 minutos
const MAX_INTENTOS = 5;

interface RegistroIntentos {
  count: number;
  resetAt: number;
}

const intentosPorIp = new Map<string, RegistroIntentos>();

export function obtenerIpCliente(headers: Headers): string {
  const xff = headers.get("x-forwarded-for");
  if (xff) {
    const primeraIp = xff.split(",")[0]?.trim();
    if (primeraIp) return primeraIp;
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
}
