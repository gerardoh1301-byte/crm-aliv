import { beforeEach, describe, expect, it } from "vitest";
import {
  obtenerIpCliente,
  registrarIntentoFallidoLogin,
  resetearTodoRateLimitLogin,
  verificarLimiteIntentosLogin,
} from "@/lib/rate-limit-login";

describe("auditoría 24/11: límite de intentos de PIN", () => {
  beforeEach(() => resetearTodoRateLimitLogin());

  it("usa CF-Connecting-IP y no el primer X-Forwarded-For que escribe el cliente", () => {
    const h = new Headers({ "x-forwarded-for": "1.1.1.1, 9.9.9.9", "cf-connecting-ip": "8.8.8.8" });
    expect(obtenerIpCliente(h)).toBe("8.8.8.8");
    const sinCf = new Headers({ "x-forwarded-for": "1.1.1.1, 9.9.9.9" });
    expect(obtenerIpCliente(sinCf)).toBe("9.9.9.9");
  });

  it("bloquea a todos tras 30 fallos aunque vengan de IP distintas", () => {
    const t = 1_000_000;
    for (let i = 0; i < 30; i++) registrarIntentoFallidoLogin(`10.0.0.${i}`, t);
    expect(verificarLimiteIntentosLogin("10.9.9.9", t).permitido).toBe(false);
    expect(verificarLimiteIntentosLogin("10.9.9.9", t + 16 * 60 * 1000).permitido).toBe(true);
  });
});
