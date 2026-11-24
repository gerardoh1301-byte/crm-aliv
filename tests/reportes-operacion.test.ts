import { describe, expect, it } from "vitest";
import { calcularUbu, porCanal, porMes, tasas, type PedidoReporte } from "@/lib/reportes-operacion-reglas";

const p = (x: Partial<PedidoReporte>): PedidoReporte => ({
  fecha: "2026-11-10", estado: "entregado", total: 119, unidades: 2, producto: "NAC600 60 cápsulas",
  modalidad_pago: "contraentrega", transportadora: null, despachado: true, flete_shalom: null, canal: "Bot", ...x,
});

describe("reportes AG | CE", () => {
  it("cuenta por mes y tipo con tasas", () => {
    const [nov] = porMes([
      p({}),
      p({ estado: "cancelado", despachado: false }),
      p({ modalidad_pago: "adelanto_agencia", transportadora: "Shalom" }),
    ]);
    expect(nov.clave).toBe("2026-11");
    expect(nov.columnas.CE.recibidos).toBe(2);
    expect(nov.columnas.AG.entregados).toBe(1);
    expect(tasas(nov.columnas.CE)).toEqual({ confirmacion: 0.5, entrega: 1 });
  });
  it("logística: AG flete real o 10 + 5, CE 16,5", () => {
    const [f] = porMes([
      p({ modalidad_pago: "adelanto_agencia", flete_shalom: 8 }),
      p({ modalidad_pago: "adelanto_agencia" }),
      p({}),
    ]);
    expect(f.columnas.AG.logistica).toBe(13 + 15);
    expect(f.columnas.CE.logistica).toBe(16.5);
  });
  it("UBU = ticket − producto − logística − CPA entregado", () => {
    const [f] = porMes([p({})]); // 119 − 2×18 − 16,5 = 66,5
    const r = calcularUbu(f.columnas.CE, 20);
    expect(r.up).toBe(83);
    expect(r.cpaEntregado).toBe(20);
    expect(r.ubu).toBeCloseTo(46.5);
    expect(calcularUbu(f.columnas.CE, 0).cpaRecibido).toBeNull();
  });
  it("agrupa por canal", () => {
    const filas = porCanal([p({}), p({ canal: "Web" }), p({ canal: "Bot" })]);
    expect(filas[0].clave).toBe("Bot");
    expect(filas[0].columnas.TOTAL.recibidos).toBe(2);
  });
});
