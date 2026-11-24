import { describe, expect, it, vi } from "vitest";

vi.mock("@/db", () => ({ db: {} }));
vi.mock("@/lib/supervisor/comandos", () => ({ pedidoParaHerramienta: vi.fn() }));

import { coincideEstado, esHerramientaLecturaAliclik, rangoFechas } from "@/lib/supervisor/conexiones";
import { HERRAMIENTAS, promptAsistente } from "@/lib/supervisor/asistente";

describe("conexiones del asistente", () => {
  // 24/11/2026 11:04 en Lima = 16:04 UTC
  const base = new Date("2026-11-24T16:04:00Z");

  it("«ayer» en Lima es el día anterior completo", () => {
    expect(rangoFechas({ periodo: "ayer" }, base)).toEqual({ desde: "2026-11-23", hasta: "2026-11-23" });
    expect(rangoFechas({ periodo: "semana" }, base)).toEqual({ desde: "2026-11-18", hasta: "2026-11-24" });
    expect(rangoFechas({ desde: "2026-11-01", hasta: "2026-11-10" }, base)).toEqual({ desde: "2026-11-01", hasta: "2026-11-10" });
  });

  it("solo ejecuta herramientas de lectura de AliClik", () => {
    for (const n of ["search_orders", "get_order", "summarize_orders", "query_orders"]) expect(esHerramientaLecturaAliclik(n)).toBe(true);
    for (const n of ["create_order", "update_order", "cancel_order", "delete_order"]) expect(esHerramientaLecturaAliclik(n)).toBe(false);
  });

  it("«entregado» no confunde «no entregado»", () => {
    expect(coincideEstado({ deliveryStatus: "DELIVERED", deliveryStatusLabel: "Entregado" }, "entregado")).toBe(true);
    expect(coincideEstado({ deliveryStatusLabel: "No entregado" }, "entregado")).toBe(false);
    expect(coincideEstado({ deliveryStatusLabel: "Por entregar" }, "entregado")).toBe(false);
    expect(coincideEstado({ deliveryStatusLabel: "Rechazado" }, "rechazado")).toBe(true);
  });

  it("el agente tiene las herramientas de AliClik, Shalom y ERP", () => {
    const nombres = HERRAMIENTAS.map((h) => h.function.name);
    for (const n of ["aliclik_pedidos", "aliclik_orden", "aliclik_consulta", "sincronizar_aliclik", "rastreo_shalom", "agencias_shalom", "resumen_erp", "chat_por_cliente"]) {
      expect(nombres).toContain(n);
    }
    const p = promptAsistente(base);
    expect(p).toContain("AGENTE");
    expect(p).toContain("2026-11-23");
    expect(p).not.toContain("sugiere hacerlo desde el CRM o la computadora");
  });
});
