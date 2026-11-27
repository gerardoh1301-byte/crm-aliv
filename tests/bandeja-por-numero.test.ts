import { describe, expect, it } from "vitest";
import { cuentaPermitida } from "@/lib/channels/numeros-reglas";

// 26/11: en el perfil de Rossana (vendedora del 977) aparecían también los chats del 944.
describe("bandeja de un vendedor con número propio", () => {
  it("sin restricción (admin o vendedor sin número propio) ve todo", () => {
    expect(cuentaPermitida("a-bot", undefined)).toBe(true);
    expect(cuentaPermitida(null, undefined)).toBe(true);
  });
  it("con número propio solo ve los hilos de ese número", () => {
    expect(cuentaPermitida("a-vend", ["a-vend"])).toBe(true);
    expect(cuentaPermitida("a-bot", ["a-vend"])).toBe(false);
    // Hilos históricos sin cuenta: eran del número del bot.
    expect(cuentaPermitida(null, ["a-vend"])).toBe(false);
    expect(cuentaPermitida("a-vend", [])).toBe(false);
  });
});
