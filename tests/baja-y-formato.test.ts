import { describe, expect, it } from "vitest";
import { esMotivoDeBaja } from "../src/lib/agent/baja";
import { limpiarFormatoWhatsApp } from "../src/lib/agent/formato";

describe("A2: frases de baja que antes no se detectaban", () => {
  it.each([
    "Cliente solicita no ser contactado mas",
    "Cliente solicita no ser contactado más.",
    "La clienta no desea ser contactada",
    "Mejor no, ya no me escriban más por favor",
    "no quiero recibir mas mensajes",
    "No me manden más mensajes",
    "dejen de escribirme",
    "sáquenme de la lista, baja de la difusión",
  ])("apaga: %s", (t) => expect(esMotivoDeBaja(t)).toBe(true));

  it.each([
    "Quiere bajar de peso",
    "Cliente envió captura del Yape",
    "No puedo recibir el pedido el sábado",
    "Pregunta si se puede tomar con otros medicamentos",
    "Lo voy a pensar, te escribo luego",
  ])("no apaga: %s", (t) => expect(esMotivoDeBaja(t)).toBe(false));
});

describe("formato WhatsApp", () => {
  it("convierte negrita Markdown a la de WhatsApp", () => {
    expect(limpiarFormatoWhatsApp("pedido **#ALIV-1041** por **S/ 199**")).toBe("pedido *#ALIV-1041* por *S/ 199*");
  });
  it("respeta la negrita que ya es de WhatsApp", () => {
    expect(limpiarFormatoWhatsApp("Yape *951365418*")).toBe("Yape *951365418*");
  });
  it("convierte titulos en negrita", () => {
    expect(limpiarFormatoWhatsApp("### Opciones\n- 1 frasco")).toBe("*Opciones*\n- 1 frasco");
  });
});
