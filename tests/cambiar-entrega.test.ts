import { describe, expect, it } from "vitest";
import { planCambioEntrega, type PedidoCambioEntrega } from "@/lib/pedidos/cambiar-entrega-reglas";
import { esContraEntregaAliclik } from "@/lib/pedidos/entrega-aliclik";

const ahora = new Date("2026-11-26T18:00:00Z");
const base: PedidoCambioEntrega = {
  numeroOrden: "#1199",
  estado: "confirmado",
  transportadora: null,
  modalidadPago: "contraentrega",
  notas: "Pedido web #1199\n[ENTREGA_WEB:CE|provincia_cod|Puno, Puno, Puno|2026-11-26]",
  numeroGuia: null,
  claveRecojo: null,
  ciudad: "Puno",
  distrito: null,
};

describe("cambiar tipo de entrega", () => {
  it("COD → Shalom: modalidad, transportadora y marca AG; la tarjeta deja de ser AliClik", () => {
    const r = planCambioEntrega(base, "shalom", { ahora });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plan).toMatchObject({ transportadora: "Shalom", modalidadPago: "adelanto_agencia", limpiarGuia: false });
    expect(r.plan.notas).not.toContain("[ENTREGA_WEB:CE");
    expect(r.plan.notas).toContain("[ENTREGA_WEB:AG|manual|Puno|2026-11-26]");
    expect(esContraEntregaAliclik({ ...r.plan })).toBe(false);
  });

  it("COD ya registrado en AliClik: pide confirmar y luego deja la orden como anterior", () => {
    const p = { ...base, notas: `${base.notas}\n[ALICLIK_ORDEN:ERG1] registrado` };
    const sin = planCambioEntrega(p, "shalom", { ahora });
    expect(sin).toMatchObject({ ok: false, confirmar: true });
    const con = planCambioEntrega(p, "shalom", { ahora, confirmado: true });
    expect(con.ok).toBe(true);
    if (!con.ok) return;
    expect(con.plan.notas).toContain("[ALICLIK_ORDEN_ANTERIOR:ERG1]");
    expect(con.plan.notas).not.toMatch(/\[ALICLIK_ORDEN:/);
  });

  it("Shalom → COD en provincia: marca CE provincia_cod y la tarjeta pasa a AliClik", () => {
    const p = { ...base, transportadora: "Shalom", modalidadPago: "adelanto_agencia", notas: "[ENTREGA_WEB:AG|provincia_shalom|Puno|2026-11-25]" };
    const r = planCambioEntrega(p, "cod", { ahora });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plan).toMatchObject({ transportadora: "AliClik", modalidadPago: "contraentrega", limpiarGuia: false });
    expect(r.plan.notas).toBe("[ENTREGA_WEB:CE|provincia_cod|Puno|2026-11-26]");
    expect(esContraEntregaAliclik({ ...r.plan })).toBe(true);
  });

  it("Shalom con guía: pide confirmar y guarda la guía anulada en notas", () => {
    const p = { ...base, transportadora: "Shalom", modalidadPago: "adelanto_agencia", notas: "", numeroGuia: "105410411", claveRecojo: "1234" };
    expect(planCambioEntrega(p, "cod", { ahora })).toMatchObject({ ok: false, confirmar: true });
    const r = planCambioEntrega(p, "cod", { ahora, confirmado: true });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plan.limpiarGuia).toBe(true);
    expect(r.plan.notas).toContain("[GUIA_SHALOM_ANTERIOR:105410411|clave 1234]");
  });

  it("no cambia pedidos entregados ni al mismo tipo", () => {
    expect(planCambioEntrega({ ...base, estado: "entregado" }, "shalom")).toMatchObject({ ok: false });
    expect(planCambioEntrega(base, "cod")).toMatchObject({ ok: false });
    // Provincia COD sin marca (se ve como Shalom en el pipeline): sí se puede marcar como COD.
    expect(planCambioEntrega({ ...base, notas: "" }, "cod", { ahora }).ok).toBe(true);
  });
});
