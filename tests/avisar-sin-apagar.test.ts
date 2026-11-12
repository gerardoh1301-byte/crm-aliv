import { describe, expect, it } from "vitest";
import { esMotivoDeBaja } from "../src/lib/agent/baja";
import { extraerDatosFormularioShopify } from "../src/lib/shopify/form-extractor";

describe("derivar_asesor solo apaga el bot ante una baja real", () => {
  it.each([
    "Cliente pide que no le escriban más",
    "no me escriban por favor",
    "Quiere darse de baja de los mensajes",
    "No contactar más",
  ])("apaga: %s", (motivo) => expect(esMotivoDeBaja(motivo)).toBe(true));

  it.each([
    "Captura de pago recibida para validar despacho",
    "Pregunta si ayuda a bajar de peso",
    "Trabaja de noche, pide llamada",
    "Cliente pide hablar con una persona",
    "Insiste con el registro sanitario",
  ])("no apaga: %s", (motivo) => expect(esMotivoDeBaja(motivo)).toBe(false));
});

describe("B6: calles San Martín de Porres en provincia", () => {
  const casos: Array<[string, Record<string, unknown>, boolean]> = [
    ["Tarapoto, depto San Martín", { shipping_address: { city: "Tarapoto", province: "San Martín", address1: "Jr. San Martín de Porres 245" } }, true],
    ["Chiclayo, Lambayeque", { shipping_address: { city: "Chiclayo", province: "Lambayeque", address1: "Calle San Martín de Porres 110" } }, true],
    ["EasySell Arequipa", { note_attributes: [{ name: "Ciudad", value: "Arequipa" }], shipping_address: { city: "Arequipa", address1: "Av. San Martín de Porres 300" } }, true],
    ["EasySell Piura, AAHH", { note_attributes: [{ name: "Ciudad", value: "Piura" }], shipping_address: { city: "Piura", address1: "AAHH San Martin de Porres Mz B lt 4" } }, true],
    ["SMP real", { shipping_address: { city: "San Martín de Porres", province: "Lima", address1: "Av. Habich 123" } }, false],
  ];
  it.each(casos)("%s", (_n, payload, provincia) => {
    expect(extraerDatosFormularioShopify(payload).esProvincia).toBe(provincia);
  });
});
