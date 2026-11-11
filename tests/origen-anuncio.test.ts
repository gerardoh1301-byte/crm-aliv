import { describe, expect, it } from "vitest";
import { esSaludoAutomatico, productoDelAnuncio, renderOrigenAnuncio } from "@/lib/agent/origen-anuncio";

// Datos reales del chat del 11/11/2026 que llego del anuncio "Tu mama nunca se queja".
const anuncioTermix = {
  ctwa_headline: "Tu mamá nunca se queja",
  ctwa_body:
    "Tu mamá nunca se queja de sus pies… pero llega con los tobillos cansados cada noche. 🎄 Esta Navidad regálale Termix: calor hasta 60 °C + masaje por vibración",
  ctwa_source_id: "120250741302030789",
  ctwa_source_type: "ad",
};
const saludo = "¡Hola! 👋 Bienvenido a *Aliv Perú* 💚\nTecnología y naturaleza para sentirte mejor.";

describe("esSaludoAutomatico", () => {
  it("descarta el saludo de WhatsApp Business (saliente sin origin)", () => {
    expect(esSaludoAutomatico("out", null, saludo)).toBe(true);
  });
  it("no descarta respuestas del agente ni de un humano del CRM", () => {
    expect(esSaludoAutomatico("out", "agent", saludo)).toBe(false);
    expect(esSaludoAutomatico("out", "human", "Hola, te cuento sobre la Termix")).toBe(false);
  });
  it("no descarta otros salientes sin origin ni entrantes", () => {
    expect(esSaludoAutomatico("out", null, "Ya te enviamos la guía de Shalom")).toBe(false);
    expect(esSaludoAutomatico("in", null, saludo)).toBe(false);
  });
});

describe("productoDelAnuncio", () => {
  it("reconoce la Termix aunque el titular no la nombre", () => {
    expect(productoDelAnuncio(anuncioTermix)).toBe("termix");
  });
  it("reconoce NAC600", () => {
    expect(productoDelAnuncio({ ctwa_headline: "NAC600 + NAD+ para tu energía" })).toBe("nac600");
  });
  it("null sin metadata de anuncio", () => {
    expect(productoDelAnuncio(null)).toBeNull();
    expect(productoDelAnuncio({})).toBeNull();
  });
});

describe("renderOrigenAnuncio", () => {
  it("en la primera respuesta pide la info puntual de Termix sin preguntar el producto", () => {
    const b = renderOrigenAnuncio(anuncioTermix, false);
    expect(b).toContain("Producto del anuncio: Termix Tobillera");
    expect(b).toContain("NO le preguntes que producto");
    expect(b).toContain("S/99");
    expect(b).toContain("S/169");
    expect(b).toContain("S/219");
    expect(b).toContain("https://alivstore.shop/products/termix-tobillera");
  });
  it("cuando el agente ya respondio, queda solo como contexto", () => {
    const b = renderOrigenAnuncio(anuncioTermix, true);
    expect(b).toContain("Producto del anuncio: Termix Tobillera");
    expect(b).not.toContain("PRIMERA respuesta");
  });
  it("vacio si el chat no vino de un anuncio", () => {
    expect(renderOrigenAnuncio(null, false)).toBe("");
    expect(renderOrigenAnuncio({ ctwa_clid: "x" }, false)).toBe("");
  });
});
