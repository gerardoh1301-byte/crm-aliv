import { describe, expect, it } from "vitest";
import { interpretarComando, mejoresPorNombre, separarPedidoYMonto } from "@/lib/supervisor/parser";
import { _internas, cuentasDelPedido } from "@/lib/supervisor/comandos";

describe("órdenes de Gerardo con guía Shalom, celular o nombre (21/11, Carlos Huaynalaya)", () => {
  it("«Dame la clave de recojo de pedido a nombre de Carlos Huaynalaya guía Shalom 104493022» busca por la guía", () => {
    const c = interpretarComando(
      "Dame la clave de recojo de pedido a nombre de Carlos Huaynalaya guía Shalom 104493022"
    )!;
    expect(c.tipo).toBe("clave");
    expect(c.guia).toBe("104493022");
    // La guía no es un monto ni un número de pedido.
    expect(c.numeros).toEqual([]);
    expect(separarPedidoYMonto(c.numeros, () => false)).toEqual({ pedido: null, monto: null });
    // «nombre», «recojo», «guía»… no forman parte del nombre del cliente.
    expect(c.nombre).toBe("carlos huaynalaya");
  });

  it("toma el código Shalom que acompaña a la guía", () => {
    expect(interpretarComando("clave guia 104493000 codigo 3KJP")!.codigo).toBe("3KJP");
    expect(interpretarComando("estado 104493000 3kjp")!.codigo).toBe("3KJP");
  });

  it("un celular identifica al cliente y no se toma por guía ni monto", () => {
    const c = interpretarComando("clave del 987654321")!;
    expect(c.celular).toBe("987654321");
    expect(c.guia).toBeNull();
    expect(c.numeros).toEqual([]);
  });

  it("con guía y monto, el monto sigue siendo el monto", () => {
    const c = interpretarComando("flete 104493022 10")!;
    expect(c.tipo).toBe("flete");
    expect(c.guia).toBe("104493022");
    expect(separarPedidoYMonto(c.numeros, () => false).monto).toBe(10);
  });

  it("la orden «guia» sigue registrando la guía nueva", () => {
    const c = interpretarComando("guia 1066 104169999 AB12")!;
    expect(c.tipo).toBe("guia");
    expect(c.guia).toBe("104169999");
    expect(c.codigo).toBe("AB12");
    expect(c.numeros.map((t) => t.texto)).toEqual(["1066"]);
  });

  it("entiende las preguntas de información como «estado»", () => {
    const tipo = (t: string) => interpretarComando(t)?.tipo ?? null;
    expect(tipo("cuál es la guía del pedido 1140")).toBe("estado");
    expect(tipo("cuánto debe el pedido de Carlos Huaynalaya")).toBe("estado");
    expect(tipo("dame los datos del pedido 1140")).toBe("estado");
    expect(tipo("dame la guía de Carlos Huaynalaya")).toBe("estado");
    expect(tipo("información 1140")).toBe("estado");
    expect(tipo("qué dirección tiene el 987654321")).toBe("estado");
    expect(tipo("dame la clave de Jaime")).toBe("clave");
  });

  it("las preguntas de prueba al bot de ventas no se toman como orden", () => {
    const tipo = (t: string) => interpretarComando(t)?.tipo ?? null;
    expect(tipo("qué beneficios tiene el NAC600?")).toBeNull();
    expect(tipo("cuánto cuesta?")).toBeNull();
    expect(tipo("quiero 3 frascos")).toBeNull();
    expect(tipo("dónde están ubicados?")).toBeNull();
  });
});

describe("búsqueda por nombre", () => {
  const pedidos = [
    { id: "a", contactName: "Carlos Alberto Huaynalaya Rojas" },
    { id: "b", contactName: "Carlos Pérez" },
    { id: "c", contactName: "Jaime Gaspar Soncco" },
  ];

  it("se queda con el que tiene más palabras del nombre", () => {
    expect(mejoresPorNombre(["carlos", "huaynalaya"], pedidos).map((p) => p.id)).toEqual(["a"]);
  });

  it("una palabra de más no deja sin resultado", () => {
    expect(mejoresPorNombre(["senor", "carlos", "huaynalaya"], pedidos).map((p) => p.id)).toEqual(["a"]);
  });

  it("con dos palabras escritas, una sola coincidencia no basta", () => {
    expect(mejoresPorNombre(["carlos", "quispe"], pedidos)).toEqual([]);
  });
});

describe("ficha del pedido para el Administrador", () => {
  it("muestra cliente, productos, dinero, guía y la clave", () => {
    const p = {
      numeroOrden: "#1150",
      contactName: "Carlos Huaynalaya",
      estado: "enviado",
      modalidadPago: "adelanto_agencia",
      dniCliente: "45678912",
      direccionEnvio: "Agencia Shalom Huancayo",
      distrito: null,
      ciudad: "Huancayo",
      items: [{ cantidad: 2, titulo: "NAC600" }],
      total: "189",
      transportadora: "Shalom",
      numeroGuia: "104493022",
      codigoRastreo: "7QWE",
      claveRecojo: "2468",
      notas: null,
      createdAt: new Date("2026-11-20T15:00:00Z"),
    } as unknown as Parameters<typeof _internas.fichaPedido>[0];
    const texto = _internas.fichaPedido(p, cuentasDelPedido(p), "+51987654321");
    expect(texto).toContain("Carlos Huaynalaya");
    expect(texto).toContain("DNI 45678912");
    expect(texto).toContain("2x NAC600");
    expect(texto).toContain("saldo pendiente S/ 169.00");
    expect(texto).toContain("104493022");
    expect(texto).toContain("*CLAVE SECRETA DE RETIRO: 2468*");
    expect(texto).toContain("+51987654321");
  });
});
