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
    expect(limpiarFormatoWhatsApp("### Opciones\n- 1 frasco")).toBe("*Opciones*\n• 1 frasco");
  });
  it("cambia viñetas Markdown por puntos, sin tocar la negrita al inicio", () => {
    expect(limpiarFormatoWhatsApp("*   1 frasco: *S/119*\n- 2 frascos\n*Precio:* S/199")).toBe(
      "• 1 frasco: *S/119*\n• 2 frascos\n*Precio:* S/199",
    );
  });
});

describe("guardas de venta", () => {
  it("agrega el Yape si menciona el adelanto sin el numero", () => {
    const r = limpiarFormatoWhatsApp("Se coordina un adelanto de S/ 20 y el resto al recoger.");
    expect(r).toContain("951365418");
  });
  it("no duplica el Yape si ya esta", () => {
    const t = "Adelanto de *S/20* por Yape al *951365418* (Gerardo Huaynalaya).";
    expect(limpiarFormatoWhatsApp(t)).toBe(t);
  });
  it("no confunde S/2,20 al dia con el adelanto", () => {
    const t = "Te sale a S/2,20 al día.";
    expect(limpiarFormatoWhatsApp(t)).toBe(t);
  });
  it("cambia 'Excelente eleccion' por 'Perfecto'", () => {
    expect(limpiarFormatoWhatsApp("Excelente elección, Rosa. Vamos con 1 frasco")).toBe("Perfecto, Rosa. Vamos con 1 frasco");
    expect(limpiarFormatoWhatsApp("¡Excelente elección, Carlos! Le va a encantar")).toBe("¡Perfecto, Carlos! Le va a encantar");
  });
});

describe("guardas de venta, ronda 2", () => {
  it("pone el Yape junto al monto del adelanto, antes de la pregunta", () => {
    expect(limpiarFormatoWhatsApp("Solo adelantas *S/20* y el resto al recoger. ¿Qué producto te interesa?")).toBe(
      "Solo adelantas *S/20* por Yape al *951365418* (Gerardo Huaynalaya) y el resto al recoger. ¿Qué producto te interesa?",
    );
  });
  it("cambia 'Excelente decision'", () => {
    expect(limpiarFormatoWhatsApp("Excelente decisión, Martha.")).toBe("Perfecto, Martha.");
  });
});

describe("guardas de venta, ronda 3", () => {
  it("no toca 'excelente eleccion' en medio de una oracion", () => {
    const t = "Hola, Carmen. Es una excelente elección para complementar su rutina.";
    expect(limpiarFormatoWhatsApp(t)).toBe(t);
  });
  it("cambia al inicio de linea despues de un saludo", () => {
    expect(limpiarFormatoWhatsApp("Hola Ana. Excelente elección, vamos con 2.")).toBe("Hola Ana. Perfecto, vamos con 2.");
  });
});
