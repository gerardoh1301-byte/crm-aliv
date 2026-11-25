import { describe, expect, it, vi } from "vitest";

vi.mock("@/db", () => ({ db: {} }));

import { esPedidoAliclik, fechaEntregaAliclik, resumirLiquidaciones } from "@/lib/supervisor/conexiones";
import { botDelChat } from "@/lib/bots";

const fila = (numeroOrden: string, total: number, notas = "", entregado = "2026-11-21", transportadora: string | null = null) => ({
  numeroOrden,
  cliente: "Cliente",
  total,
  transportadora,
  notas,
  entregado,
});

describe("liquidación AliClik para el Bot Asistente", () => {
  it("solo cuenta contra entrega de AliClik (no delivery propio ni motorizado Aliv)", () => {
    expect(esPedidoAliclik(null)).toBe(true);
    expect(esPedidoAliclik("AliClik (COD provincia)")).toBe(true);
    expect(esPedidoAliclik("Delivery propio (inDrive)")).toBe(false);
    expect(esPedidoAliclik("Motorizado Aliv (Lima)")).toBe(false);
  });

  it("toma la fecha de entrega de la marca de la sincronización", () => {
    expect(fechaEntregaAliclik("[ALICLIK_ENTREGADO] 2026-11-21 · liquidación pendiente", null)).toBe("2026-11-21");
    expect(fechaEntregaAliclik("", "2026-11-22T15:00:00Z")).toBe("2026-11-22");
  });

  it("separa pendientes y liquidados con el neto estimado", async () => {
    const t = await resumirLiquidaciones(
      [
        fila("#1160", 119),
        fila("#1161", 189),
        fila("#1150", 199, "[ALICLIK_LIQUIDADO_BCP:182.50|BRUTO:199.00|ENVIO:13.50|FF:3.00|POS:0.00|FECHA:2026-11-20|METODO:EFECTIVO|OP:123]"),
      ],
      null
    );
    expect(t).toContain("AliClik POR LIQUIDAR: 2 pedido(s)");
    expect(t).toContain("Cobrado a clientes: S/ 308.00");
    expect(t).toContain("neto estimado a depositar: S/ 275.00");
    expect(t).toContain("YA LIQUIDADOS: 1 pedido(s), neto depositado S/ 182.50");
  });

  it("filtra por periodo", async () => {
    const t = await resumirLiquidaciones([fila("#1160", 119, "", "2026-11-10"), fila("#1161", 189, "", "2026-11-24")], { desde: "2026-11-20", hasta: "2026-11-25" });
    expect(t).toContain("POR LIQUIDAR (2026-11-20 a 2026-11-25): 1 pedido(s)");
    expect(t).not.toContain("#1160");
  });
});

describe("nombres de los bots", () => {
  it("el chat de un postulante lo atiende el Bot Reclutador", () => {
    expect(botDelChat(["postulante"])).toBe("Bot Reclutador");
    expect(botDelChat(["interes:nac600"])).toBe("Bot Vendedor");
    expect(botDelChat(null)).toBe("Bot Vendedor");
  });
});
