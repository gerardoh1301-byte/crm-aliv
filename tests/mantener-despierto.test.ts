import { describe, expect, it } from "vitest";
import { urlPing } from "@/lib/mantener-despierto";
import { promptAsistente } from "@/lib/supervisor/asistente";

describe("mantener despierto el CRM en Render gratis", () => {
  it("se llama por la URL pública de Render, no por 127.0.0.1", () => {
    expect(urlPing({ RENDER_EXTERNAL_URL: "https://crm-aliv.onrender.com/" })).toBe("https://crm-aliv.onrender.com/api/health");
  });
  it("no hace nada fuera de Render o si se apaga", () => {
    expect(urlPing({})).toBeNull();
    expect(urlPing({ RENDER_EXTERNAL_URL: "http://localhost:3000" })).toBeNull();
    expect(urlPing({ RENDER_EXTERNAL_URL: "https://crm-aliv.onrender.com", MANTENER_DESPIERTO: "off" })).toBeNull();
  });
});

describe("asistente: reglas del 22/11", () => {
  it("propone con herramienta y no dice listo si falta algo", () => {
    const p = promptAsistente(new Date("2026-11-22T15:00:00Z"));
    expect(p).toContain("LLAMA a la herramienta proponer_*");
    expect(p).toContain("*Todavía no*");
  });
});
