import { describe, it, expect } from "vitest";
import {
  buildMensajeDia1,
  buildMensajeDia7,
  buildMensajeDia25,
  esElegibleParaPostventa,
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

  it("R2: respeta estrictamente aiEnabled, needsHuman y etiquetas de reclamo", () => {
    const baseContact = { aiEnabled: true, needsHuman: false, tags: ["informativo"] };
    const baseConv = { aiEnabled: true, needsHuman: false, metadata: {} };

    // Cliente elegible estándar
    expect(esElegibleParaPostventa(baseContact, baseConv).elegible).toBe(true);

    // 1. Bot apagado en contacto
    expect(
      esElegibleParaPostventa({ ...baseContact, aiEnabled: false }, baseConv).elegible
    ).toBe(false);

    // 2. Bot apagado en conversación
    expect(
      esElegibleParaPostventa(baseContact, { ...baseConv, aiEnabled: false }).elegible
    ).toBe(false);

    // 3. Cliente requiere atención humana (ej. derivado)
    expect(
      esElegibleParaPostventa({ ...baseContact, needsHuman: true }, baseConv).elegible
    ).toBe(false);
    expect(
      esElegibleParaPostventa(baseContact, { ...baseConv, needsHuman: true }).elegible
    ).toBe(false);

    // 4. Modo asistido o pausado
    expect(
      esElegibleParaPostventa(baseContact, { ...baseConv, metadata: { copilotMode: true } }).elegible
    ).toBe(false);
    expect(
      esElegibleParaPostventa(baseContact, { ...baseConv, metadata: { agentPaused: true } }).elegible
    ).toBe(false);

    // 5. Etiquetas de reclamo, queja o no reactivar (caso Alberto)
    expect(
      esElegibleParaPostventa({ ...baseContact, tags: ["Reclamo", "cliente difícil"] }, baseConv).elegible
    ).toBe(false);
    expect(
      esElegibleParaPostventa({ ...baseContact, tags: ["no reactivar"] }, baseConv).elegible
    ).toBe(false);
    expect(
      esElegibleParaPostventa({ ...baseContact, tags: ["atencion manual"] }, baseConv).elegible
    ).toBe(false);
  });
});

describe("Reglas de Negocio y Base de Conocimientos (Settings)", () => {
  it("renderiza correctamente las reglas y FAQs en formato prompt con garantía oficial", () => {
    const rules: BusinessRulesData = {
      ...DEFAULT_BUSINESS_RULES,
      faqs: [
        {
          pregunta: "¿Tiene registro sanitario?",
          respuesta: "Sí, cuenta con certificación oficial.",
        },
      ],
      promocionesTemporales: "3 frascos por S/ 199.",
      horariosAtencion: "Lunes a sábado de 9am a 7pm.",
    };

    const rendered = renderBusinessRulesPrompt(rules);
    expect(rendered).toContain("# INFORMACIÓN, REGLAS Y FAQS ADICIONALES");
    expect(rendered).toContain("¿Tiene registro sanitario?");
    expect(rendered).toContain("Sí, cuenta con certificación oficial.");
    expect(rendered).toContain("Garantía oficial Aliv Perú de producto 100% sellado");
    expect(rendered).toContain("3 frascos por S/ 199.");
    expect(rendered).toContain("Lunes a sábado de 9am a 7pm.");
  });

  it("R12: normaliza tildes y diacríticos para disparar alertas críticas ante palabras acentuadas", () => {
    const motivosConTilde = [
      "El cliente tiene una duda médica urgente",
      "Reportó una reacción alérgica severa",
      "Afirma que el producto le causó daño estomacal",
    ];

    for (const m of motivosConTilde) {
      const norm = m
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/ñ/g, "n")
        .toLowerCase();

      const esReclamoMedico = /(reclamo|molestia|enfermedad|dolor|medic[oa]|reaccion|dan[io]|mal estado|insatisfaccion|alergia)/i.test(
        norm
      );
      expect(esReclamoMedico).toBe(true);
    }
  });
});
