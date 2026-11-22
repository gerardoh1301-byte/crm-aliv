import { describe, expect, it } from "vitest";
import {
  clasificarObjecionCliente,
  elegirValorRescate,
  instruccionValor,
  textoSegundoToque,
} from "@/lib/agent/rescate-valor";
import { determinarEscenarioRescate, mensajeSegundoToque, type ContextoChatParaAuditoria } from "@/lib/agent/rescate";
import { detectarSituacion, elegirEjemplos, preguntaDeAvance, esRechazo } from "@/lib/agent/guion-venta";
import { embudoPorFuente, fuenteDelChat, quienCerro, rescatePorValor, type FilaEmbudo } from "@/lib/metricas-embudo";

const ahora = new Date("2026-11-21T20:00:00Z"); // 15:00 en Lima
const hace = (h: number) => new Date(ahora.getTime() - h * 3_600_000);

function chat(mensajesCliente: string[], ultimoNuestro: string, extra: Partial<ContextoChatParaAuditoria> = {}): ContextoChatParaAuditoria {
  // historial del más nuevo al más viejo, como lo trae el barrido
  const historial = [
    { direction: "out", body: ultimoNuestro },
    ...mensajesCliente.map((b) => ({ direction: "in", body: b })),
    { direction: "out", body: "El NAC600 + NAD+ está a S/119 el frasco y 3 por S/199 con envío gratis." },
  ];
  return {
    contact: { id: "c1", name: "Julia Pérez", phone: "51999888777", tags: [] },
    conversation: { id: "v1", lastMessageAt: hace(5), channel: "whatsapp" },
    ultimoMensaje: historial[0],
    historialMensajes: historial,
    pedidoReciente: null,
    ...extra,
  };
}

describe("V3: no se rescata a quien dijo que no", () => {
  it("rechazo firme en cualquiera de los 3 últimos mensajes", () => {
    expect(clasificarObjecionCliente(["ok", "Gracias por ahora no"])).toBe("rechazo");
    expect(clasificarObjecionCliente(["por ahora no lo puedo comprar no tengo dinero yo le aviso"])).toBe("rechazo");
    expect(clasificarObjecionCliente(["ya no me estén escribiendo"])).toBe("rechazo");
    expect(clasificarObjecionCliente(["uy está caro"])).toBe("dinero");
    expect(clasificarObjecionCliente(["ahorita no tengo dinero"])).toBe("dinero");
    expect(clasificarObjecionCliente(["cuánto cuesta?"])).toBeNull();
  });

  it("el barrido descarta a Noemi («yo le aviso») aunque su último mensaje sea un ok", () => {
    const r = determinarEscenarioRescate(
      chat(["Ok", "por ahora no lo puedo comprar, yo le aviso"], "Entiendo, aquí estaremos 🌿"),
      ahora
    );
    expect(r.esElegible).toBe(false);
  });

  it("«está caro» ya no descarta: recibe el pack de entrada", () => {
    const r = determinarEscenarioRescate(chat(["uy está caro"], "Te entiendo, el de 3 sale a S/2,20 al día."), ahora);
    expect(r.esElegible).toBe(true);
    expect(r.valor).toBe("pack_entrada");
    expect(r.mensajeRescate).toContain("S/119");
    expect(r.mensajeRescate).not.toContain("S/199");
  });
});

describe("V3: cada toque trae algo nuevo", () => {
  it("Lima: primero pago al recibir, luego pack de entrada", () => {
    expect(elegirValorRescate({ escenario: "cotizacion_abandonada", objecion: null, toque: 1 })).toBe("pago_al_recibir");
    expect(elegirValorRescate({ escenario: "cotizacion_abandonada", objecion: null, toque: 2 })).toBe("pack_entrada");
  });

  it("si frenó por plata: primero pack de entrada, luego garantía", () => {
    expect(elegirValorRescate({ escenario: "cotizacion_abandonada", objecion: "dinero", toque: 1 })).toBe("pack_entrada");
    expect(elegirValorRescate({ escenario: "cotizacion_abandonada", objecion: "dinero", toque: 2 })).toBe("garantia_confianza");
  });

  it("provincia: confianza y luego pack de entrada; si ya eligió el más chico, no se le ofrece", () => {
    expect(elegirValorRescate({ escenario: "adelanto_provincia", objecion: null, toque: 1 })).toBe("garantia_confianza");
    expect(elegirValorRescate({ escenario: "adelanto_provincia", objecion: null, toque: 2 })).toBe("pack_entrada");
    expect(elegirValorRescate({ escenario: "adelanto_provincia", objecion: null, toque: 2, packEntradaYa: true })).toBe(
      "pago_al_recibir"
    );
  });

  it("dirección incompleta solo pide el dato", () => {
    expect(elegirValorRescate({ escenario: "direccion_incompleta", objecion: "dinero", toque: 2 })).toBe("dato_pendiente");
  });

  it("el segundo toque ya no repite «por última vez» con la misma oferta", () => {
    const t = mensajeSegundoToque("cotizacion_abandonada", "Julia", "nac600", "pack_entrada");
    expect(t).toContain("1 frasco de NAC600 + NAD+ a *S/119*");
    expect(t).not.toContain("por última vez");
    expect(textoSegundoToque("adelanto_provincia", "pack_entrada", null, "termix")).toContain("S/79");
    expect(textoSegundoToque("cotizacion_abandonada", "garantia_confianza", "Julia", "nac600")).toContain("RUC 20612283134");
  });

  it("la IA recibe qué aportar", () => {
    expect(instruccionValor("pack_entrada", "nac600", false)).toContain("No vuelvas a ofrecer el pack grande");
  });
});

