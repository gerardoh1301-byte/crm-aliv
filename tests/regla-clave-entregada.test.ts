import { describe, expect, it } from "vitest";
import { extraerFinanzasShalom, saldoPorClaveEntregada } from "@/lib/finanzas/tags-shalom";

describe("regla clave entregada = saldo cobrado", () => {
  it("saldo = total menos adelanto de S/ 20 si no hay otro registrado", () => {
    expect(saldoPorClaveEntregada(199, null)).toBe(179);
  });
  it("usa el adelanto registrado en las notas", () => {
    const f = extraerFinanzasShalom("[ADELANTO_MONTO:30.00|OP:1|FECHA:2026-11-18|CUENTA:BCP]");
    expect(saldoPorClaveEntregada(189, f)).toBe(159);
  });
  it("nunca da negativo", () => {
    expect(saldoPorClaveEntregada(10, null)).toBe(0);
  });
});
