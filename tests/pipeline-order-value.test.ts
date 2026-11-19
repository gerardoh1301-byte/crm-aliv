import { describe, it, expect } from "vitest";
import { formatCurrency } from "@/lib/constants";

describe("Cálculo y formateo de valor en Pipeline y Órdenes", () => {
  it("formatCurrency formatea centavos a soles sin decimales", () => {
    expect(formatCurrency(7900)).toMatch(/79/);
    expect(formatCurrency(13900)).toMatch(/139/);
    expect(formatCurrency(19900)).toMatch(/199/);
    expect(formatCurrency(11900)).toMatch(/119/);
  });

  it("normaliza ordenTotal en soles ('79.00') a centavos para el pipeline (7900)", () => {
    const ordenTotal = "79.00";
    const dealValueRaw = 79; // guardado por error en soles en vez de centavos

    const valorNormalizado = ordenTotal && Number(ordenTotal) > 0
      ? Math.round(Number(ordenTotal) * 100)
      : (dealValueRaw > 0 && dealValueRaw < 500 ? Math.round(dealValueRaw * 100) : dealValueRaw);

    expect(valorNormalizado).toBe(7900);
    expect(formatCurrency(valorNormalizado)).toMatch(/79/);
  });

  it("mantiene valores ya en centavos (ej: 19900)", () => {
    const ordenTotal = null;
    const dealValueRaw = 19900;

    const valorNormalizado = ordenTotal && Number(ordenTotal) > 0
      ? Math.round(Number(ordenTotal) * 100)
      : (dealValueRaw > 0 && dealValueRaw < 500 ? Math.round(dealValueRaw * 100) : dealValueRaw);

    expect(valorNormalizado).toBe(19900);
    expect(formatCurrency(valorNormalizado)).toMatch(/199/);
  });
});
