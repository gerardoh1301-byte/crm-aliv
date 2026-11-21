import { describe, expect, it } from "vitest";
import { decidirEntregaAliclik, elegirOrdenAliclik, type OrdenMin } from "@/lib/aliclik/sync-reglas";

const cod = (deliveryStatus: string, deliveryStatusLabel = "", total = 199): OrdenMin => ({
  orderNumber: "ERG1",
  deliveryStatus,
  deliveryStatusLabel,
  deliveryType: "CASH_ON_DELIVERY",
  total,
});

describe("sincronización de entregas AliClik", () => {
  it("contra entrega entregado -> marcar entregado", () => {
    expect(decidirEntregaAliclik(cod("DELIVERED", "Entregado")).accion).toBe("marcar_entregado");
    expect(decidirEntregaAliclik(cod("ENTREGADO")).accion).toBe("marcar_entregado");
  });

  it("estados que no son entrega no cambian nada", () => {
    for (const [s, l] of [
      ["NOT_DELIVERED", "No entregado"],
      ["REJECTED", "Rechazado"],
      ["RETURNED", "Devuelto"],
      ["PENDING", "Pendiente"],
      ["ON_ROUTE", "En ruta"],
      ["RESCHEDULED", "Reprogramado"],
      ["CANCELED", "Anulado"],
    ]) {
      expect(decidirEntregaAliclik(cod(s, l)).accion).toBe("sin_cambios");
    }
  });

  it("pedido de agencia solo informa (lo sigue Shalom)", () => {
    expect(decidirEntregaAliclik({ ...cod("DELIVERED", "Entregado"), deliveryType: "AGENCY" }).accion).toBe("solo_informar");
  });

  it("sin pedido en AliClik -> no encontrado", () => {
    expect(decidirEntregaAliclik(null).accion).toBe("no_encontrado");
  });

  it("elige el pedido del celular con total parecido y descarta si no cuadra", () => {
    const a = cod("PENDING", "", 119);
    const b = { ...cod("DELIVERED", "Entregado", 199), orderNumber: "ERG2" };
    expect(elegirOrdenAliclik([a, b], 199)?.orderNumber).toBe("ERG2");
    expect(elegirOrdenAliclik([a], 199)).toBeNull();
    expect(elegirOrdenAliclik([], 199)).toBeNull();
  });
});
