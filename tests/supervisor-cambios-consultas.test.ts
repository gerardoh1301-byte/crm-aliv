import { describe, expect, it } from "vitest";
import { interpretarComando, pareceOrdenNoEntendida } from "@/lib/supervisor/parser";
import { normalizarTraduccion } from "@/lib/supervisor/traduccion";
import { origenPedido, rangoPeriodo } from "@/lib/supervisor/consultas";

const cmd = (t: string) => interpretarComando(t);
const tipo = (t: string) => cmd(t)?.tipo ?? null;

describe("consultas generales del Administrador", () => {
  it("reconoce cada consulta y su periodo", () => {
    expect(cmd("resumen de hoy")).toMatchObject({ tipo: "consulta", consulta: "resumen", periodo: "hoy" });
    expect(cmd("Resumen de ayer")).toMatchObject({ consulta: "resumen", periodo: "ayer" });
    expect(cmd("cuántos pedidos van esta semana?")).toMatchObject({ consulta: "resumen", periodo: "semana" });
    expect(cmd("ventas del mes")).toMatchObject({ consulta: "resumen", periodo: "mes" });
    expect(cmd("¿quién me debe?")).toMatchObject({ consulta: "deben" });
    expect(cmd("saldos pendientes")).toMatchObject({ consulta: "deben" });
    expect(cmd("adelantos pendientes")).toMatchObject({ consulta: "adelantos" });
    expect(cmd("qué falta enviar")).toMatchObject({ consulta: "por_enviar" });
    expect(cmd("pedidos sin guía")).toMatchObject({ consulta: "por_enviar" });
    expect(cmd("quiénes están en agencia sin recoger")).toMatchObject({ consulta: "en_camino" });
    expect(cmd("pedidos por confirmar")).toMatchObject({ consulta: "por_confirmar" });
  });

  it("si nombra un pedido, es la ficha de ese pedido y no una lista", () => {
    expect(tipo("resumen 1140")).toBe("estado");
    expect(tipo("cuánto debe el pedido 1140")).toBe("estado");
  });

  it("las preguntas de prueba al bot de ventas no son consultas", () => {
    expect(tipo("hola, cuánto cuesta el NAC600?")).toBeNull();
    expect(tipo("hacen envíos a provincia?")).toBeNull();
    expect(tipo("cuánto demora en llegar?")).toBeNull();
  });

  it("calcula hoy, ayer y la semana en hora de Lima", () => {
    // 21/11/2026 03:00 UTC = 20/11 22:00 en Lima: «hoy» todavía es el 20.
    const ahora = new Date("2026-11-21T03:00:00Z");
    expect(rangoPeriodo("hoy", ahora).desde.toISOString()).toBe("2026-11-20T05:00:00.000Z");
    expect(rangoPeriodo("ayer", ahora).desde.toISOString()).toBe("2026-11-19T05:00:00.000Z");
    // 20/11/2026 es viernes: la semana empieza el lunes 16.
    expect(rangoPeriodo("semana", ahora).desde.toISOString()).toBe("2026-11-16T05:00:00.000Z");
    expect(rangoPeriodo("mes", ahora).desde.toISOString()).toBe("2026-11-01T05:00:00.000Z");
  });

  it("distingue pedidos del chat y de la web", () => {
    expect(origenPedido("CHAT-0001")).toBe("chat");
    expect(origenPedido("#1148")).toBe("web");
    expect(origenPedido("#LEG-1049")).toBe("otro");
  });
});

