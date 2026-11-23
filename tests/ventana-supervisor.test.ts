import { describe, expect, it } from "vitest";
import {
  MARCA_AVISO_VENTANA,
  debeAvisarVentana,
  esRenovacionVentana,
  textoAvisoVentana,
} from "@/lib/alerts/ventana-supervisor";

const H = 3_600_000;
// Lima = UTC-5. 2026-11-23 15:00 Lima = 20:00 UTC.
const lima = (iso: string) => new Date(`${iso}-05:00`);

describe("aviso de ventana por cerrar (supervisores)", () => {
  it("no avisa con la ventana recién abierta", () => {
    const ahora = lima("2026-11-23T11:00:00");
    expect(debeAvisarVentana(new Date(ahora.getTime() - 2 * H), false, ahora)).toBe(false);
  });
  it("avisa cuando faltan 3 h o menos", () => {
    const ahora = lima("2026-11-23T15:00:00");
    expect(debeAvisarVentana(new Date(ahora.getTime() - 21.5 * H), false, ahora)).toBe(true);
  });
  it("solo una vez por ventana", () => {
    const ahora = lima("2026-11-23T15:00:00");
    expect(debeAvisarVentana(new Date(ahora.getTime() - 21.5 * H), true, ahora)).toBe(false);
  });
  it("no avisa si ya no se puede mandar texto (menos de 10 min)", () => {
    const ahora = lima("2026-11-23T15:00:00");
    expect(debeAvisarVentana(new Date(ahora.getTime() - 23.95 * H), false, ahora)).toBe(false);
    expect(debeAvisarVentana(null, false, ahora)).toBe(false);
  });
  it("de noche (20–22 h) avisa si la ventana cierra antes de las 10:00 de mañana", () => {
    const ahora = lima("2026-11-23T21:00:00");
    // Último mensaje a las 07:00 de hoy: cierra mañana 07:00 → avisar ya.
    expect(debeAvisarVentana(lima("2026-11-23T07:00:00"), false, ahora)).toBe(true);
    // Último mensaje a las 12:00 de hoy: cierra mañana 12:00 → no.
    expect(debeAvisarVentana(lima("2026-11-23T12:00:00"), false, ahora)).toBe(false);
  });
  it("fuera de 20–22 h no adelanta el aviso", () => {
    const ahora = lima("2026-11-23T17:00:00");
    expect(debeAvisarVentana(lima("2026-11-23T07:00:00"), false, ahora)).toBe(false);
  });
  it("el texto lleva la marca, la hora de cierre y pide responder", () => {
    const t = textoAvisoVentana("Gerardo", lima("2026-11-24T07:00:00"));
    expect(t.startsWith(MARCA_AVISO_VENTANA)).toBe(true);
    expect(t).toMatch(/07:00/);
    expect(t).toMatch(/\*ok\*/);
  });
  it("reconoce las respuestas de renovación y no las órdenes", () => {
    for (const s of ["ok", "OK.", "Okey", "listo!", "👍", "👍🏻", "✅", ".", "gracias", "aquí estoy"]) {
      expect(esRenovacionVentana(s)).toBe(true);
    }
    for (const s of ["SI 1047", "adelanto 1153", "ok cancela 1047", "estado 1160", "", null]) {
      expect(esRenovacionVentana(s)).toBe(false);
    }
  });
});
