import { describe, expect, it } from "vitest";
import { elegirCuentaBot, esNumeroDeVendedor, vendedorDelNumero, type CuentaWhatsapp } from "@/lib/channels/numeros-reglas";

const bot: CuentaWhatsapp = { id: "a-bot", provider: "zernio", platform: "whatsapp", zernioAccountId: "z-944", status: "active", createdAt: "2026-11-16T17:04:52Z" };
const vendedor: CuentaWhatsapp = { id: "a-vend", provider: "zernio", platform: "whatsapp", zernioAccountId: "z-977", status: "active", createdAt: "2026-11-25T03:00:00Z" };
const cuentas = [vendedor, bot];

describe("varios números de WhatsApp", () => {
  it("el bot es la cuenta configurada o, si no hay, la más antigua", () => {
    expect(elegirCuentaBot(cuentas, null)?.id).toBe("a-bot");
    expect(elegirCuentaBot(cuentas, "z-977")?.id).toBe("a-vend");
    // Configurada pero desconectada: vuelve a la más antigua activa.
    expect(elegirCuentaBot([{ ...vendedor, status: "disconnected" }, bot], "a-vend")?.id).toBe("a-bot");
    expect(elegirCuentaBot([], null)).toBeNull();
  });

  it("solo los WhatsApp que no son del bot cuentan como número de vendedor", () => {
    const b = elegirCuentaBot(cuentas, null);
    expect(esNumeroDeVendedor("a-vend", b, cuentas)).toBe(true);
    expect(esNumeroDeVendedor("a-bot", b, cuentas)).toBe(false);
    expect(esNumeroDeVendedor(null, b, cuentas)).toBe(false);
    expect(esNumeroDeVendedor("otra-cuenta-instagram", b, cuentas)).toBe(false);
    expect(esNumeroDeVendedor("a-vend", null, cuentas)).toBe(false);
  });

  it("el vendedor sale del mapa por id de cuenta o por accountId de Zernio", () => {
    expect(vendedorDelNumero(vendedor, JSON.stringify({ "z-977": "m-stephano" }))).toBe("m-stephano");
    expect(vendedorDelNumero(vendedor, JSON.stringify({ "a-vend": "m-1" }))).toBe("m-1");
    expect(vendedorDelNumero(vendedor, "no es json")).toBeNull();
    expect(vendedorDelNumero(vendedor, null)).toBeNull();
    expect(vendedorDelNumero(bot, JSON.stringify({ "z-977": "m-stephano" }))).toBeNull();
  });
});
