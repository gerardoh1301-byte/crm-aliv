import { describe, expect, it } from "vitest";
import { esOrdenDirecta, interpretarComando } from "@/lib/supervisor/parser";

const ANGY =
  "Angy de orden #1047, no respondió mas cuando se le solicitó adelanto de 20 soles, muevelo a cancelado, no debe figurar como confirmado en pipeline.";

describe("intérprete de intención (22/11, orden #1047)", () => {
  it("un mensaje largo no lo lee directo el intérprete fijo: pasa primero por la IA", () => {
    expect(esOrdenDirecta(ANGY)).toBe(false);
    expect(esOrdenDirecta("adelanto 1047")).toBe(true);
    expect(esOrdenDirecta("SI 1047")).toBe(true);
    expect(esOrdenDirecta("Confirma el adelanto de Manuel orden 1153")).toBe(true);
    expect(esOrdenDirecta("cancela 1047 porque no respondió cuando le pedimos el adelanto de 20 soles por yape ayer")).toBe(true);
  });

  it("si la IA no responde, el intérprete fijo lo entiende como cancelar el 1047, no como adelanto", () => {
    const c = interpretarComando(ANGY)!;
    expect(c.tipo).toBe("cancelar_pedido");
    expect(c.numeros.map((t) => t.texto)).toEqual(["1047"]);
    expect(c.nombre).toBeNull();
    expect(c.valor).toContain("no respondió");
  });

  it("las órdenes cortas siguen igual", () => {
    expect(interpretarComando("adelanto 1047")?.tipo).toBe("adelanto");
    expect(interpretarComando("Confirma el adelanto de Manuel orden 1153")?.tipo).toBe("adelanto");
    expect(interpretarComando("cancela 1047 porque no respondió al adelanto")?.tipo).toBe("cancelar_pedido");
    expect(interpretarComando("pago 1140 179")?.tipo).toBe("pago");
    expect(interpretarComando("entregado 1142")?.tipo).toBe("entregado");
    expect(interpretarComando("pasa 1140 a cancelado")?.tipo).toBe("cancelar_pedido");
  });

  it("una negación nunca confirma un pago, adelanto o entrega", () => {
    expect(interpretarComando("Manuel no pagó todavía 1153")).toBeNull();
    expect(interpretarComando("el 1153 no mandó el adelanto")).toBeNull();
    expect(interpretarComando("1142 todavía no recogió")).toBeNull();
  });

  it("«no lo canceles» no cancela", () => {
    expect(interpretarComando("el #1047 no lo canceles, ya respondió")?.tipo).not.toBe("cancelar_pedido");
  });

  it("una palabra clave suelta en un texto largo no dispara la orden", () => {
    expect(
      interpretarComando("oye revisa a la señora del 1150 que me escribió por el flete y dice que la agencia no le contesta nada")
    ).toBeNull();
  });
});

import { normalizarTraduccion } from "@/lib/supervisor/traduccion";

describe("traducción de la IA (intérprete previo)", () => {
  it("la intención de cancelar el 1047 llega como cancelar_pedido con su motivo", () => {
    const t = normalizarTraduccion({ tipo: "orden", orden: "cancela 1047 porque no respondió al pedido de adelanto", descripcion: "cancelar 1047" });
    expect(t?.tipo).toBe("orden");
    if (t?.tipo !== "orden") return;
    expect(t.comando.tipo).toBe("cancelar_pedido");
    expect(t.comando.valor).toBe("no respondió al pedido de adelanto");
  });
  it("una consulta libre va al asistente", () => {
    expect(normalizarTraduccion({ tipo: "consulta", descripcion: "clientes por agendar" })).toEqual({ tipo: "consulta", descripcion: "clientes por agendar" });
  });
});
