import { describe, expect, it } from "vitest";
import {
  determinarEscenarioRescate,
  mensajeSegundoToque,
  type ContextoChatParaAuditoria,
} from "@/lib/agent/rescate";

const ahora = new Date("2026-11-20T15:00:00Z"); // 10:00 en Lima
const haceHoras = (h: number) => new Date(ahora.getTime() - h * 3_600_000);

/** Consulta de Lima: el bot cotizó (y nombró "provincia" y "agencia") y el cliente calló. */
function consultaLima(over: Partial<ContextoChatParaAuditoria> = {}): ContextoChatParaAuditoria {
  return {
    contact: { id: "c", name: "Nancy", phone: "+51911222333", tags: ["interes:nac600"] },
    conversation: { id: "v", lastMessageAt: haceHoras(4), channel: "whatsapp" },
    ultimoMensaje: {
      direction: "out",
      body: "• 1 frasco: S/119 • 2 frascos: S/189 • 3 frascos: S/199 ⭐. Envío gratis; a provincia por agencia Shalom. ¿Te lo enviamos a Lima o a provincia?",
    },
    historialMensajes: [
      {
        direction: "out",
        body: "• 1 frasco: S/119 • 2 frascos: S/189 • 3 frascos: S/199 ⭐. Envío gratis; a provincia por agencia Shalom. ¿Te lo enviamos a Lima o a provincia?",
      },
      { direction: "in", body: "Hola, precio del NAC600?" },
    ],
    pedidoReciente: null,
    ...over,
  };
}

describe("clasificación provincia vs Lima", () => {
  it("no marca provincia solo porque el bot escribió 'provincia' o 'agencia'", () => {
    const r = determinarEscenarioRescate(consultaLima(), ahora);
    expect(r.esElegible).toBe(true);
    expect(r.escenario).toBe("cotizacion_abandonada");
  });

  it("sí marca provincia cuando lo dice el cliente", () => {
    const ctx = consultaLima({
      historialMensajes: [
        { direction: "out", body: "¿Te lo enviamos a Lima o a provincia?" },
        { direction: "in", body: "soy de Arequipa, cuanto cuesta?" },
      ],
    });
    expect(determinarEscenarioRescate(ctx, ahora).escenario).toBe("adelanto_provincia");
  });

  it("el saldo de provincia sale del pack que eligió el cliente, no de la lista de precios del bot", () => {
    const ctx = consultaLima({
      contact: { id: "c", name: "Rosa", phone: "+51911222333", tags: ["Pendiente de adelanto"] },
      historialMensajes: [
        { direction: "out", body: "• 1 frasco: S/119 • 2 frascos: S/189 • 3 frascos: S/199 ⭐" },
        { direction: "in", body: "quiero 2 frascos para Cusco" },
      ],
    });
    const r = determinarEscenarioRescate(ctx, ahora);
    expect(r.escenario).toBe("adelanto_provincia");
    expect(r.mensajeRescate).toContain("S/169"); // 189 - 20
  });
});

describe("segundo toque", () => {
  it("no se envía en el primer pase si ya hubo rescate", () => {
    const ctx = consultaLima({ contact: { id: "c", name: "Nancy", phone: "+51911222333", tags: ["rescate_enviado"] } });
    expect(determinarEscenarioRescate(ctx, ahora).esElegible).toBe(false);
  });

  it("sale entre 22 y 72 h después del primero, sin respuesta", () => {
    const tags = ["interes:nac600", "rescate_enviado"];
    const ctx = (h: number) =>
      consultaLima({
        contact: { id: "c", name: "Nancy", phone: "+51911222333", tags },
        conversation: { id: "v", lastMessageAt: haceHoras(h), channel: "whatsapp" },
      });
    expect(determinarEscenarioRescate(ctx(10), ahora, { segundoToque: true }).esElegible).toBe(false);
    expect(determinarEscenarioRescate(ctx(30), ahora, { segundoToque: true }).esElegible).toBe(true);
    expect(determinarEscenarioRescate(ctx(80), ahora, { segundoToque: true }).esElegible).toBe(false);
  });

  it("nunca hay un tercero", () => {
    const ctx = consultaLima({
      contact: { id: "c", name: "Nancy", phone: "+51911222333", tags: ["rescate_enviado", "rescate_2_enviado"] },
      conversation: { id: "v", lastMessageAt: haceHoras(30), channel: "whatsapp" },
    });
    expect(determinarEscenarioRescate(ctx, ahora, { segundoToque: true }).esElegible).toBe(false);
  });

  it("exige un primer rescate previo", () => {
    const ctx = consultaLima({ conversation: { id: "v", lastMessageAt: haceHoras(30), channel: "whatsapp" } });
    expect(determinarEscenarioRescate(ctx, ahora, { segundoToque: true }).esElegible).toBe(false);
  });

  it("el mensaje propone el pedido y avisa que es el último", () => {
    const m = mensajeSegundoToque("cotizacion_abandonada", "Nancy", "nac600");
    expect(m).toContain("por última vez");
    expect(m).toContain("3 frascos de NAC600 (S/199)");
    expect(m).not.toMatch(/garant/i);
  });
});

describe("formulario abandonado en curso", () => {
  it("el rescate de chats no le escribe encima", () => {
    const ctx = consultaLima({
      contact: { id: "c", name: "Nancy", phone: "+51911222333", tags: ["formulario_abandonado", "abandono_paso1"] },
    });
    expect(determinarEscenarioRescate(ctx, ahora).esElegible).toBe(false);
  });
});
