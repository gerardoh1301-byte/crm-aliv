import { describe, expect, it } from "vitest";
import { fleteShalomDeNotas, lunesDeSemana, matrizOperacion, productoOperacion, tipoEnvio, type PedidoOperacion } from "@/lib/metricas-operacion";

const p = (over: Partial<PedidoOperacion>): PedidoOperacion => ({
  fecha: "2026-11-19",
  estado: "por_confirmar_cod",
  total: 199,
  unidades: 3,
  producto: "3x NAC600 + NAD+",
  modalidad_pago: "contraentrega",
  transportadora: null,
  despachado: false,
  flete_shalom: null,
  ...over,
});

describe("matriz operativa AG / CE", () => {
  it("clasifica tipo de envío, producto y semana", () => {
    expect(tipoEnvio({ modalidad_pago: "adelanto_agencia", transportadora: null })).toBe("AG");
    expect(tipoEnvio({ modalidad_pago: "contraentrega", transportadora: "Shalom" })).toBe("AG");
    expect(tipoEnvio({ modalidad_pago: "contraentrega", transportadora: "Motorizado Aliv" })).toBe("CE");
    expect(productoOperacion("Tobillera Termix")).toBe("TERMIX");
    expect(productoOperacion("NAC600 + NAD+ (60 cápsulas)")).toBe("NAC600");
    expect(lunesDeSemana("2026-11-22")).toBe("2026-11-16"); // domingo -> lunes anterior
    expect(lunesDeSemana("2026-11-16")).toBe("2026-11-16");
  });

  it("cuenta confirmados, entregados y descartes en confirmación y en entrega", () => {
    const filas = matrizOperacion([
      p({ estado: "entregado", modalidad_pago: "adelanto_agencia", despachado: true, flete_shalom: 8 }),
      p({ estado: "cancelado", modalidad_pago: "adelanto_agencia", despachado: true }),
      p({ estado: "cancelado", modalidad_pago: "adelanto_agencia" }),
      p({ estado: "enviado", modalidad_pago: "adelanto_agencia", despachado: true }),
      p({ estado: "entregado", total: 119, unidades: 1 }),
      p({ estado: "por_confirmar_cod" }),
    ]);
    const ag = filas.find((f) => f.tipo === "AG")!;
    expect(ag).toMatchObject({
      semana: "2026-11-16", producto: "NAC600", recibidos: 4, confirmados: 3, entregados: 1,
      desc_confirmacion: 1, desc_entrega: 1, en_curso: 1, ingresos_entregados: 199, unidades_entregadas: 3, flete_shalom_real: 8,
    });
    const ce = filas.find((f) => f.tipo === "CE")!;
    expect(ce).toMatchObject({ recibidos: 2, confirmados: 1, entregados: 1, en_curso: 1, ingresos_entregados: 119 });
  });

  it("lee el flete Shalom de las notas", () => {
    expect(fleteShalomDeNotas("x [SHALOM_FLETE:8.00|CUENTA:BCP|FECHA:2026-11-19]")).toBe(8);
    expect(fleteShalomDeNotas(null)).toBeNull();
  });
});
