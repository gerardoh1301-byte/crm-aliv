import { describe, expect, it } from "vitest";
import { etiquetaValidacion, mensajeValidado, tipoValidacion, yaValidado } from "@/lib/pedidos/validar-reglas";
import { obtenerClaveEtapaDeEtiqueta, obtenerEtiquetaDeEtapa } from "@/lib/tags";

describe("mejora 3: por validar", () => {
  it("AG (por_confirmar_cod) valida Yape; CE valida dirección", () => {
    expect(tipoValidacion({ estado: "por_confirmar_cod", modalidadPago: "contraentrega" })).toBe("yape");
    expect(tipoValidacion({ estado: "confirmado", modalidadPago: "adelanto_agencia" })).toBe("yape");
    expect(tipoValidacion({ estado: "confirmado", modalidadPago: "contraentrega" })).toBe("direccion");
    expect(etiquetaValidacion("yape")).toBe("⏳ Por validar Yape");
  });

  it("mensaje al cliente con el número visible", () => {
    expect(mensajeValidado("#1148")).toBe(
      "✅ *Pedido confirmado:* Hemos validado tus datos correctamente y tu pedido #1148 ya pasó al área de despacho."
    );
  });

  it("idempotencia por marca", () => {
    expect(yaValidado("[VALIDADO] Yape validado por Ana")).toBe(true);
    expect(yaValidado(null)).toBe(false);
  });

  it("la etapa por_validar no cae en «Agendar entrega» aunque diga confirmado", () => {
    expect(obtenerEtiquetaDeEtapa({ key: "por_validar", name: "Confirmado por bot (por validar)" })).toBe("Por validar");
    expect(obtenerClaveEtapaDeEtiqueta("Por validar")).toBe("por_validar");
    expect(obtenerEtiquetaDeEtapa({ key: "agendar_entrega", name: "Pedido confirmado (por despachar)" })).not.toBe("Por validar");
  });
});
