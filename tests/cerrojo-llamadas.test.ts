import { describe, expect, it } from "vitest";
import { motivoOmitirLlamada, resultadosLlamadaEnNotas } from "@/lib/voice/llamar-pedido-reglas";

describe("Cerrojo de créditos de las llamadas IA (27/11)", () => {
  it("lee los resultados de llamadas anteriores en las notas", () => {
    const notas = [
      "Pedido web",
      "[LLAMADA_IA_INICIADA] 2026-11-27T21:06:00Z conv=x",
      "[LLAMADA_IA_RESULTADO] 2026-11-27T21:07:00Z estado=no_contesto duracion=30s",
      "[LLAMADA_IA_RESULTADO] 2026-11-28T15:00:00Z estado=confirmado duracion=60s",
    ].join("\n");
    expect(resultadosLlamadaEnNotas(notas)).toEqual(["no_contesto", "confirmado"]);
    expect(resultadosLlamadaEnNotas(null)).toEqual([]);
  });

  it("llama a un pedido web nuevo por confirmar", () => {
    expect(motivoOmitirLlamada({ numeroOrden: "#1218", estadoPedido: "por_confirmar_cod", resultadosPrevios: [] })).toBeNull();
    expect(motivoOmitirLlamada({ numeroOrden: "#1218", estadoPedido: "por_confirmar_cod", resultadosPrevios: ["confirmado"] })).toBeNull();
  });

  it("no llama a pedidos del chat", () => {
    expect(motivoOmitirLlamada({ numeroOrden: "CHAT-0004", estadoPedido: "por_confirmar_cod" })).toMatch(/chat/);
  });

  it("no llama si el pedido ya no está por confirmar, salvo la llamada de completar datos", () => {
    expect(motivoOmitirLlamada({ numeroOrden: "#1218", estadoPedido: "confirmado" })).toMatch(/ya no está por confirmar/);
    expect(motivoOmitirLlamada({ numeroOrden: "#1218", estadoPedido: "confirmado", yaConfirmado: true })).toBeNull();
  });

  it("no vuelve a llamar a quien dejó una llamada anterior en silencio o buzón", () => {
    expect(
      motivoOmitirLlamada({ numeroOrden: "#1218", estadoPedido: "por_confirmar_cod", resultadosPrevios: ["no_contesto"] })
    ).toMatch(/no contestó/);
  });
});
