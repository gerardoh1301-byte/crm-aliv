import { describe, expect, it } from "vitest";
import { construirTag, extraerFinanzasShalom, reemplazarTag } from "../src/lib/finanzas/tags-shalom";

describe("etiquetas de dinero Shalom", () => {
  it("lee flete, adelanto y saldo desde las notas", () => {
    const notas = [
      "Cliente pide entrega rápida",
      "[ADELANTO VERIFICADO]",
      construirTag("SHALOM_FLETE", 10, { CUENTA: "BCP", FECHA: "2026-11-19" }),
      construirTag("ADELANTO_MONTO", 20, { OP: "123", FECHA: "2026-11-18", CUENTA: "BCP" }),
      construirTag("SALDO_COBRADO", 179, { OP: "987", FECHA: "2026-11-20", CUENTA: "BCP" }),
    ].join("\n");
    const f = extraerFinanzasShalom(notas);
    expect(f).toMatchObject({
      fleteShalom: 10,
      fleteFecha: "2026-11-19",
      adelantoMonto: 20,
      adelantoOp: "123",
      saldoMonto: 179,
      saldoOp: "987",
      saldoFecha: "2026-11-20",
    });
  });

  it("sin etiquetas devuelve null y un saldo vacío queda pendiente", () => {
    expect(extraerFinanzasShalom("[ADELANTO VERIFICADO]")).toBeNull();
    const f = extraerFinanzasShalom("[SHALOM_FLETE:12.00|CUENTA:BCP|FECHA:2026-11-19]");
    expect(f?.saldoMonto).toBeNull();
  });

  it("reemplazar una etiqueta no duplica ni borra las demás", () => {
    let n = "nota\n[SHALOM_FLETE:8.00|CUENTA:BCP|FECHA:2026-11-18]\n[ALICLIK_LIQUIDADO_BCP:100.00|BRUTO:119.00]";
    n = reemplazarTag(n, "SHALOM_FLETE", "[SHALOM_FLETE:12.00|CUENTA:BCP|FECHA:2026-11-19]");
    expect(n.match(/SHALOM_FLETE/g)).toHaveLength(1);
    expect(n).toContain("12.00");
    expect(n).toContain("ALICLIK_LIQUIDADO_BCP");
  });

  it("limpia caracteres que romperían la etiqueta", () => {
    const tag = construirTag("SALDO_COBRADO", 99, { OP: "12|34]x" });
    expect(extraerFinanzasShalom(tag)?.saldoOp).toBe("1234x");
  });
});
