import { describe, expect, it } from "vitest";
import {
  determinarEscenarioRescate,
  mensajeSegundoToque,
  elegirEnvioRescate,
  plantillaParaRescate,
  yaRevisadoSinCambios,
  PLANTILLA_SEGUNDO_TOQUE,
  PREFIJO_REVISADO,
  PREFIJO_REVISADO_FALLO,
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

describe("cómo sale el rescate (texto vs plantilla)", () => {
  const plantilla = { name: "aliv_seguimiento_consulta", language: "es", params: ["Nancy", "NAC600"] };
  const aprobadas = new Set(["aliv_seguimiento_consulta"]);

  it("dentro de la ventana de 24 h manda el texto, no la plantilla genérica", () => {
    const r = elegirEnvioRescate({ lastInboundAt: haceHoras(5), ahora, plantilla, plantillasAprobadas: aprobadas });
    expect(r.modo).toBe("texto");
  });

  it("con menos de 1 h de margen ya usa la plantilla", () => {
    const r = elegirEnvioRescate({ lastInboundAt: haceHoras(23.5), ahora, plantilla, plantillasAprobadas: aprobadas });
    expect(r.modo).toBe("plantilla");
  });

  it("fuera de la ventana y sin plantilla aprobada, se omite en vez de fallar", () => {
    const r = elegirEnvioRescate({ lastInboundAt: haceHoras(30), ahora, plantilla, plantillasAprobadas: new Set() });
    expect(r.modo).toBe("omitir");
  });

  it("sin mensaje entrante registrado se trata como fuera de la ventana", () => {
    const r = elegirEnvioRescate({ lastInboundAt: null, ahora, plantilla, plantillasAprobadas: aprobadas });
    expect(r.modo).toBe("plantilla");
  });

  it("el segundo toque usa su propia plantilla, distinta de la del primero", () => {
    const datos = { nombre: "Nancy", producto: "NAC600", ciudad: "Lima" };
    const p1 = plantillaParaRescate("primero", "cotizacion_abandonada", datos);
    const p2 = plantillaParaRescate("segundo", "cotizacion_abandonada", datos);
    expect(p2.name).toBe(PLANTILLA_SEGUNDO_TOQUE);
    expect(p2.name).not.toBe(p1.name);
    expect(plantillaParaRescate("segundo", "adelanto_provincia", datos).name).toBe(PLANTILLA_SEGUNDO_TOQUE);
  });
});

describe("no reevaluar chats ya revisados", () => {
  const ultimoMsg = haceHoras(5);

  it("un descarte posterior al último mensaje lo salta", () => {
    const nota = { description: `${PREFIJO_REVISADO} Descartado: se despidió`, createdAt: haceHoras(4) };
    expect(yaRevisadoSinCambios(nota, ultimoMsg, ahora)).toBe(true);
  });

  it("si la conversación cambió después de la nota, se vuelve a evaluar", () => {
    const nota = { description: `${PREFIJO_REVISADO} Descartado: se despidió`, createdAt: haceHoras(6) };
    expect(yaRevisadoSinCambios(nota, ultimoMsg, ahora)).toBe(false);
  });

  it("un envío fallido se reintenta pasada 1 h", () => {
    const reciente = { description: `${PREFIJO_REVISADO_FALLO} (toque 1, texto): timeout`, createdAt: haceHoras(0.5) };
    const viejo = { description: `${PREFIJO_REVISADO_FALLO} (toque 1, texto): timeout`, createdAt: haceHoras(2) };
    expect(yaRevisadoSinCambios(reciente, ultimoMsg, ahora)).toBe(true);
    expect(yaRevisadoSinCambios(viejo, ultimoMsg, ahora)).toBe(false);
  });

  it("sin nota no se salta", () => {
    expect(yaRevisadoSinCambios(null, ultimoMsg, ahora)).toBe(false);
  });
});
