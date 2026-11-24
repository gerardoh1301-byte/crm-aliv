import { describe, expect, it } from "vitest";
import { armarMatriz, cubosDePedido, type PedidoCentro } from "@/lib/dashboard/centro-control-reglas";

const base: PedidoCentro = {
  id: "1", numero: "1001", fecha: "2026-11-20", estado: "por_confirmar_cod", total: 119,
  modalidadPago: "contraentrega", transportadora: null, numeroGuia: null, notas: null,
  contactId: "c1", nombre: "Ana", telefono: "999", asesor: null,
};
const ag = { modalidadPago: "adelanto_agencia", transportadora: "Shalom Empresarial" };

describe("Centro de Control", () => {
  it("por confirmar = en seguimiento", () => {
    expect(cubosDePedido(base)).toEqual(["recibidos", "seguimiento"]);
  });
  it("cancelado sin despachar = descartado en confirmación", () => {
    expect(cubosDePedido({ ...base, estado: "cancelado" })).toEqual(["recibidos", "desc_confirmacion"]);
  });
  it("AG con guía en camino = tránsito; con aviso de llegada = en agencia", () => {
    const enviado = { ...base, ...ag, estado: "enviado", numeroGuia: "104650169" };
    expect(cubosDePedido(enviado)).toContain("ag_transito");
    expect(cubosDePedido({ ...enviado, notas: "[AVISO_LLEGADA_ENVIADO" })).toContain("ag_agencia");
  });
  it("AG cancelado despachado = confirmado + descartado en entrega + descartado logístico", () => {
    const c = cubosDePedido({ ...base, ...ag, estado: "cancelado", numeroGuia: "1" });
    expect(c).toEqual(expect.arrayContaining(["confirmados", "desc_entrega", "ag_descartados"]));
  });
  it("la matriz separa AG y CE y suma en TOTAL", () => {
    const m = armarMatriz([
      { ...base, estado: "entregado" },
      { ...base, id: "2", ...ag, estado: "entregado", numeroGuia: "1" },
    ]);
    expect(m.TOTAL.entregados).toHaveLength(2);
    expect(m.AG.entregados).toHaveLength(1);
    expect(m.CE.entregados).toHaveLength(1);
    expect(m.AG.ag_entregados).toHaveLength(1);
    expect(m.CE.ag_entregados).toHaveLength(0);
  });
});
