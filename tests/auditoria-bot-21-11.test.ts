import { describe, expect, it } from "vitest";
import { decidirReintento, esMensajeCortesia, MENSAJE_CORTESIA } from "@/lib/agent/reintento";
import { aplicaVentana24h, fueraDeVentana24h } from "@/lib/channels/ventana-24h";
import { pausaPorHumano, puedeEnviarOtroToque } from "@/lib/agent/toques";
import {
  asegurarPreguntaDeAvance,
  detectarSenalCompra,
  esRechazo,
  preguntaDeAvance,
  renderGuionVenta,
} from "@/lib/agent/guion-venta";

const ahora = new Date("2026-11-22T15:00:00Z");
const hace = (min: number) => new Date(ahora.getTime() - min * 60_000);

describe("E3: el bot reintenta solo antes de avisar al equipo", () => {
  it("1.ª falla: cortesía y reintento a los 3 min; 2.ª: a los 10 min sin otro mensaje; 3.ª: avisa", () => {
    expect(decidirReintento(0)).toEqual({ accion: "reintentar", enMs: 3 * 60_000, cortesia: true });
    expect(decidirReintento(1)).toEqual({ accion: "reintentar", enMs: 10 * 60_000, cortesia: false });
    expect(decidirReintento(2)).toEqual({ accion: "avisar_equipo" });
  });

  it("la cortesía no cuenta como respuesta: el reintento contesta la pregunta", () => {
    expect(esMensajeCortesia("out", MENSAJE_CORTESIA)).toBe(true);
    expect(esMensajeCortesia("out", "¿Te lo envío a Lima?")).toBe(false);
    expect(esMensajeCortesia("in", MENSAJE_CORTESIA)).toBe(false);
  });
});

describe("E4: ventana de 24 h de WhatsApp", () => {
  it("texto libre solo si el cliente escribió en las últimas ~24 h", () => {
    expect(fueraDeVentana24h(hace(60), ahora)).toBe(false);
    expect(fueraDeVentana24h(hace(23 * 60), ahora)).toBe(false);
    expect(fueraDeVentana24h(hace(24 * 60 - 5), ahora)).toBe(true); // margen de 10 min
    expect(fueraDeVentana24h(hace(30 * 60), ahora)).toBe(true);
    expect(fueraDeVentana24h(null, ahora)).toBe(true);
  });

  it("solo aplica a WhatsApp real, no al simulador", () => {
    expect(aplicaVentana24h("whatsapp", "zernio")).toBe(true);
    expect(aplicaVentana24h("whatsapp", "simulador")).toBe(false);
    expect(aplicaVentana24h("instagram", "zernio")).toBe(false);
  });
});

describe("E6: bot, equipo y envíos automáticos no se pisan", () => {
  it("si una persona escribió desde el teléfono hace poco, el bot espera y retoma al final de la pausa", () => {
    expect(pausaPorHumano(null, ahora, 60)).toEqual({ pausado: false });
    expect(pausaPorHumano(hace(90), ahora, 60)).toEqual({ pausado: false });
    const p = pausaPorHumano(hace(20), ahora, 60);
    expect(p.pausado).toBe(true);
    if (p.pausado) expect(p.reanudarEnMs).toBe(41 * 60_000);
    expect(pausaPorHumano(hace(5), ahora, 0)).toEqual({ pausado: false });
  });

  it("tope de 3 mensajes nuestros seguidos sin respuesta", () => {
    expect(puedeEnviarOtroToque(0)).toBe(true);
    expect(puedeEnviarOtroToque(2)).toBe(true);
    expect(puedeEnviarOtroToque(3)).toBe(false);
    expect(puedeEnviarOtroToque(6)).toBe(false);
  });
});

