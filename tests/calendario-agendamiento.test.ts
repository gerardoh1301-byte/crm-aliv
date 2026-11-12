import { describe, it, expect } from "vitest";
import {
  calcularFechaProxima,
  parsearHoraInicio,
  obtenerFechaLima,
  construirFechaLima,
} from "@/lib/agent/scheduler";

describe("agendador de calendario - K2 parseo de hora", () => {
  it("ignora el número del día y extrae la hora real (K2)", () => {
    // "Sábado 14 de noviembre a las 10:00 a.m." debe dar 10:00 AM (no 14 / 2:00 PM)
    expect(parsearHoraInicio("Sábado 14 de noviembre a las 10:00 a.m.")).toEqual({
      hora: 10,
      minutos: 0,
    });
    expect(parsearHoraInicio("el 14 a las 10")).toEqual({ hora: 10, minutos: 0 });
    expect(parsearHoraInicio("14 nov 10am")).toEqual({ hora: 10, minutos: 0 });
  });

  it("aplica heurística de entregas para horas 1 a 7 sin pm (K2)", () => {
    // "de 2 a 5" sin pm debe ser tarde (14:00), no madrugada (2:00 AM)
    expect(parsearHoraInicio("de 2 a 5")).toEqual({ hora: 14, minutos: 0 });
    expect(parsearHoraInicio("a las 3")).toEqual({ hora: 15, minutos: 0 });
    expect(parsearHoraInicio("entre las 2 y las 5")).toEqual({ hora: 14, minutos: 0 });
  });

  it("mantiene mañana para horas 8 a 12 (K2)", () => {
    expect(parsearHoraInicio("de 8 a 4")).toEqual({ hora: 8, minutos: 0 });
    expect(parsearHoraInicio("a las 10")).toEqual({ hora: 10, minutos: 0 });
    expect(parsearHoraInicio("a las 11:30")).toEqual({ hora: 11, minutos: 30 });
  });

  it("entiende frases 'de la tarde' y 'de la mañana' (K2)", () => {
    expect(parsearHoraInicio("a las 3 de la tarde")).toEqual({ hora: 15, minutos: 0 });
    expect(parsearHoraInicio("a las 10 de la mañana")).toEqual({ hora: 10, minutos: 0 });
    expect(parsearHoraInicio("en la tarde")).toEqual({ hora: 15, minutos: 0 });
    expect(parsearHoraInicio("en la mañana")).toEqual({ hora: 9, minutos: 0 });
  });
});

describe("agendador de calendario - K3 reloj de Render en UTC vs Lima", () => {
  it("resuelve fechas relativas correctamente un jueves a las 8:30 PM Lima (viernes 1:30 AM UTC)", () => {
    // Jueves 12 Nov 2026, 20:30 Lima = 2026-11-13T01:30:00Z UTC
    const juevesNocheUTC = new Date("2026-11-13T01:30:00.000Z");

    const lima = obtenerFechaLima(juevesNocheUTC);
    expect(lima.dayOfWeek).toBe(4); // 4 = Jueves en Lima
    expect(lima.day).toBe(12); // Día 12 en Lima
    expect(lima.hours).toBe(20);
    expect(lima.minutes).toBe(30);

    // "mañana a las 10" debe ser VIERNES 13, no sábado
    const manana = calcularFechaProxima("mañana a las 10", juevesNocheUTC);
    expect(manana.day).toBe(13);
    expect(manana.month).toBe(11);

    // "sábado a las 10" debe ser SÁBADO 14
    const sabado = calcularFechaProxima("sábado a las 10", juevesNocheUTC);
    expect(sabado.day).toBe(14);
    expect(sabado.month).toBe(11);

    // "el viernes de 2 a 5" debe ser VIERNES 13
    const viernes = calcularFechaProxima("el viernes de 2 a 5", juevesNocheUTC);
    expect(viernes.day).toBe(13);
    expect(viernes.month).toBe(11);

    // "a las 3 de la tarde" sin día explícito asume mañana (viernes 13)
    const tarde = calcularFechaProxima("a las 3 de la tarde", juevesNocheUTC);
    expect(tarde.day).toBe(13);

    // Verificar construcción con offset -05:00
    const fechaFinal = construirFechaLima(sabado.year, sabado.month, sabado.day, 10, 0);
    expect(fechaFinal.toISOString()).toBe("2026-11-14T15:00:00.000Z"); // 10:00 Lima = 15:00 UTC
  });
});
