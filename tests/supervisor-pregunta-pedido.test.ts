import { describe, expect, it } from "vitest";
import { consultaPorPedidoExplicito, interpretarComando } from "@/lib/supervisor/parser";
import { _internas, cuentasDelPedido } from "@/lib/supervisor/comandos";

type P = Parameters<typeof _internas.fichaPedido>[0];

// 22/11: Gerardo preguntó «Ya tienes toda la información para poder agendar entrega de Carlos
// Andres en la orden 1160 ?» y le contestó el bot de ventas como si él fuera el cliente.
describe("preguntas de Gerardo sobre un pedido no van al bot de ventas", () => {
  const pregunta = "Ya tienes toda la información para poder agendar entrega de Carlos Andres en la orden 1160 ?";

  it("el mensaje del 22/11 se responde con la ficha del pedido 1160", () => {
    const c = consultaPorPedidoExplicito(pregunta)!;
    expect(c.tipo).toBe("estado");
    expect(c.numeros.map((t) => t.texto)).toContain("1160");
  });

  it("reconoce las formas de nombrar un pedido", () => {
    expect(consultaPorPedidoExplicito("el #1160 está listo?")?.tipo).toBe("estado");
    expect(consultaPorPedidoExplicito("qué pasó con LEG-1066")?.tipo).toBe("estado");
    expect(consultaPorPedidoExplicito("ya salió el pedido N° 1159?")?.tipo).toBe("estado");
  });

  it("las pruebas del bot como cliente siguen yendo al bot", () => {
    expect(consultaPorPedidoExplicito("hola, cuánto cuesta el NAC600?")).toBeNull();
    expect(consultaPorPedidoExplicito("quiero 3 frascos, vivo en Lima")).toBeNull();
    expect(consultaPorPedidoExplicito("mi número es 987654321")).toBeNull();
  });

  it("las órdenes que ya se entendían no cambian", () => {
    expect(interpretarComando("estado 1140")?.tipo).toBe("estado");
    expect(interpretarComando("adelanto 1153")?.tipo).toBe("adelanto");
  });
});

describe("la ficha dice qué falta para entregar", () => {
  const base = {
    numeroOrden: "#1160",
    contactName: "Carlos Andres",
    estado: "por_confirmar_cod",
    modalidadPago: "contraentrega",
    dniCliente: null,
    direccionEnvio: "Parque",
    distrito: null,
    ciudad: "Lima",
    items: [{ cantidad: 3, titulo: "NAC600" }],
    total: "199",
    transportadora: null,
    numeroGuia: null,
    codigoRastreo: null,
    claveRecojo: null,
    notas: null,
    createdAt: new Date("2026-11-22T06:16:00Z"),
  };

  it("Lima sin número ni distrito (pedido 1160)", () => {
    const p = base as unknown as P;
    expect(_internas.faltaParaEntregar(p, false)).toEqual(["número de casa, lote o Mz en la dirección", "distrito"]);
    const texto = _internas.fichaPedido(p, cuentasDelPedido(p), "+51963299384", [
      "Cliente (22/11, 01:18 a. m.): Ok lunes",
      "Cliente (22/11, 07:21 a. m.): Parque del rey 2 etapa carabayllo",
    ]);
    expect(texto).toContain("Para entregar falta");
    expect(texto).toContain("Lima · contraentrega");
    expect(texto).not.toContain("Clave de retiro");
    expect(texto).toContain("Parque del rey 2 etapa carabayllo");
  });

  it("Lima completa", () => {
    const p = { ...base, direccionEnvio: "Mz B Lt 12 Parque del Rey 2da etapa", distrito: "Carabayllo" } as unknown as P;
    expect(_internas.faltaParaEntregar(p, false)).toEqual([]);
    expect(_internas.fichaPedido(p, cuentasDelPedido(p), null)).toContain("Datos de entrega completos");
  });

  it("provincia: DNI, agencia y adelanto", () => {
    const p = { ...base, modalidadPago: "adelanto_agencia", transportadora: "Shalom", ciudad: "Iquitos", direccionEnvio: null } as unknown as P;
    expect(_internas.faltaParaEntregar(p, false)).toEqual(["DNI", "agencia Shalom", "adelanto de S/ 20 verificado"]);
  });

  it("si ya salió no se muestra", () => {
    expect(_internas.faltaParaEntregar({ ...base, estado: "enviado" } as unknown as P, false)).toBeNull();
  });

  it("resume los mensajes del chat", () => {
    const l = _internas.lineasChat([
      { body: "Ok lunes", direction: "in", createdAt: new Date("2026-11-22T06:18:00Z") },
      { body: "x".repeat(300), direction: "out", createdAt: null },
    ]);
    expect(l[0]).toMatch(/^Cliente \(.+\): Ok lunes$/);
    expect(l[1].startsWith("Aliv: ")).toBe(true);
    expect(l[1].length).toBeLessThan(170);
  });
});