describe("V1: cierre cuando el cliente ya decidió", () => {
  it("reconoce la señal de compra", () => {
    expect(detectarSenalCompra("Hola buenas tardes, soy de Trujillo. Deseo comprar 3")).toBe(true);
    expect(detectarSenalCompra("quiero 2 frascos")).toBe(true);
    expect(detectarSenalCompra("cómo hago el pedido?")).toBe(true);
    expect(detectarSenalCompra("sepárame las tobilleras")).toBe(true);
    expect(detectarSenalCompra("lo quiero")).toBe(true);
    expect(detectarSenalCompra("¡Hola! Quiero más información")).toBe(false);
    expect(detectarSenalCompra("cuánto cuesta?")).toBe(false);
    expect(detectarSenalCompra("gracias, por ahora no quiero")).toBe(false);
  });

  it("el guion pasa a MODO CIERRE y no pregunta el producto si ya se sabe", () => {
    const g = renderGuionVenta({
      conversationId: "c1",
      historial: [
        { role: "user", content: "Hola, el NAC600 es para el hígado?" },
        { role: "assistant", content: "Sí 🌿 3 frascos S/199 con envío gratis. ¿Te lo envío a Lima o a provincia?" },
        { role: "user", content: "Soy de Trujillo, deseo comprar 3" },
      ],
      productoAnuncio: null,
    });
    expect(g.senalCompra).toBe(true);
    expect(g.producto).toBe("nac600");
    expect(g.bloque).toContain("MODO CIERRE");
    expect(g.bloque).toContain("NO le preguntes cuál quiere");
  });

  it("con pedido registrado no hay modo cierre", () => {
    const g = renderGuionVenta({
      conversationId: "c2",
      historial: [{ role: "user", content: "quiero 3" }],
      tienePedido: true,
    });
    expect(g.senalCompra).toBe(false);
  });
});

describe("V4: «quiero información» sin anuncio no recibe el menú de productos", () => {
  it("pregunta por la necesidad, no por el producto", () => {
    const g = renderGuionVenta({
      conversationId: "c3",
      historial: [{ role: "user", content: "Hola Aliv Perú, quiero información" }],
      productoAnuncio: null,
    });
    expect(g.etapa).toBe("primer_contacto");
    expect(g.producto).toBeNull();
    expect(g.bloque).toContain("¿Lo buscas para cuidar tu hígado o para el dolor y cansancio de tobillos?");
  });

  it("si viene de un anuncio, ya sabe el producto", () => {
    const g = renderGuionVenta({
      conversationId: "c4",
      historial: [{ role: "user", content: "¡Hola! Quiero más información" }],
      productoAnuncio: "termix",
    });
    expect(g.producto).toBe("termix");
    expect(g.bloque).not.toContain("No sabes qué producto vio");
  });
});

describe("V2: toda respuesta en venta termina en una pregunta de avance", () => {
  const base = { producto: "nac600" as const, ultimoCliente: "es para el hígado?" };

  it("agrega la pregunta de la etapa si la respuesta no tiene ninguna", () => {
    const r = asegurarPreguntaDeAvance("El NAC600 apoya la producción de glutatión. 3 frascos S/199 con envío gratis.", {
      ...base,
      etapa: "cotizado",
    });
    expect(r.endsWith("¿Te separo los 3 frascos con envío gratis?")).toBe(true);
  });

  it("no toca respuestas que ya preguntan, despedidas, rechazos ni la etapa de adelanto", () => {
    expect(asegurarPreguntaDeAvance("¿Te lo envío a Lima?", { ...base, etapa: "consulta" })).toBe("¿Te lo envío a Lima?");
    expect(
      asegurarPreguntaDeAvance("Comprendo, Julia. Aquí estaremos cuando gustes 🌿", { ...base, etapa: "cotizado" })
    ).toBe("Comprendo, Julia. Aquí estaremos cuando gustes 🌿");
    expect(
      asegurarPreguntaDeAvance("Entiendo.", { ...base, etapa: "cotizado", ultimoCliente: "gracias por ahora no" })
    ).toBe("Entiendo.");
    expect(asegurarPreguntaDeAvance("Quedo atento a tu captura.", { ...base, etapa: "adelanto" })).toBe(
      "Quedo atento a tu captura."
    );
  });

  it("pregunta según la etapa y el producto", () => {
    expect(preguntaDeAvance("primer_contacto", null)).toBe("¿Lo buscas para el hígado o para los tobillos? 😊");
    expect(preguntaDeAvance("cotizado", "termix")).toBe("¿Te separo el par de tobilleras con envío gratis?");
    expect(preguntaDeAvance("datos_provincia", "nac600")).toBe("¿Qué agencia Shalom te queda más cerca?");
    expect(preguntaDeAvance("con_pedido", "nac600")).toBeNull();
  });

  it("reconoce los rechazos de los chats reales", () => {
    expect(esRechazo("Gracias por ahora no")).toBe(true);
    expect(esRechazo("por ahora no lo puedo comprar no tengo dinero yo le avisaré")).toBe(true);
    expect(esRechazo("ya no me estén escribiendo")).toBe(true);
    expect(esRechazo("¿cuánto cuesta?")).toBe(false);
  });
});
