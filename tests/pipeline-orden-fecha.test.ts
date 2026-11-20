import { describe, expect, it } from "vitest";
import { ordenarPorFechaReciente } from "@/lib/pipeline/orden";

describe("orden de tarjetas por fecha más reciente", () => {
  it("pone arriba la tarjeta con la fecha más nueva (actualización o pago)", () => {
    const deals = [
      { id: "viejo", updatedAt: "2026-11-14T10:00:00Z" },
      { id: "pago-reciente", updatedAt: "2026-11-15T10:00:00Z", finanzasShalom: { saldoFecha: "2026-11-19" } },
      { id: "movido-hoy", updatedAt: "2026-11-20T09:00:00Z" },
      { id: "sin-fecha" },
    ];
    expect(ordenarPorFechaReciente(deals).map((d) => d.id)).toEqual(["movido-hoy", "pago-reciente", "viejo", "sin-fecha"]);
  });

  it("acepta fechas como Date y mantiene el orden original en empates", () => {
    const a = { id: "a", updatedAt: new Date("2026-11-18T00:00:00Z") };
    const b = { id: "b", updatedAt: new Date("2026-11-18T00:00:00Z") };
    expect(ordenarPorFechaReciente([a, b]).map((d) => d.id)).toEqual(["a", "b"]);
  });
});
