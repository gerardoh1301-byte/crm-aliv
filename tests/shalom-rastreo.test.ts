import { describe, it, expect } from "vitest";
import { consultarEstadoShalom } from "@/lib/agencias/shalom-rastreo";

describe("Rastreo en vivo de envíos Shalom", () => {
  it("valida que requiera número de guía y código de orden", async () => {
    const res = await consultarEstadoShalom("", "");
    expect(res.ok).toBe(false);
    expect(res.estadoGeneral).toBe("error");
  });

  it("detecta respuesta de guía no encontrada", async () => {
    const res = await consultarEstadoShalom("000000000", "XXXX");
    expect(res.ok).toBe(false);
    expect(res.estadoGeneral).toBe("no_encontrado");
  });

  it("consulta con éxito un envío real en destino y detecta agencia y estado de recojo", async () => {
    const res = await consultarEstadoShalom("103612112", "NPDT");
    expect(res.ok).toBe(true);
    expect(["en_destino", "entregado"]).toContain(res.estadoGeneral);
    expect(res.agenciaDestino).toContain("PUMACAHUA");
    expect(res.ciudadDestino).toContain("AREQUIPA");
    expect(res.guia?.destinatario?.nombre).toContain("VICTOR");
  });
});
