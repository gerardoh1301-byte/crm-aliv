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

describe("guardas de venta, ronda 4", () => {
  it("quita la promesa de despacho 'hoy mismo'", () => {
    expect(limpiarFormatoWhatsApp("Envíame la captura para registrar tu despacho hoy mismo. 👟")).toBe(
      "Envíame la captura para registrar tu despacho. 👟",
    );
  });
});

describe("guardas de venta, ronda 6", () => {
  it("quita 'hoy' pegado a enviar o despachar", () => {
    expect(limpiarFormatoWhatsApp("Para enviártela hoy, pásame tu nombre.")).toBe("Para enviártela, pásame tu nombre.");
  });
  it("no toca 'hoy' en otros usos", () => {
    const t = "¿Te lo enviamos a Lima? Hoy tenemos stock.";
    expect(limpiarFormatoWhatsApp(t)).toBe(t);
  });
});

describe("guardas de venta, ronda 7", () => {
  it("no deja pasar llamadas a herramientas escritas como texto", () => {
    const t =
      "Entendido, Carmen.\n\n`enviar_imagen_referencia(clave='nac600_beneficios', motivo='Aquí tienes')`\n\n¿Te escribo mañana a las 11?\n\n`registrar_actividad(descripcion='Seguimiento', fecha='2026-11-14', tipo='tarea')`";
    expect(limpiarFormatoWhatsApp(t)).toBe("Entendido, Carmen.\n\n¿Te escribo mañana a las 11?");
  });
});

describe("guardas de venta, ronda 8", () => {
  it("quita la promesa 'no causa efectos secundarios'", () => {
    const t =
      "Es un complemento de uso diario.\n\nRespecto a tu consulta, no causa efectos secundarios comunes; sin embargo, si tomas medicación, consúltalo con tu médico.";
    expect(limpiarFormatoWhatsApp(t)).toBe(
      "Es un complemento de uso diario.\n\nSi tomas medicación, consúltalo con tu médico.",
    );
  });
  it("no toca horarios con p. m.", () => {
    const t = "Entrega de 2:00 p. m. a 6:00 p. m. ¿Te parece?";
    expect(limpiarFormatoWhatsApp(t)).toBe(t);
  });
});
