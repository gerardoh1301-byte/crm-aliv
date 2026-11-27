import { describe, expect, it } from "vitest";
import {
  clasificarSinIA,
  linkWhatsapp,
  planPara,
  primerNombre,
  respuestaRespaldo,
  sanearRespuesta,
} from "@/lib/comentarios/reglas";

const WA = linkWhatsapp();

describe("moderador de comentarios: reglas", () => {
  it("el WhatsApp de ventas por defecto es el 977 de Rossana", () => {
    expect(WA).toBe("https://wa.me/51977126462");
  });

  it("clasifica sin IA de forma prudente", () => {
    expect(clasificarSinIA("Hay costo en el envio?")).toBe("interes");
    expect(clasificarSinIA("precio")).toBe("interes");
    expect(clasificarSinIA("Esto es una estafa")).toBe("negativo");
    expect(clasificarSinIA("Pedí hace una semana y no me llegó")).toBe("queja");
    expect(clasificarSinIA("Gana dinero desde casa escríbeme")).toBe("spam");
    expect(clasificarSinIA("mira www.otratienda.com")).toBe("spam");
    expect(clasificarSinIA("Excelente producto, me funcionó")).toBe("positivo");
    expect(clasificarSinIA("😍😍")).toBe("neutro");
    expect(clasificarSinIA("Juan Perez")).toBe("neutro");
  });

  it("queja: oculta y avisa, nunca elimina", () => {
    expect(planPara("queja", false)).toMatchObject({ publico: "ocultar", avisar: true });
  });

  it("negativo se oculta y spam se elimina", () => {
    expect(planPara("negativo", false).publico).toBe("ocultar");
    expect(planPara("spam", false).publico).toBe("eliminar");
  });

  it("interés: responde en público y por privado; dentro de un hilo no contesta", () => {
    expect(planPara("interes", false)).toMatchObject({ publico: "responder", privado: true });
    expect(planPara("interes", true)).toMatchObject({ publico: "ninguna", privado: false });
  });

  it("saneado: quita links inventados, agrega el oficial y frena la política de salud", () => {
    const r = sanearRespuesta("¡Hola Flor! El envío es gratis 😊 escríbenos wa.me/51999999999", WA);
    expect(r).toBe(`¡Hola Flor! El envío es gratis 😊 escríbenos 👉 ${WA}`);
    expect(sanearRespuesta("Te cura el hígado graso", WA)).toBeNull();
    expect(sanearRespuesta("Te procuramos la mejor atención por WhatsApp", WA)).not.toBeNull();
    expect(sanearRespuesta("", WA)).toBeNull();
  });

  it("respaldo con nombre y link oficial", () => {
    const r = respuestaRespaldo("interes", "123_456", "Flor", WA);
    expect(r).toContain("Flor");
    expect(r).toContain(WA);
  });

  it("primer nombre solo si parece nombre", () => {
    expect(primerNombre("FLOR Antonia Otiniano")).toBe("Flor");
    expect(primerNombre("user123")).toBe("");
    expect(primerNombre(null)).toBe("");
  });
});
