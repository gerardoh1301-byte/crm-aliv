import { describe, expect, it } from "vitest";
import { esNumeroEntrenador, normalizarTelefono } from "@/lib/alerts/supervisor-alerts";

describe("Supervisores y Entrenadores Oficiales", () => {
  it("reconoce los números de supervisores en distintos formatos", () => {
    expect(esNumeroEntrenador("+51951365418")).toBe(true);
    expect(esNumeroEntrenador("951365418")).toBe(true);
    expect(esNumeroEntrenador("+51 951 365 418")).toBe(true);
    expect(esNumeroEntrenador("+51945226853")).toBe(true);
    expect(esNumeroEntrenador("945226853")).toBe(true);
    expect(esNumeroEntrenador("51945226853")).toBe(true);
  });

  it("rechaza números de clientes comunes", () => {
    expect(esNumeroEntrenador("+51931482359")).toBe(false);
    expect(esNumeroEntrenador("986990204")).toBe(false);
    expect(esNumeroEntrenador(null)).toBe(false);
    expect(esNumeroEntrenador("")).toBe(false);
  });

  it("normaliza teléfonos removiendo caracteres no numéricos", () => {
    expect(normalizarTelefono("+51 951-365-418")).toBe("51951365418");
  });
});
