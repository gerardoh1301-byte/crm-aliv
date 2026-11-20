import { describe, expect, it } from "vitest";
import { esCambioDeDestino } from "@/lib/agencias/shalom-rastreo";
import { interpretarComando } from "@/lib/supervisor/parser";

describe("cambio de destino en Shalom", () => {
  it("una guía cerrada a «CAMBIO DE DESTINO» no es una entrega", () => {
    // Respuesta real de /rastrea/estados para la guía 104169133 (#LEG-1066), 20/11.
    expect(
      esCambioDeDestino({
        destino: { fecha: "2026-11-20 07:32:01", completo: true },
        entregado: { fecha: "2026-11-20 09:13:06", completo: false, cliente: { documento: "53535353", nombre: "CAMBIO DE DESTINO" } },
      })
    ).toBe(true);
  });
  it("una entrega real sí cuenta", () => {
    expect(
      esCambioDeDestino({ entregado: { fecha: "2026-11-20 10:00:00", completo: true, cliente: { documento: "42621635", nombre: "WILSON FLORES" } } })
    ).toBe(false);
  });
});

describe("orden «guia» del supervisor", () => {
  it("separa pedido, número de orden Shalom y código", () => {
    const c = interpretarComando("guia LEG-1066 104170001 T7JT")!;
    expect(c.tipo).toBe("guia");
    expect(c.guia).toBe("104170001");
    expect(c.codigo).toBe("T7JT");
    expect(c.numeros.map((t) => t.texto)).toEqual(["LEG-1066"]);
  });
  it("sin número de pedido usa la última alerta", () => {
    const c = interpretarComando("Guía 104170001 3kjp")!;
    expect(c.guia).toBe("104170001");
    expect(c.codigo).toBe("3KJP");
    expect(c.numeros).toEqual([]);
  });
});
