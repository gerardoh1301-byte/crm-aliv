import { describe, expect, it } from "vitest";
import { esMotivoDeBaja } from "../src/lib/agent/baja";
import { limpiarFormatoWhatsApp, removerSaludoRepetido } from "../src/lib/agent/formato";

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

describe("guardas de venta, ronda 9", () => {
  it("corrige la subida de 1 a 3 frascos (S/80, no S/70)", () => {
    expect(limpiarFormatoWhatsApp("Por S/70 más que el frasco suelto, el pack de 3 frascos te da 90 días.")).toBe(
      "Por S/80 más que el frasco suelto, el pack de 3 frascos te da 90 días.",
    );
  });
  it("deja la subida correcta de 1 a 2", () => {
    const t = "Un dato: por S/70 más te llevas 2 frascos y tienes 60 días de uso.";
    expect(limpiarFormatoWhatsApp(t)).toBe(t);
  });
  it("quita 'seguro' de 'es un complemento seguro'", () => {
    expect(limpiarFormatoWhatsApp("Es un complemento seguro; si tomas medicación, consúltalo.")).toBe(
      "Es un complemento; si tomas medicación, consúltalo.",
    );
  });
});

describe("guardas de venta, ronda 10", () => {
  it("corrige S/70 aunque el pack de 3 aparezca mas lejos en la frase", () => {
    expect(
      limpiarFormatoWhatsApp("Un dato: por S/70 más te llevas 2 frascos más y tienes 90 días de uso continuo con el pack de 3."),
    ).toContain("S/80");
  });

  it("elimina cápsulas blandas y softgels reemplazándolos por cápsulas", () => {
    expect(
      limpiarFormatoWhatsApp("Cada frasco trae 60 cápsulas blandas para 30 días."),
    ).toBe("Cada frasco trae 60 cápsulas para 30 días.");

    expect(
      limpiarFormatoWhatsApp("Viene en formato de cápsula blanda de alta absorción."),
    ).toBe("Viene en formato de cápsula de alta absorción.");

    expect(
      limpiarFormatoWhatsApp("Contiene 60 softgels importados."),
    ).toBe("Contiene 60 cápsulas importados.");

    expect(
      limpiarFormatoWhatsApp("Cada softgel aporta 600 mg de NAC."),
    ).toBe("Cada cápsula aporta 600 mg de NAC.");
  });

  it("sustituye 'porción' por 'dosis diaria (2 cápsulas)' o 'dosis'", () => {
    expect(
      limpiarFormatoWhatsApp("Contiene 600 mg de NAC por porción."),
    ).toBe("Contiene 600 mg de NAC por dosis diaria (2 cápsulas).");

    expect(
      limpiarFormatoWhatsApp("Toma una porción cada mañana."),
    ).toBe("Toma una dosis cada mañana.");
  });

  it("corrige afirmaciones de que los domingos hay envíos", () => {
    expect(
      limpiarFormatoWhatsApp("Los domingos hay envíos para entregarte tu pedido."),
    ).toContain("los envíos se realizan de lunes a sábado (los domingos no hay repartos)");

    expect(
      limpiarFormatoWhatsApp("El domingo te lo enviamos a tu casa."),
    ).toContain("las entregas son de lunes a sábado");
  });

  it("elimina saludos repetitivos en turnos posteriores (removerSaludoRepetido)", () => {
    // Caso exacto de Hilda: Turno 2
    expect(
      removerSaludoRepetido("¡Hola, Hilda! La finalidad de comprar 1 tobillera es si solo te molesta un pie o quieres probarla."),
    ).toBe("La finalidad de comprar 1 tobillera es si solo te molesta un pie o quieres probarla.");

    // Caso exacto de Hilda: Turno 3
    expect(
      removerSaludoRepetido("¡Hola, Hilda! Entiendo. ¿Hay alguna otra duda sobre la Termix Tobillera?"),
    ).toBe("Entiendo. ¿Hay alguna otra duda sobre la Termix Tobillera?");

    // Variaciones con Hola, Hola [nombre], emojis, minúsculas
    expect(
      removerSaludoRepetido("¡Hola! El precio es de S/79."),
    ).toBe("El precio es de S/79.");

    expect(
      removerSaludoRepetido("Hola Hilda, perfecto, te la enviamos."),
    ).toBe("Perfecto, te la enviamos.");

    expect(
      removerSaludoRepetido("¡Hola, María Elena! 👋 Te comento sobre las cápsulas."),
    ).toBe("Te comento sobre las cápsulas.");

    expect(
      removerSaludoRepetido("¡Hola DJ! Quería saber si tuviste oportunidad de revisar los detalles."),
    ).toBe("Quería saber si tuviste oportunidad de revisar los detalles.");

    expect(
      removerSaludoRepetido("¡Hola, HILDA! Entiendo perfectamente lo que necesitas."),
    ).toBe("Entiendo perfectamente lo que necesitas.");

    expect(
      removerSaludoRepetido("Buenas tardes Carlos, el pedido está en camino."),
    ).toBe("El pedido está en camino.");

    // NO debe alterar mensajes que no son saludos al inicio
    expect(
      removerSaludoRepetido("Entendido, Hilda. Ya le dejé la indicación al motorizado."),
    ).toBe("Entendido, Hilda. Ya le dejé la indicación al motorizado.");

    expect(
      removerSaludoRepetido("Perfecto, Hilda. Te lo enviamos este lunes."),
    ).toBe("Perfecto, Hilda. Te lo enviamos este lunes.");

    expect(
      removerSaludoRepetido("Claro que sí, Hilda, no te preocupes."),
    ).toBe("Claro que sí, Hilda, no te preocupes.");
  });

  it("elimina vocativos robóticos con números de usuario o teléfono", () => {
    expect(limpiarFormatoWhatsApp("¡Perfecto, anacarrera2318! Queda programado.")).toBe(
      "¡Perfecto! Queda programado.",
    );
    expect(limpiarFormatoWhatsApp("¡Hola 51945226853! Te cuento los detalles.")).toBe(
      "¡Hola! Te cuento los detalles.",
    );
  });

  it("corrige cualquier afirmación errónea de pago en ventanilla de Shalom", () => {
    const msg = limpiarFormatoWhatsApp(
      "El saldo restante de S/179 lo pagas directamente en la ventanilla de la agencia Shalom al momento de retirar tu paquete.",
    );
    expect(msg).not.toContain("ventanilla de la agencia");
    expect(msg).toContain("951365418");
    expect(msg).toContain("clave secreta de retiro");
  });
});