describe("cambios en el CRM (todos piden «SI <pedido>»)", () => {
  it("cancelar un pedido, con motivo", () => {
    const c = cmd("Cancela el pedido 1140 porque no contesta")!;
    expect(c.tipo).toBe("cancelar_pedido");
    expect(c.numeros.map((t) => t.texto)).toEqual(["1140"]);
    expect(c.valor).toBe("no contesta");
    expect(tipo("anula 1140")).toBe("cancelar_pedido");
    // Un «cancelar» suelto sigue cancelando lo pendiente, y contar que el cliente canceló no es orden.
    expect(tipo("cancelar")).toBe("cancelar");
    expect(tipo("el cliente canceló el pedido")).toBeNull();
  });

  it("cambiar el estado", () => {
    expect(cmd("pasa 1140 a confirmado")).toMatchObject({ tipo: "cambiar_estado", valor: "confirmado" });
    expect(cmd("pasa el 1140 a por confirmar")).toMatchObject({ tipo: "cambiar_estado", valor: "por_confirmar_cod" });
    expect(cmd("marca el pedido de Carlos Huaynalaya como enviado")).toMatchObject({
      tipo: "cambiar_estado",
      valor: "enviado",
      nombre: "carlos huaynalaya",
    });
    expect(tipo("marca 1140 como entregado")).toBe("entregado");
    expect(tipo("pasa 1140 a cancelado")).toBe("cancelar_pedido");
  });

  it("DNI: el número de 8 cifras es el DNI, no una guía", () => {
    const c = cmd("dni 1140 45678912")!;
    expect(c).toMatchObject({ tipo: "dni", valor: "45678912", guia: null });
    expect(c.numeros.map((t) => t.texto)).toEqual(["1140"]);
    expect(cmd("cambia el dni de Carlos Huaynalaya a 45678912")).toMatchObject({
      tipo: "dni",
      valor: "45678912",
      nombre: "carlos huaynalaya",
    });
  });

  it("dirección o agencia: guarda el texto tal cual y solo usa el número de pedido", () => {
    const c = cmd("direccion 1140 a Av. Lima 123, Dpto 502")!;
    expect(c.tipo).toBe("direccion");
    expect(c.valor).toBe("Av. Lima 123, Dpto 502");
    expect(c.numeros.map((t) => t.texto)).toEqual(["1140"]);
    expect(cmd("cambia la agencia del 1140 a Shalom Huancayo Real")).toMatchObject({
      tipo: "direccion",
      valor: "Shalom Huancayo Real",
    });
    expect(cmd("dirección de Carlos")).toMatchObject({ tipo: "direccion", valor: null });
  });

  it("clave nueva: la última cifra de 4-6 dígitos es la clave", () => {
    const c = cmd("registra clave 1140 1330")!;
    expect(c).toMatchObject({ tipo: "clave_nueva", valor: "1330" });
    expect(c.numeros.map((t) => t.texto)).toEqual(["1140"]);
    expect(cmd("clave nueva de Carlos Huaynalaya 2468")).toMatchObject({ tipo: "clave_nueva", valor: "2468" });
    // Un solo número sin otro dato: no se sabe si es el pedido o la clave.
    expect(cmd("registra clave 1330")).toMatchObject({ tipo: "clave_nueva", valor: null });
    // Pedir la clave sigue siendo verla.
    expect(tipo("clave 1140")).toBe("clave");
  });

  it("total y nota", () => {
    expect(tipo("total 1140 189")).toBe("total");
    expect(tipo("cambia el total del 1140 a 189")).toBe("total");
    expect(cmd("nota 1140 llamar después de las 6 pm")).toMatchObject({
      tipo: "nota",
      valor: "llamar después de las 6 pm",
    });
  });

  it("la IA puede traducir a un cambio, que igual pide el SI", () => {
    const t = normalizarTraduccion({ tipo: "orden", orden: "cancela 1140 porque no contesta", descripcion: "anular" });
    expect(t).toMatchObject({ tipo: "orden", comando: { tipo: "cancelar_pedido" } });
    expect(normalizarTraduccion({ tipo: "orden", orden: "quién me debe", descripcion: "" })).toMatchObject({
      comando: { tipo: "consulta", consulta: "deben" },
    });
  });

  it("ya no queda como «orden no entendida» lo que ahora sí se entiende", () => {
    expect(tipo("cambia 1140 a preparando")).toBe("cambiar_estado");
    expect(pareceOrdenNoEntendida("cambia el producto del 1140")).toBe(true);
    expect(tipo("cambia el producto del 1140")).toBeNull();
  });
});
