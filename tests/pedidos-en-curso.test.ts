import { describe, expect, it } from "vitest";
import { renderPedidosCliente, resolverNombreHumanoCliente } from "../src/lib/agent/prompt";

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

describe("resolución inteligente del nombre humano del cliente", () => {
  it("rescata el nombre real desde el mensaje de pedido web aunque el perfil sea iniciales o punto", () => {
    const res1 = resolverNombreHumanoCliente("😎C.O.F. MADRE 🤓", [
      { direction: "out", body: "¡Hola, Yesica! 👋 Te saluda Aliv Perú.\nRecibimos tu pedido *#1023*: 3 frascos de NAC600 por *S/199*." },
    ]);
    expect(res1.nombreLimpio).toBe("Yesica");
    expect(res1.esAliasOCodigo).toBe(false);

    const res2 = resolverNombreHumanoCliente(".", [
      { direction: "out", body: "¡Hola, José! 👋 Te saluda Aliv Perú.\nRecibimos tu pedido #1081." },
    ]);
    expect(res2.nombreLimpio).toBe("José");
  });

  it("descarta handles con números, teléfonos y frases como nombres de pila", () => {
    expect(resolverNombreHumanoCliente("anacarrera2318").nombreLimpio).toBeNull();
    expect(resolverNombreHumanoCliente("51945226853").nombreLimpio).toBeNull();
    expect(resolverNombreHumanoCliente("si nombró con amor lo atr").nombreLimpio).toBeNull();
    expect(resolverNombreHumanoCliente("St3fit0s06081482💪🏻").nombreLimpio).toBeNull();
  });

  it("acepta y capitaliza nombres humanos reales", () => {
    expect(resolverNombreHumanoCliente("HILDA").nombreLimpio).toBe("Hilda");
    expect(resolverNombreHumanoCliente("María Elizabeth").nombreLimpio).toBe("María");
  });
});
