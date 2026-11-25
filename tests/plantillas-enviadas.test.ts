import { describe, expect, it } from "vitest";
import { agruparPorDia } from "@/lib/finanzas/plantillas-enviadas";

describe("plantillas enviadas por día", () => {
  it("separa entregadas, fallidas y en ventana, por día de Lima", () => {
    const dias = agruparPorDia([
      { plantilla: "aliv_ultimo_recordatorio", categoria: "MARKETING", estado: "read", enviadoEn: "2026-11-24T15:00:00Z", enVentana: false },
      { plantilla: "aliv_ultimo_recordatorio", categoria: "MARKETING", estado: "failed", enviadoEn: "2026-11-24T16:00:00Z", enVentana: false },
      { plantilla: "aliv_confirmacion_lima", categoria: "utility", estado: "delivered", enviadoEn: "2026-11-24T17:00:00Z", enVentana: true },
      // 23:30 de Lima del 24 = 04:30 UTC del 25
      { plantilla: "aliv_pedido_en_agencia", categoria: null, estado: "sent", enviadoEn: "2026-11-25T04:30:00Z", enVentana: false },
    ]);
    expect(dias).toHaveLength(1);
    expect(dias[0].fecha).toBe("2026-11-24");
    const p = Object.fromEntries(dias[0].plantillas.map((x) => [x.plantilla, x]));
    expect(p.aliv_ultimo_recordatorio).toMatchObject({ entregadas: 1, fallidas: 1 });
    expect(p.aliv_confirmacion_lima).toMatchObject({ categoria: "UTILITY", enVentana: 1 });
    expect(p.aliv_pedido_en_agencia.categoria).toBe("SIN_CATEGORIA");
  });
});
