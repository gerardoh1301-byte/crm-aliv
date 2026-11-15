import { describe, expect, it } from "vitest";
import { renderPedidosCliente } from "../src/lib/agent/prompt";

describe("contexto de pedidos del cliente", () => {
  it("un pedido por confirmar se retoma, no se trata como compra previa", () => {
    const t = renderPedidosCliente([
      { numeroOrden: "#1071", total: "199.00", estado: "por_confirmar_cod", items: [{ cantidad: 3, titulo: "NAC600" }], direccionEnvio: "Calle 11 san" },
    ]);
    expect(t).toContain("EN CURSO");
    expect(t).toContain("#1071");
    expect(t).toContain("Calle 11 san");
    expect(t).not.toContain("recurrente de forma cálida");
  });
  it("un pedido entregado si cuenta como cliente recurrente", () => {
    const t = renderPedidosCliente([{ numeroOrden: "#1051", total: "119.00", estado: "entregado", items: [] }]);
    expect(t).toContain("cliente recurrente");
    expect(t).not.toContain("EN CURSO");
  });
  it("un pedido cancelado no aparece", () => {
    expect(renderPedidosCliente([{ numeroOrden: "#1", total: "1", estado: "cancelado", items: [] }])).toBe("");
  });
});
