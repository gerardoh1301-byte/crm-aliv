import { describe, expect, it } from "vitest";
import { aplicarBloques, detectarSenalesPrompt, TODAS_LAS_SENALES } from "@/lib/agent/prompt-bloques";
import { getDefaultSystemPromptTemplate, renderSystemPrompt } from "@/lib/agent/prompt";

const u = (content: string) => ({ role: "user", content });
const a = (content: string) => ({ role: "assistant", content });

describe("bloques condicionales del prompt", () => {
  it("quita solo los bloques apagados y nunca deja marcas", () => {
    const t = "A\n[[si:provincia]]P[[/si:provincia]]\n[[si:venta]]V [[si:termix]]T[[/si:termix]][[/si:venta]]\nZ";
    expect(aplicarBloques(t)).toBe("A\nP\nV T\nZ");
    expect(aplicarBloques(t, { ...TODAS_LAS_SENALES, provincia: false, termix: false })).toBe("A\n\nV \nZ");
    expect(aplicarBloques(t, { ...TODAS_LAS_SENALES, venta: false })).toBe("A\nP\n\nZ");
    expect(aplicarBloques("x [[si:foo]] y")).toBe("x  y");
  });

  it("el template no deja marcas y con todo encendido conserva todas las reglas", () => {
    const todo = renderSystemPrompt(getDefaultSystemPromptTemplate(), { channel: "whatsapp" });
    expect(todo).not.toMatch(/\[\[\/?si:/);
    for (const s of ["# MÉTODO DE VENTA", "AGENCIA SHALOM", "## NAC600", "## Termix", "nac600_video", "termix_video", "yape_adelanto", "# REGLAS QUE NUNCA SE ROMPEN"]) {
      expect(todo, s).toContain(s);
    }
  });

  it("cada chat recibe lo suyo y las reglas de seguridad siempre", () => {
    const t = getDefaultSystemPromptTemplate();
    const limaNac = renderSystemPrompt(t, { channel: "whatsapp", senales: { provincia: false, nac600: true, termix: false, venta: true } });
    expect(limaNac).toContain("## NAC600");
    expect(limaNac).not.toContain("## Termix");
    expect(limaNac).not.toContain('Clave "termix_video"');
    expect(limaNac).not.toContain("# ENVÍOS A PROVINCIA");
    expect(limaNac).toContain("# MÉTODO DE VENTA");
    // Siempre: precios de ambos, salud, DIGESA, cobertura, garantía, prohibiciones.
    for (const s of ["Catálogo:", "*Salud:*", "DIGESA", "COBERTURA Y MODALIDADES", "PLAN DE RESPALDO", "Garantía de 30 días", "POLÍTICA DE GARANTÍA", "Coherencia Absoluta"]) {
      expect(limaNac, s).toContain(s);
    }
    const posventa = renderSystemPrompt(t, { channel: "whatsapp", senales: { provincia: true, nac600: true, termix: false, venta: false } });
    expect(posventa).not.toContain("# MÉTODO DE VENTA");
    expect(posventa).not.toContain("# CÓMO COTIZAR");
    expect(posventa).toContain("CLAVE DE RETIRO");
    expect(posventa).toContain("PEDIDOS WEB Y POSVENTA");
  });
});

describe("señales del chat", () => {
  it("sin datos incluye ambos productos y no provincia", () => {
    expect(detectarSenalesPrompt({ historial: [u("Hola, info")] })).toEqual({ provincia: false, nac600: true, termix: true, venta: true });
  });
  it("producto por anuncio o por lo que se habló", () => {
    expect(detectarSenalesPrompt({ historial: [u("hola")], productoAnuncio: "termix" })).toMatchObject({ nac600: false, termix: true });
    expect(detectarSenalesPrompt({ historial: [u("precio del NAC600?")] })).toMatchObject({ nac600: true, termix: false });
    expect(detectarSenalesPrompt({ historial: [u("precio del NAC600?"), a("..."), u("y la tobillera?")] })).toMatchObject({ nac600: true, termix: true });
  });
  it("provincia por ciudad, palabras del cliente, datos o el bot ya habló de Shalom", () => {
    expect(detectarSenalesPrompt({ historial: [u("soy de Arequipa")] }).provincia).toBe(true);
    expect(detectarSenalesPrompt({ historial: [u("envían a provincia?")] }).provincia).toBe(true);
    expect(detectarSenalesPrompt({ historial: [u("ok")], camposContacto: { departamento_ciudad: "Piura" } }).provincia).toBe(true);
    expect(detectarSenalesPrompt({ historial: [u("ok")], camposContacto: { departamento_ciudad: "Lima" } }).provincia).toBe(false);
    expect(detectarSenalesPrompt({ historial: [u("Chota"), a("Te lo enviamos por agencia Shalom")] }).provincia).toBe(true);
  });
  it("la pregunta del bot '¿Lima o provincia?' no activa provincia", () => {
    expect(detectarSenalesPrompt({ historial: [u("precio"), a("¿Te separo el de 3 para Lima o para provincia?"), u("Los Olivos")] }).provincia).toBe(false);
  });
  it("con pedido reciente no va el método de venta", () => {
    expect(detectarSenalesPrompt({ historial: [u("cuándo llega?")], tienePedidoReciente: true }).venta).toBe(false);
  });
});
