import { describe, it, expect } from "vitest";
import {
  buildMensajeDia1,
  buildMensajeDia7,
  buildMensajeDia25,
} from "@/lib/postventa/engine";
import {
  DEFAULT_BUSINESS_RULES,
  renderBusinessRulesPrompt,
  type BusinessRulesData,
} from "@/lib/settings/rules";
import { esNumeroEntrenador } from "@/lib/alerts/supervisor-alerts";

describe("Postventa y Recompra Automática", () => {
  it("genera los mensajes correctos para los días 1, 7 y 25 con el nombre del cliente", () => {
    const msg1 = buildMensajeDia1("Rosario");
    expect(msg1).toContain("¡Hola, Rosario!");
    expect(msg1).toContain("2 cápsulas al día");
    expect(msg1).toContain("desayuno");

    const msg7 = buildMensajeDia7("Rosario");
    expect(msg7).toContain("¡Hola, Rosario!");
    expect(msg7).toContain("primera semana");
    expect(msg7).toContain("glutatión");

    const msg25 = buildMensajeDia25("Rosario");
    expect(msg25).toContain("¡Hola, Rosario!");
    expect(msg25).toContain("últimos días de tratamiento");
    expect(msg25).toContain("2 frascos por S/ 189 o 3 frascos por S/ 199");
  });

  it("protege números de entrenadores para que no sean considerados clientes de postventa", () => {
    expect(esNumeroEntrenador("+51951365418")).toBe(true);
    expect(esNumeroEntrenador("951365418")).toBe(true);
    expect(esNumeroEntrenador("+51945226853")).toBe(true);
    expect(esNumeroEntrenador("945226853")).toBe(true);

    // Cliente regular no es entrenador
    expect(esNumeroEntrenador("+51986990204")).toBe(false);
    expect(esNumeroEntrenador("931482359")).toBe(false);
  });
});

describe("Reglas de Negocio y Base de Conocimientos (Settings)", () => {
  it("renderiza correctamente las reglas y FAQs en formato prompt", () => {
    const rules: BusinessRulesData = {
      ...DEFAULT_BUSINESS_RULES,
      faqs: [
        {
          pregunta: "¿Tiene registro sanitario?",
          respuesta: "Sí, cuenta con certificación oficial.",
        },
      ],
      politicas: "Garantía de 30 días.",
      promocionesTemporales: "3 frascos por S/ 199.",
      horariosAtencion: "Lunes a sábado de 9am a 7pm.",
    };

    const rendered = renderBusinessRulesPrompt(rules);
    expect(rendered).toContain("# INFORMACIÓN, REGLAS Y FAQS ADICIONALES");
    expect(rendered).toContain("¿Tiene registro sanitario?");
    expect(rendered).toContain("Sí, cuenta con certificación oficial.");
    expect(rendered).toContain("Garantía de 30 días.");
    expect(rendered).toContain("3 frascos por S/ 199.");
    expect(rendered).toContain("Lunes a sábado de 9am a 7pm.");
  });
});
