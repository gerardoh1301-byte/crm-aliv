import { describe, expect, it } from "vitest";
import { textoRastreoShalom } from "@/lib/agencias/shalom-rastreo";

describe("datos de rastreo Shalom para el bot", () => {
  it("da el N° de orden y el código alfanumérico juntos", () => {
    const t = textoRastreoShalom("104493000", "3KJP");
    expect(t).toContain("104493000");
    expect(t).toContain("3KJP");
  });
  it("sin código no lo inventa y deriva a un asesor", () => {
    const t = textoRastreoShalom("104493000", null);
    expect(t).toMatch(/falta el codigo/i);
    expect(t).toMatch(/no lo inventes/i);
  });
  it("sin N° de orden dice que sigue en preparación", () => {
    expect(textoRastreoShalom(null, null)).toMatch(/preparacion/i);
  });
});
