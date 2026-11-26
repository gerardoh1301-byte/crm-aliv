import { describe, expect, it } from "vitest";
import { enCaminoAliclik } from "../src/lib/aliclik/sync-reglas";
import { esContraEntregaAliclik } from "../src/lib/pedidos/entrega-aliclik";

const base = { orderNumber: "ERG909912914061", deliveryType: "CASH_ON_DELIVERY", deliveryStatus: "PENDING_DELIVERY", total: 119 };

describe("enCaminoAliclik (#1183 Huaraz, programado 27/11)", () => {
  const programado = "2026-11-27T05:00:00.000Z"; // 27/11 00:00 en Lima
  it("el 26/11 todavía no está en camino", () => {
    expect(enCaminoAliclik({ ...base, scheduledDate: programado }, new Date("2026-11-26T20:00:00Z"))).toBe(false);
  });
  it("el 27/11 (Lima) ya está en camino", () => {
    expect(enCaminoAliclik({ ...base, scheduledDate: programado }, new Date("2026-11-27T13:00:00Z"))).toBe(true);
  });
  it("las 23:00 del 26/11 en Lima siguen siendo 26/11", () => {
    expect(enCaminoAliclik({ ...base, scheduledDate: programado }, new Date("2026-11-27T04:00:00Z"))).toBe(false);
  });
  it("no aplica a entregados, agencia ni sin fecha", () => {
    const hoy = new Date("2026-11-28T15:00:00Z");
    expect(enCaminoAliclik({ ...base, deliveryStatus: "DELIVERED", scheduledDate: programado }, hoy)).toBe(false);
    expect(enCaminoAliclik({ ...base, deliveryType: "AGENCY", scheduledDate: programado }, hoy)).toBe(false);
    expect(enCaminoAliclik({ ...base, scheduledDate: null }, hoy)).toBe(false);
  });
});

describe("esContraEntregaAliclik (tarjeta del pipeline)", () => {
  it("contra entrega registrado en AliClik en provincia: sí", () => {
    expect(esContraEntregaAliclik({ transportadora: "AliClik", modalidadPago: "contraentrega", notas: "" })).toBe(true);
  });
  it("pedido web clasificado CE antes de registrarlo: sí", () => {
    expect(esContraEntregaAliclik({ modalidadPago: "contraentrega", notas: "[ENTREGA_WEB:CE|provincia_cod|Huaraz, Huaraz, Ancash|2026-11-26]" })).toBe(true);
  });
  it("Shalom con orden AliClik de agencia: no", () => {
    expect(esContraEntregaAliclik({ transportadora: "Shalom", modalidadPago: "adelanto_agencia", notas: "[ALICLIK_ORDEN:ERG1]" })).toBe(false);
    expect(esContraEntregaAliclik({ modalidadPago: "contraentrega", notas: "[ALICLIK_ORDEN:ERG1]", numeroGuia: "105410411" })).toBe(false);
  });
  it("provincia sin marca ni transportadora: no cambia (sigue como antes)", () => {
    expect(esContraEntregaAliclik({ modalidadPago: "contraentrega", notas: "Pedido web" })).toBe(false);
  });
});
