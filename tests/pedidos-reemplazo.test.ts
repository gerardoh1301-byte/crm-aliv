import { describe, expect, it } from "vitest";
import { esReemplazable } from "@/lib/pedidos/reemplazo";

const nac = [{ titulo: "NAC600 + NAD+ (60 cápsulas)" }];
const base = { estado: "por_confirmar_cod", numeroGuia: null, notas: "Pedido web #1114", items: nac };

describe("esReemplazable", () => {
  it("reemplaza un pedido abierto del mismo producto", () => {
    expect(esReemplazable(base, [{ titulo: "NAC600" }])).toBe(true);
  });
  it("no toca un pedido con guía, orden AliClik o adelanto verificado", () => {
    expect(esReemplazable({ ...base, numeroGuia: "104650169" }, nac)).toBe(false);
    expect(esReemplazable({ ...base, notas: "[ALICLIK_ORDEN:ERG1] x" }, nac)).toBe(false);
    expect(esReemplazable({ ...base, notas: "[ADELANTO VERIFICADO] S/20" }, nac)).toBe(false);
  });
  it("no toca pedidos cerrados", () => {
    expect(esReemplazable({ ...base, estado: "enviado" }, nac)).toBe(false);
    expect(esReemplazable({ ...base, estado: "cancelado" }, nac)).toBe(false);
  });
  it("no cancela el NAC600 por una compra de Termix", () => {
    expect(esReemplazable(base, [{ titulo: "Tobillera Termix" }])).toBe(false);
  });
});
