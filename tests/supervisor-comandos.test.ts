import { describe, expect, it } from "vitest";
import { interpretarComando, separarPedidoYMonto } from "@/lib/supervisor/parser";

const tipo = (t: string) => interpretarComando(t)?.tipo ?? null;

describe("órdenes del supervisor por WhatsApp", () => {
  it("reconoce cada orden", () => {
    expect(tipo("Jaime pagó 179")).toBe("pago");
    expect(tipo("pago completo 1140")).toBe("pago");
    expect(tipo("1140 ya yapeó S/179")).toBe("pago");
    expect(tipo("flete 1142 10")).toBe("flete");
    expect(tipo("clave 1140")).toBe("clave");
    expect(tipo("Dame la clave de Jaime")).toBe("clave");
    expect(tipo("estado 1140")).toBe("estado");
    expect(tipo("entregado 1140")).toBe("entregado");
    expect(tipo("SI 1140")).toBe("confirmar");
    expect(tipo("Sí #LEG-1049")).toBe("confirmar");
    expect(tipo("ENVIAR 1140")).toBe("enviar_clave");
    expect(tipo("no")).toBe("cancelar");
    expect(tipo("ayuda")).toBe("ayuda");
  });

  it("un «sí» sin número no confirma nada (sigue al bot de prueba)", () => {
    expect(tipo("si")).toBeNull();
    expect(tipo("sí, quiero 3 frascos")).toBeNull();
    expect(tipo("hola, cuánto cuesta el NAC600?")).toBeNull();
    expect(tipo("enviar")).toBeNull();
  });

  it("«canceló» no se confunde con cancelar ni con pagar", () => {
    expect(tipo("cancelar")).toBe("cancelar");
    expect(tipo("el cliente canceló el pedido")).toBeNull();
  });

  it("separa nombre, pedido y monto", () => {
    const c = interpretarComando("Jaime Gaspar pagó 179")!;
    expect(c.nombre).toBe("jaime gaspar");
    const { pedido, monto } = separarPedidoYMonto(c.numeros, () => false);
    expect(pedido).toBeNull();
    expect(monto).toBe(179);
  });

  it("con dos números, el que es un pedido real es el pedido y el otro el monto", () => {
    const c = interpretarComando("pagó 1140 179")!;
    const r = separarPedidoYMonto(c.numeros, (t) => t.texto === "1140");
    expect(r.pedido?.texto).toBe("1140");
    expect(r.monto).toBe(179);
  });

  it("# o prefijo marcan el pedido; S/ y decimales marcan el monto", () => {
    const c = interpretarComando("#LEG-1049 pagó S/ 169.50")!;
    const r = separarPedidoYMonto(c.numeros, () => false);
    expect(r.pedido?.texto).toBe("LEG-1049");
    expect(r.monto).toBe(169.5);
    expect(interpretarComando("pago completo 1140")!.completo).toBe(true);
  });
});
