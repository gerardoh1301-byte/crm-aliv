import { describe, expect, it, vi } from "vitest";
import { etiquetaRetrocede, quitarLogisticaSiCierra } from "@/lib/tags";

vi.mock("@/db", () => ({ db: {} }));
vi.mock("@/lib/channels/deliver", () => ({ deliverMessage: vi.fn() }));
vi.mock("@/lib/pipeline/sincronizar", () => ({ sincronizarPipelinePostventa: vi.fn() }));

describe("etiquetas de logística al cerrar el pedido", () => {
  const tags = ["interes:nac600", "en agencia shalom", "esperando respuesta", "shopify", "Orden en camino"];
  it("se quitan al pasar a Compra exitosa o Cancelado", () => {
    expect(quitarLogisticaSiCierra(tags, "Compra exitosa")).toEqual(["interes:nac600", "shopify", "Orden en camino"]);
    expect(quitarLogisticaSiCierra(tags, "Cancelado")).not.toContain("en agencia shalom");
  });
  it("se conservan mientras el pedido sigue en curso", () => {
    expect(quitarLogisticaSiCierra(tags, "Orden en camino")).toEqual(tags);
  });
});

describe("el bot no baja la etiqueta por debajo de la etapa", () => {
  it("bloquea retrocesos", () => {
    expect(etiquetaRetrocede("Informativo", "Agendar entrega")).toBe(true);
    expect(etiquetaRetrocede("Informativo", "Compra exitosa")).toBe(true);
    expect(etiquetaRetrocede("Agendar entrega", "Orden en camino")).toBe(true);
    expect(etiquetaRetrocede("Cancelado", "Compra exitosa")).toBe(true);
  });
  it("permite avanzar, igualar y los casos válidos", () => {
    expect(etiquetaRetrocede("Orden en camino", "Agendar entrega")).toBe(false);
    expect(etiquetaRetrocede("Pendiente de adelanto", "Agendar entrega")).toBe(false);
    expect(etiquetaRetrocede("Cancelado", "Agendar entrega")).toBe(false);
    expect(etiquetaRetrocede("Informativo", null)).toBe(false);
  });
});

describe("posventa", async () => {
  const { posventaEnEspera, tituloBasePostventa, POSVENTA_MAX_INTENTOS } = await import("@/lib/postventa/engine");
  it("no repite el prefijo Postventa", () => {
    expect(tituloBasePostventa("Postventa · Postventa · #1070 · 2x NAC600")).toBe("#1070 · 2x NAC600");
    expect(tituloBasePostventa("#1054 · 3x NAC600")).toBe("#1054 · 3x NAC600");
  });
  it("tras un fallo espera 6 h y se rinde a los 3 intentos", () => {
    const ahora = new Date("2026-11-20T15:00:00Z");
    expect(posventaEnEspera({ fechaEntrega: "x" }, ahora)).toBe(false);
    expect(posventaEnEspera({ fechaEntrega: "x", intentosFallidos: 1, ultimoIntentoFallido: "2026-11-20T12:00:00Z" }, ahora)).toBe(true);
    expect(posventaEnEspera({ fechaEntrega: "x", intentosFallidos: 1, ultimoIntentoFallido: "2026-11-20T08:00:00Z" }, ahora)).toBe(false);
    expect(posventaEnEspera({ fechaEntrega: "x", intentosFallidos: POSVENTA_MAX_INTENTOS }, ahora)).toBe(true);
  });
});
