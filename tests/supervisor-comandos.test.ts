import { describe, expect, it } from "vitest";
import { interpretarComando, pareceOrdenNoEntendida, separarPedidoYMonto } from "@/lib/supervisor/parser";

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

describe("corrección del pedido a mitad de una orden", () => {
  it("toma el número de pedido de una corrección", async () => {
    const { interpretarCorreccion } = await import("@/lib/supervisor/parser");
    expect(interpretarCorreccion("no no pedido es 1084")).toBe("1084");
    expect(interpretarCorreccion("No, era el 1084")).toBe("1084");
    expect(interpretarCorreccion("me equivoqué, es el #1084")).toBe("1084");
    expect(interpretarCorreccion("1084")).toBe("1084");
    expect(interpretarCorreccion("pedido LEG-1066")).toBe("LEG-1066");
  });

  it("no confunde montos, órdenes ni conversación con una corrección", async () => {
    const { interpretarCorreccion } = await import("@/lib/supervisor/parser");
    expect(interpretarCorreccion("no")).toBeNull();
    expect(interpretarCorreccion("pagó 1084 99")).toBeNull();
    expect(interpretarCorreccion("1084 99")).toBeNull();
    expect(interpretarCorreccion("quiero 3 frascos de 199")).toBeNull();
    expect(interpretarCorreccion("es S/ 99.50")).toBeNull();
    expect(interpretarCorreccion("12")).toBeNull();
  });

  it("«no no pedido es 1084» no es una orden nueva ni un cancelar", () => {
    expect(tipo("no no pedido es 1084")).toBeNull();
  });
});

describe("adelanto confirmado por el supervisor (20/11, #1153 Manuel Vertiz)", () => {
  it("«Confirma el adelanto de Manuel Vertiz orden 1153» es la orden de adelanto del pedido 1153", () => {
    const c = interpretarComando("Confirma el adelanto de Manuel Vertiz orden 1153")!;
    expect(c.tipo).toBe("adelanto");
    expect(c.numeros.map((t) => t.texto)).toEqual(["1153"]);
    expect(c.nombre).toBe("manuel vertiz");
  });

  it("acepta las formas cortas y no toma el S/20 como pedido", () => {
    expect(tipo("adelanto 1153")).toBe("adelanto");
    expect(tipo("valida adelanto #1153")).toBe("adelanto");
    expect(tipo("llegó el adelanto de 1153")).toBe("adelanto");
    const c = interpretarComando("adelanto 1153 s/20")!;
    expect(c.numeros.map((t) => t.texto)).toEqual(["1153"]);
    const d = interpretarComando("pagó el adelanto 1153 20")!;
    expect(d.tipo).toBe("adelanto");
    expect(d.numeros.map((t) => t.texto)).toEqual(["1153"]);
  });

  it("«confirma 1153» sin SI no ejecuta nada; si no se entiende, no va al bot de ventas", () => {
    expect(tipo("Confirma 1153")).toBeNull();
    expect(pareceOrdenNoEntendida("Confirma 1153")).toBe(true);
    expect(pareceOrdenNoEntendida("Marca el pedido de Manuel")).toBe(true);
    expect(pareceOrdenNoEntendida("hola, cuánto cuesta el NAC600?")).toBe(false);
    expect(pareceOrdenNoEntendida("quiero 3 frascos para Trujillo")).toBe(false);
  });

  it("la clave sigue siendo la orden de clave aunque mencione el adelanto", () => {
    expect(tipo("clave 1153 ya pagó adelanto")).toBe("clave");
  });
});
