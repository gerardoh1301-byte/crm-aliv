import { describe, expect, it } from "vitest";
import {
  estadoDesdeTextoRastrea,
  leerReporteEstados,
  normalizarFechaShalom,
  textoLlamarClienteAgencia,
} from "@/lib/agencias/estados-externos-shalom";

describe("estados de Shalom leídos en la web", () => {
  it("reconoce los encabezados de Rastrea", () => {
    expect(estadoDesdeTextoRastrea("Envío no confirmado")).toBe("no_confirmado");
    expect(estadoDesdeTextoRastrea("En destino")).toBe("en_destino");
    expect(estadoDesdeTextoRastrea("En tránsito")).toBe("en_transito");
    expect(estadoDesdeTextoRastrea("Demora de envíos")).toBe("demora");
    expect(estadoDesdeTextoRastrea("En origen")).toBe("en_origen");
    expect(estadoDesdeTextoRastrea("Entregado")).toBe("entregado");
    expect(estadoDesdeTextoRastrea("otra cosa")).toBeNull();
  });

  it("normaliza la fecha «Desde el»", () => {
    expect(normalizarFechaShalom("16/11/26 a las 07:00")).toBe("2026-11-16 07:00:00");
    expect(normalizarFechaShalom("Desde el 2/1/26 a las 7:05")).toBe("2026-01-02 07:05:00");
    expect(normalizarFechaShalom("2026-11-22 00:17")).toBe("2026-11-22 00:17:00");
    expect(normalizarFechaShalom("")).toBeNull();
  });

  it("arma el mapa por guía con el formato del barrido", () => {
    const { estados, rechazados } = leerReporteEstados({
      estados: [
        { guia: "104642851", estado: "en_destino", desde: "22/11/26 a las 00:17", agenciaDestino: "Abancay" },
        { guia: "105640899", texto: "Envío no confirmado" },
        { guia: "105637944", estado: "en_transito" },
        { guia: "1", estado: "inventado" },
      ],
    });
    expect(rechazados).toHaveLength(1);
    const destino = estados.get("104642851")!;
    expect(destino.enDestinoListoParaRecojo).toBe(true);
    expect(destino.yaEntregado).toBe(false);
    expect(destino.fechaLlegadaDestino).toBe("2026-11-22 00:17:00");
    expect(destino.agenciaDestino).toBe("Abancay");
    expect(estados.get("105640899")!.confirmadoEnOrigen).toBe(false);
    expect(estados.get("105637944")!.confirmadoEnOrigen).toBe(true);
    expect(estados.get("105637944")!.enDestinoListoParaRecojo).toBe(false);
  });

  it("rechaza un cuerpo sin lista", () => {
    expect(leerReporteEstados({}).estados.size).toBe(0);
  });

  it("el aviso a la vendedora no lleva montos ni guía", () => {
    const t = textoLlamarClienteAgencia({ cliente: "Eberhson", telefono: "+51951161874", numeroOrden: "#1145", agencia: "Abancay", dias: 5 });
    expect(t).toContain("#1145");
    expect(t).toContain("5 días");
    expect(t).not.toMatch(/S\/|guía|clave/i);
  });
});
