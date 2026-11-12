import { describe, it, expect } from "vitest";
import { calcularFechaProxima, parsearHoraInicio } from "@/lib/agent/scheduler";

describe("agendador de calendario", () => {
  it("calcula correctamente fechas para días de la semana", () => {
    // Base: Miércoles 11 Nov 2026
    const base = new Date("2026-11-11T12:00:00Z");

    const sabado = calcularFechaProxima("Sábado de 8 a 4", base);
    expect(sabado.getDay()).toBe(6); // Sábado

    const viernes = calcularFechaProxima("este viernes por la tarde", base);
    expect(viernes.getDay()).toBe(5); // Viernes

    const manana = calcularFechaProxima("mañana a primera hora", base);
    expect(manana.getDate()).toBe(base.getDate() + 1);
  });

  it("parsea horarios de inicio en formato militar o am/pm", () => {
    expect(parsearHoraInicio("de 8 a 4")).toEqual({ hora: 8, minutos: 0 });
    expect(parsearHoraInicio("Sábado de 8 a 4")).toEqual({ hora: 8, minutos: 0 });
    expect(parsearHoraInicio("a las 3pm")).toEqual({ hora: 15, minutos: 0 });
    expect(parsearHoraInicio("a las 15:30")).toEqual({ hora: 15, minutos: 30 });
    expect(parsearHoraInicio("en la mañana")).toEqual({ hora: 9, minutos: 0 });
    expect(parsearHoraInicio("en la tarde")).toEqual({ hora: 15, minutos: 0 });
  });

  it("calcula fecha con día del mes", () => {
    const base = new Date("2026-11-11T12:00:00Z");
    const d15 = calcularFechaProxima("el 15 cobro", base);
    expect(d15.getDate()).toBe(15);
  });
});