describe("V5: ejemplos reales y «no tengo dinero»", () => {
  it("detecta la falta de dinero y trae su ejemplo sin presión", () => {
    expect(detectarSituacion("ahorita no tengo dinero")).toBe("sin_dinero");
    const ej = elegirEjemplos("cotizado", "sin_dinero", "nac600");
    expect(ej[0].id).toBe("sin-dinero-nac");
    expect(esRechazo(ej[0].cliente)).toBe(true); // V2 no le agrega pregunta de avance
  });

  it("cuando elige pack se prefieren los ejemplos reales con el ancla al pack siguiente", () => {
    const ej = elegirEjemplos("datos_lima", "elige_pack", "nac600");
    expect(ej.map((e) => e.id)).toContain("real-ancla-3-lima");
  });

  it("en Lima la pregunta de datos cierra con el día de entrega", () => {
    expect(preguntaDeAvance("datos_lima", "nac600")).toContain("qué día de esta semana");
  });
});

describe("V6: embudo por fuente", () => {
  const base: FilaEmbudo = {
    de_anuncio: false,
    pedido_web_previo: false,
    primer_mensaje: "hola",
    bot_respondio: true,
    siguio: true,
    cotizado: true,
    pidio_datos: false,
    pedido: false,
    estado_pedido: null,
    cerro_origen: null,
    pedido_de_chat: null,
  };

  it("clasifica la fuente del chat", () => {
    expect(fuenteDelChat({ ...base, de_anuncio: true })).toBe("anuncio");
    expect(fuenteDelChat({ ...base, pedido_web_previo: true })).toBe("confirmacion_web");
    expect(fuenteDelChat({ ...base, primer_mensaje: "Hola Aliv Perú, quiero información" })).toBe("mensaje_web");
    expect(fuenteDelChat(base)).toBe("directo");
  });

  it("quién cerró: bot, equipo o web", () => {
    expect(quienCerro({ pedido: true, pedido_de_chat: true, cerro_origen: "agent" })).toBe("bot");
    expect(quienCerro({ pedido: true, pedido_de_chat: true, cerro_origen: null })).toBe("equipo");
    expect(quienCerro({ pedido: true, pedido_de_chat: false, cerro_origen: "agent" })).toBe("web");
    expect(quienCerro({ pedido: false, pedido_de_chat: null, cerro_origen: null })).toBeNull();
  });

  it("cuenta por fuente y la meta de pedidos del bot", () => {
    const e = embudoPorFuente([
      { ...base, de_anuncio: true, pedido: true, pedido_de_chat: true, cerro_origen: "agent", estado_pedido: "entregado" },
      { ...base, de_anuncio: true },
      { ...base, pedido_web_previo: true, pedido: true, pedido_de_chat: false, estado_pedido: "confirmado" },
      base,
    ]);
    expect(e.por_fuente.anuncio).toMatchObject({ chats: 2, pedido: 1, confirmado: 1, entregado: 1, conversion_pct: 50 });
    expect(e.pedidos_por_quien_cerro).toEqual({ bot: 1, equipo: 0, web: 1 });
    expect(e.pedidos_bot_sobre_chats_nuevos_pct).toBe(33.3); // 1 de 3 chats de venta
  });

  it("respuestas al rescate por valor", () => {
    const r = rescatePorValor([
      { descripcion: "[RESCATE VENTAS] Mensaje enviado (cotizacion_abandonada; valor=pack_entrada).", respondio: true },
      { descripcion: "[RESCATE VENTAS] Segundo y último toque enviado (adelanto_provincia; valor=pack_entrada).", respondio: false },
      { descripcion: "[RESCATE VENTAS] Mensaje enviado automáticamente (cotizacion_abandonada).", respondio: false },
    ]);
    expect(r.pack_entrada).toEqual({ enviados: 2, respondieron: 1, respuesta_pct: 50 });
    expect(r.sin_valor.enviados).toBe(1);
  });
});
