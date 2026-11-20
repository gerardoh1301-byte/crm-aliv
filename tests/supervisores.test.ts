import { describe, expect, it, vi } from "vitest";

vi.mock("@/db", () => ({ db: { select: () => { throw new Error("no debe consultar la base"); } } }));
vi.mock("@/lib/channels/deliver", () => ({ deliverMessage: vi.fn() }));

import { avisoEnPausa, esNumeroEntrenador, notificarSupervisoresCritico } from "@/lib/alerts/supervisor-alerts";

describe("lista blanca de supervisores", () => {
  it("reconoce los dos números en cualquier formato", () => {
    expect(esNumeroEntrenador("+51 951 365 418")).toBe(true);
    expect(esNumeroEntrenador("51945226853")).toBe(true);
    expect(esNumeroEntrenador("945226853")).toBe(true);
    expect(esNumeroEntrenador("+51987654321")).toBe(false);
    expect(esNumeroEntrenador(null)).toBe(false);
  });

  it("no avisa a los supervisores sobre sus propios chats de prueba", async () => {
    const r = await notificarSupervisoresCritico({
      tipo: "pedido_chat",
      titulo: "x",
      detalle: "prueba",
      clienteTelefono: "+51951365418",
      conversationId: "conv-sup",
    });
    expect(r).toEqual({ notificados: 0, errores: [] });
  });

  it("los avisos en ráfaga se envían una vez por chat cada 30 minutos", () => {
    const t0 = 1_000_000_000_000;
    expect(avisoEnPausa("bot_sin_respuesta", "conv-1", t0)).toBe(false);
    expect(avisoEnPausa("bot_sin_respuesta", "conv-1", t0 + 5 * 60_000)).toBe(true);
    expect(avisoEnPausa("bot_sin_respuesta", "conv-2", t0 + 5 * 60_000)).toBe(false);
    expect(avisoEnPausa("bot_sin_respuesta", "conv-1", t0 + 31 * 60_000)).toBe(false);
    // Los pedidos nunca se pausan
    expect(avisoEnPausa("pedido_chat", "conv-1", t0)).toBe(false);
    expect(avisoEnPausa("pedido_chat", "conv-1", t0 + 1000)).toBe(false);
  });
});
