import { describe, expect, it, vi } from "vitest";
import { clasificarEntregaWeb, textoClasificacion, MARCA_ENTREGA_WEB } from "@/lib/shopify/clasificar-entrega-web";
import { tipoEnvio } from "@/lib/metricas-operacion";
import type { DecisionEntrega } from "@/lib/aliclik/cobertura-cod";

const decidir = (d: DecisionEntrega) => vi.fn(async () => d);

describe("clasificación AG/CE de pedidos web", () => {
  it("Lima: contra entrega sin consultar a AliClik", async () => {
    const fn = decidir({ zona: "provincia_shalom", modalidadPago: "adelanto_agencia" });
    const c = await clasificarEntregaWeb({ esProvincia: false, ciudad: "Lima", distrito: "SJL" }, fn);
    expect(fn).not.toHaveBeenCalled();
    expect(c).toMatchObject({ modalidadPago: "contraentrega", esAgencia: false });
    expect(c.marca.startsWith(`${MARCA_ENTREGA_WEB}CE|`)).toBe(true);
  });

  it("provincia con cobertura AliClik: contra entrega, sin adelanto", async () => {
    const c = await clasificarEntregaWeb(
      { esProvincia: true, ciudad: "Trujillo", distrito: "La Esperanza" },
      decidir({ zona: "provincia_cod", modalidadPago: "contraentrega", lugar: "La Esperanza, Trujillo, La Libertad" })
    );
    expect(c).toMatchObject({ modalidadPago: "contraentrega", esAgencia: false, zona: "provincia_cod" });
    expect(c.modalidadEntrega).toContain("AliClik");
    expect(textoClasificacion(c)).toContain("sin adelanto");
    expect(tipoEnvio({ modalidad_pago: c.modalidadPago, transportadora: null })).toBe("CE");
  });

  it("provincia sin cobertura: agencia con adelanto (AG en la matriz)", async () => {
    const c = await clasificarEntregaWeb(
      { esProvincia: true, ciudad: "Bambamarca" },
      decidir({ zona: "provincia_shalom", modalidadPago: "adelanto_agencia", lugar: "Bambamarca" })
    );
    expect(c).toMatchObject({ modalidadPago: "adelanto_agencia", esAgencia: true });
    expect(tipoEnvio({ modalidad_pago: c.modalidadPago, transportadora: null })).toBe("AG");
  });

  it("si AliClik falla o no reconoce la ciudad, queda en agencia (lo de siempre)", async () => {
    const falla = vi.fn(async () => {
      throw new Error("timeout");
    });
    expect((await clasificarEntregaWeb({ esProvincia: true, ciudad: "X" }, falla)).esAgencia).toBe(true);
    const nada = await clasificarEntregaWeb({ esProvincia: true, ciudad: "Zzz" }, decidir({ zona: "desconocida", modalidadPago: "contraentrega" }));
    expect(nada).toMatchObject({ esAgencia: true, modalidadPago: "adelanto_agencia" });
  });

  it("si AliClik tarda más del tope, queda en agencia", async () => {
    const lento = vi.fn(() => new Promise<DecisionEntrega>((r) => setTimeout(() => r({ zona: "provincia_cod", modalidadPago: "contraentrega" }), 200)));
    expect((await clasificarEntregaWeb({ esProvincia: true, ciudad: "Piura" }, lento, 20)).esAgencia).toBe(true);
  });

  it("el formulario dijo provincia pero AliClik lo ubica en Lima: contra entrega", async () => {
    const c = await clasificarEntregaWeb({ esProvincia: true, ciudad: "Chosica" }, decidir({ zona: "lima", modalidadPago: "contraentrega", lugar: "Lima" }));
    expect(c.esAgencia).toBe(false);
  });
});
