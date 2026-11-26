import { describe, expect, it } from "vitest";
import { corregirPromesaEntregaCod, fechaMinimaCod } from "../src/lib/aliclik/entrega-fecha";

// Miércoles 25/11/2026 22:03 en Lima = miércoles 26/11 03:03 UTC.
const AHORA = new Date("2026-11-26T03:03:00Z");

describe("fechaMinimaCod", () => {
  it("Huaraz (diasExtra 1) pedido el miércoles de noche → viernes 27/11", () => {
    const f = fechaMinimaCod(1, AHORA)!;
    expect(f.diasHabiles).toBe(2);
    expect(f.etiqueta).toBe("viernes 27/11");
    expect(f.despuesDeManana).toBe(true);
  });
  it("salta el domingo", () => {
    // Viernes 27/11/2026 10:00 Lima → +2 hábiles = lunes 30/11.
    expect(fechaMinimaCod(1, new Date("2026-11-27T15:00:00Z"))!.etiqueta).toBe("lunes 30/11");
  });
  it("sin días informados no inventa fecha", () => {
    expect(fechaMinimaCod(undefined, AHORA)).toBeNull();
  });
});

describe("corregirPromesaEntregaCod (#1183 Alfredo, Huaraz)", () => {
  const e = { lugar: "Huaraz", fecha: fechaMinimaCod(1, AHORA)! };
  it("cambia «mañana al mediodía (de 12 a 2)» por la fecha real", () => {
    const reply =
      "¡Perfecto, Alfredo! Tu entrega queda programada para mañana al mediodía (de 12:00 p. m. a 2:00 p. m.) en tu dirección de Huaraz.\n\n" +
      "El pago es contraentrega al recibir por transferencia, Yape o Plin.";
    const r = corregirPromesaEntregaCod(reply, e);
    expect(r.corregido).toBe(true);
    expect(r.texto).not.toMatch(/mañana/i);
    expect(r.texto).not.toMatch(/12:00/);
    expect(r.texto).toContain("viernes 27/11");
    expect(r.texto).toContain("Yape o Plin");
  });
  it("no toca una respuesta que ya da la fecha correcta", () => {
    const reply = "Lo más pronto es el viernes 27/11. ¿Te parece bien?";
    expect(corregirPromesaEntregaCod(reply, e)).toEqual({ texto: reply, corregido: false });
  });
  it("si AliClik entrega al día siguiente, no corrige", () => {
    const rapido = { lugar: "Ica", fecha: fechaMinimaCod(0, AHORA)! };
    const reply = "Te llega mañana en el día.";
    expect(corregirPromesaEntregaCod(reply, rapido).corregido).toBe(false);
  });
});
