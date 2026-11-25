import { describe, expect, it } from "vitest";
import { MARCA_FICHA_ALICLIK, debeAvisarFicha, textoFichaAliclik } from "../src/lib/pedidos/ficha-aliclik-reglas";
import { datosDeRotulo } from "../src/lib/pedidos/guia-pdf-reglas";

const base = {
  numeroOrden: "#1181",
  transportadora: "Shalom",
  modalidadPago: "adelanto_agencia",
  numeroGuia: "105410411",
  codigo: "HMNJ",
  clave: "9944",
  dni: "00213048",
  agencia: "Agencia Shalom Paita (Mz. H Lt. 14 Urb. Sol y Mar)",
  total: "119.00",
  items: [{ cantidad: 1, titulo: "NAC600" }],
  notas: "[GUIA_PDF:a|img:b|t:c]",
  cliente: "augusto Noel Urbina",
  telefono: "+51991794866",
};

describe("ficha para AliClik (#1181)", () => {
  it("avisa con preguía, N° de orden, código y clave", () => {
    expect(debeAvisarFicha(base)).toBe(true);
    const t = textoFichaAliclik(base);
    expect(t).toContain("105410411");
    expect(t).toContain("HMNJ");
    expect(t).toContain("9944");
    expect(t).toContain("991794866");
    expect(t).toContain("S/5");
  });
  it("no avisa sin clave, sin preguía, si ya se avisó o si ya tiene orden AliClik", () => {
    expect(debeAvisarFicha({ ...base, clave: null })).toBe(false);
    expect(debeAvisarFicha({ ...base, notas: "" })).toBe(false);
    expect(debeAvisarFicha({ ...base, notas: base.notas + "\n" + MARCA_FICHA_ALICLIK })).toBe(false);
    expect(debeAvisarFicha({ ...base, notas: base.notas + "\n[ALICLIK_ORDEN:ERG1]" })).toBe(false);
    expect(debeAvisarFicha({ ...base, transportadora: null, modalidadPago: "contraentrega" })).toBe(false);
  });
});

describe("lectura del rótulo Shalom", () => {
  it("acepta 105410411 / HMNJ y descarta lo que no calza", () => {
    expect(datosDeRotulo('{"numeroOrden":"105410411","codigo":"HMNJ"}')).toEqual({ numeroOrden: "105410411", codigo: "HMNJ" });
    expect(datosDeRotulo('```json\n{"numeroOrden":"N° 105 410 411","codigo":"hmnj"}\n```')).toEqual({ numeroOrden: "105410411", codigo: "HMNJ" });
    expect(datosDeRotulo('{"numeroOrden":"12","codigo":"ABCDE"}')).toBeNull();
    expect(datosDeRotulo("no se lee")).toBeNull();
  });
});
