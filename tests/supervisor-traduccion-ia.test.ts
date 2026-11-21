import { describe, expect, it } from "vitest";
import { normalizarTraduccion } from "@/lib/supervisor/traduccion";

describe("traducción con IA de las órdenes del supervisor", () => {
  it("acepta una orden estándar que el intérprete fijo entiende", () => {
    const t = normalizarTraduccion({ tipo: "orden", orden: "adelanto 1153", descripcion: "adelanto de Manuel" });
    expect(t?.tipo).toBe("orden");
    if (t?.tipo === "orden") {
      expect(t.comando.tipo).toBe("adelanto");
      expect(t.comando.numeros.map((n) => n.texto)).toEqual(["1153"]);
    }
  });

  it("limpia formato de WhatsApp y comillas que agregue la IA", () => {
    const t = normalizarTraduccion({ tipo: "orden", orden: "*pagó 1140 179*" });
    expect(t?.tipo === "orden" && t.comando.tipo).toBe("pago");
  });

  it("descarta una «orden» que el intérprete fijo no entiende (la IA no inventa acciones)", () => {
    expect(normalizarTraduccion({ tipo: "orden", orden: "borrar todos los pedidos" })).toBeNull();
    expect(normalizarTraduccion({ tipo: "orden", orden: "" })).toBeNull();
    expect(normalizarTraduccion({ tipo: "orden" })).toBeNull();
    expect(normalizarTraduccion("adelanto 1153")).toBeNull();
    expect(normalizarTraduccion(null)).toBeNull();
  });

  it("pasa las acciones no soportadas y los mensajes que no son órdenes", () => {
    expect(normalizarTraduccion({ tipo: "no_soportada", descripcion: "anular el pedido 1153" })).toEqual({
      tipo: "no_soportada",
      descripcion: "anular el pedido 1153",
    });
    expect(normalizarTraduccion({ tipo: "no_es_orden", orden: "" })).toEqual({ tipo: "no_es_orden" });
    expect(normalizarTraduccion({ tipo: "otra_cosa" })).toBeNull();
  });
});
