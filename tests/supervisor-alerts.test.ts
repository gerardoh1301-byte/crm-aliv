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

describe("avisos internos sin plantilla (sin cobro de Meta)", () => {
  it("el aviso interno es solo texto, nunca plantilla", async () => {
    const { mensajeAvisoInterno } = await import("@/lib/alerts/supervisor-alerts");
    const m = mensajeAvisoInterno("🚨 ALERTA");
    expect(m).toEqual({ text: "🚨 ALERTA" });
    expect("template" in m).toBe(false);
  });
  it("el módulo ya no usa plantillas de aviso", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync("src/lib/alerts/supervisor-alerts.ts", "utf8");
    expect(src).not.toMatch(/template\s*:/);
    expect(src).not.toMatch(/aliv_aviso_interno|aliv_alerta_supervisor/);
  });
});
