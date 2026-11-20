import { describe, expect, it } from "vitest";
import {
  debeAvisarPedidoImportado,
  esNumeroChat,
  formatearNumeroChat,
  mostrarNumeroOrden,
  siguienteNumeroChat,
} from "@/lib/pedidos/numero-formato";

describe("serie CHAT para ventas fuera de Shopify", () => {
  it("empieza en CHAT-0001 y sigue el máximo existente", () => {
    expect(siguienteNumeroChat([])).toBe("CHAT-0001");
    expect(siguienteNumeroChat(["#1148", "#1149", "#LEG-1015"])).toBe("CHAT-0001");
    expect(siguienteNumeroChat(["CHAT-0001", "CHAT-0009", "chat-0003", null])).toBe("CHAT-0010");
    expect(formatearNumeroChat(12345)).toBe("CHAT-12345");
  });

  it("nunca produce un número con forma de Shopify", () => {
    const n = siguienteNumeroChat(["#1148"]);
    expect(n).not.toMatch(/^#?\d+$/);
    expect(esNumeroChat(n)).toBe(true);
    expect(esNumeroChat("#1148")).toBe(false);
  });

  it("muestra el número sin duplicar el #", () => {
    expect(mostrarNumeroOrden("#1148")).toBe("#1148");
    expect(mostrarNumeroOrden("1148")).toBe("#1148");
    expect(mostrarNumeroOrden("CHAT-0001")).toBe("CHAT-0001");
    expect(mostrarNumeroOrden("#LEG-1015")).toBe("#LEG-1015");
    expect(mostrarNumeroOrden(null)).toBe("");
  });
});

describe("mensaje de pedido nuevo al sincronizar con Shopify", () => {
  const ahora = new Date("2026-11-19T20:00:00Z");
  it("avisa solo si el pedido es reciente", () => {
    expect(debeAvisarPedidoImportado("2026-11-19T18:30:00Z", ahora)).toBe(true);
    expect(debeAvisarPedidoImportado("2026-11-19T10:00:00Z", ahora)).toBe(false);
    expect(debeAvisarPedidoImportado(undefined, ahora)).toBe(false);
    expect(debeAvisarPedidoImportado("no es fecha", ahora)).toBe(false);
  });
});
