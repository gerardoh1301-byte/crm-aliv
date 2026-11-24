import { describe, expect, it } from "vitest";
import { BLOQUE_POSTULANTE, esPostulante } from "@/lib/agent/postulante";

describe("esPostulante", () => {
  it("detecta el mensaje del aviso de empleo", () => {
    expect(esPostulante([{ role: "user", content: "Hola, quiero postular al puesto de Asesor comercial" }])).toBe(true);
  });
  it("acepta asesora y asesor(a) en cualquier mensaje del cliente", () => {
    expect(esPostulante([{ role: "user", content: "hola" }, { role: "user", content: "es por lo de asesora comercial" }])).toBe(true);
    expect(esPostulante([{ role: "user", content: "vi el aviso de ASESOR(A) COMERCIAL" }])).toBe(true);
  });
  it("no se activa con clientes normales ni con textos del bot", () => {
    expect(esPostulante([{ role: "user", content: "Quiero más información del NAC600" }])).toBe(false);
    expect(esPostulante([{ role: "assistant", content: "Un asesor comercial te escribirá" }])).toBe(false);
  });
});

describe("BLOQUE_POSTULANTE", () => {
  it("lleva las condiciones del puesto y no pide CV", () => {
    expect(BLOQUE_POSTULANTE).toContain("5 días virtuales y 1 día presencial en La Molina");
    expect(BLOQUE_POSTULANTE).toContain("S/600 mensuales fijos + 2%");
    expect(BLOQUE_POSTULANTE).toContain("30 órdenes al día");
    expect(BLOQUE_POSTULANTE).toContain("NO pidas CV");
  });
});
