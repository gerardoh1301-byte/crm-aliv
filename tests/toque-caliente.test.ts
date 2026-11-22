import { describe, expect, it } from "vitest";
import {
  decidirToqueCaliente,
  escenarioDesdeMensajeBot,
  mensajeToqueCaliente,
  type EntradaToqueCaliente,
} from "@/lib/agent/toque-caliente-reglas";

const ahora = new Date("2026-11-22T16:00:00Z"); // 11:00 Lima
const hace = (min: number) => new Date(ahora.getTime() - min * 60_000);

const base = (over: Partial<EntradaToqueCaliente> = {}): EntradaToqueCaliente => ({
  ahora,
  ultimo: {
    direction: "out",
    origin: "agent",
    body: "Para enviarlo por Shalom te pedimos un adelanto de S/20 por Yape. ¿Me envías la captura cuando lo hagas?",
    createdAt: hace(15),
  },
  ultimoEntranteEn: hace(17),
  tags: ["interes:nac600"],
  estadoPedido: "por_confirmar_cod",
  yaTocado: false,
  promesaPendiente: false,
  aiActivo: true,
  ...over,
});

describe("toque en caliente (12-45 min)", () => {
  it("detecta qué esperaba el bot", () => {
    expect(escenarioDesdeMensajeBot("Te pedimos un adelanto de S/20 por Yape, me envías la captura")).toBe("adelanto");
    expect(escenarioDesdeMensajeBot("¿Me pasas tu DNI y la agencia Shalom donde lo recoges?")).toBe("datos");
    expect(escenarioDesdeMensajeBot("El pack de 3 está a S/199 con envío gratis. ¿Para qué distrito sería?")).toBe("datos");
    expect(escenarioDesdeMensajeBot("El pack de 3 está a S/199 con envío gratis. ¿Cuál te interesa?")).toBe("cotizacion");
    expect(escenarioDesdeMensajeBot("¡Listo! Tu pedido quedó registrado. Gracias por tu compra 🌿")).toBeNull();
    expect(escenarioDesdeMensajeBot("El NAC600 se toma 2 cápsulas al día.")).toBeNull();
  });

  it("envía a los 15 min si el bot pidió el adelanto", () => {
    expect(decidirToqueCaliente(base())).toEqual({ accion: "enviar", escenario: "adelanto" });
  });

  it("espera antes de 12 min y suelta después de 45 (lo toma el rescate)", () => {
    expect(decidirToqueCaliente(base({ ultimo: { ...base().ultimo!, createdAt: hace(5) } })).accion).toBe("esperar");
    expect(decidirToqueCaliente(base({ ultimo: { ...base().ultimo!, createdAt: hace(60) } })).accion).toBe("omitir");
  });

  it("no toca si respondió el cliente, si escribió una persona o si ya se tocó", () => {
    expect(decidirToqueCaliente(base({ ultimo: { ...base().ultimo!, direction: "in" } })).accion).toBe("omitir");
    expect(decidirToqueCaliente(base({ ultimo: { ...base().ultimo!, origin: null } })).accion).toBe("omitir");
    expect(decidirToqueCaliente(base({ yaTocado: true })).accion).toBe("omitir");
    expect(decidirToqueCaliente(base({ promesaPendiente: true })).accion).toBe("omitir");
  });

  it("no toca pedidos pagados, cancelados ni contactos cerrados", () => {
    expect(decidirToqueCaliente(base({ estadoPedido: "adelanto_pagado" })).accion).toBe("omitir");
    expect(decidirToqueCaliente(base({ tags: ["comprobante recibido"] })).accion).toBe("omitir");
    expect(decidirToqueCaliente(base({ tags: ["no-reactivar"] })).accion).toBe("omitir");
  });

  it("respeta horario (9 a 21 Lima) y la ventana de 24 h", () => {
    const noche = new Date("2026-11-23T03:30:00Z"); // 22:30 Lima
    const e = base({
      ahora: noche,
      ultimo: { ...base().ultimo!, createdAt: new Date(noche.getTime() - 15 * 60_000) },
      ultimoEntranteEn: new Date(noche.getTime() - 17 * 60_000),
    });
    expect(decidirToqueCaliente(e).accion).toBe("omitir");
    expect(decidirToqueCaliente(base({ ultimoEntranteEn: null })).accion).toBe("omitir");
  });

  it("mensaje con o sin nombre, sin número de Yape ni promesas de hora", () => {
    const con = mensajeToqueCaliente("adelanto", "María López");
    expect(con.startsWith("María, ")).toBe(true);
    const sin = mensajeToqueCaliente("cotizacion", null);
    expect(sin.startsWith("¿Te lo separo?")).toBe(true);
    for (const t of [con, sin, mensajeToqueCaliente("datos", null)]) {
      expect(t).not.toMatch(/\d{9}/);
      expect(t).not.toMatch(/\b(hoy|minutos)\b/i);
    }
  });
});
