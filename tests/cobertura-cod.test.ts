import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  decidirEntrega,
  limpiarCacheCobertura,
  renderBloqueCobertura,
  ubicarEnPunto,
  MARCA_COD_PROVINCIA,
} from "@/lib/aliclik/cobertura-cod";
import { renderGuionVenta } from "@/lib/agent/guion-venta";

/** Respuestas con la forma real de GET /integration/order/shipping/cost. */
function respuestaConCobertura(dep: string, prov: string, dist: string) {
  return new Response(
    JSON.stringify({
      ubigeo: { department: { name: dep }, province: { name: prov }, district: { name: dist } },
      location: { insideDistrict: true, distanceToDistrictKm: 0 },
      couriers: [{ transportId: 1, transportName: "ALIDRIVER", deliveryCost: 16.5, addDays: 3, returnCost: 9.5 }],
    }),
    { status: 200 }
  );
}

function respuestaSinCobertura(dist: string, prov: string, dep: string) {
  return new Response(
    JSON.stringify({
      statusCode: 400,
      message: `Sin cobertura contraentrega en ${dist} (${prov}, ${dep}): departamento ${dep} no tiene contraentrega habilitada`,
    }),
    { status: 400 }
  );
}

const fetchMock = vi.fn();

beforeEach(() => {
  limpiarCacheCobertura();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("ALICLIK_COBERTURA_TOKEN", "token-de-prueba");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("cobertura contra entrega de AliClik", () => {
  it("ciudad de provincia con cobertura: contra entrega sin adelanto", async () => {
    fetchMock.mockResolvedValueOnce(respuestaConCobertura("Arequipa", "Arequipa", "Arequipa"));

    const d = await decidirEntrega({ ciudad: "Arequipa" });

    expect(d.zona).toBe("provincia_cod");
    expect(d.modalidadPago).toBe("contraentrega");
    expect(d.cobertura?.costoEnvio).toBe(16.5);

    // Se consultó a la API con el almacén, un punto y el token.
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/\/integration\/order\/shipping\/cost\?warehouseId=373&lat=-\d+(\.\d+)?&lng=-\d+(\.\d+)?/);
    expect(init.headers.Authorization).toBe("Bearer token-de-prueba");

    const bloque = renderBloqueCobertura(d);
    expect(bloque).toContain(MARCA_COD_PROVINCIA);
    expect(bloque).toMatch(/SIN adelanto de S\/20/);
    expect(bloque).toMatch(/PROHIBIDO pedirle el adelanto/);
  });

  it("ciudad de provincia sin cobertura: Shalom con adelanto de S/ 20", async () => {
    fetchMock.mockResolvedValueOnce(respuestaSinCobertura("TUMBES", "TUMBES", "TUMBES"));

    const d = await decidirEntrega({ ciudad: "Tumbes" });

    expect(d.zona).toBe("provincia_shalom");
    expect(d.modalidadPago).toBe("adelanto_agencia");
    expect(d.cobertura?.estado).toBe("sin_cobertura");
    expect(renderBloqueCobertura(d)).toMatch(/AGENCIA SHALOM/);
    expect(renderBloqueCobertura(d)).not.toContain(MARCA_COD_PROVINCIA);
  });

  it("Lima: contra entrega como siempre, sin llamar a AliClik", async () => {
    const d = await decidirEntrega({ ciudad: "Lima", distrito: "San Juan de Lurigancho" });

    expect(d.zona).toBe("lima");
    expect(d.modalidadPago).toBe("contraentrega");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(renderBloqueCobertura(d)).toBe("");
  });

  it("si AliClik no responde, se queda en el flujo Shalom (nunca promete contra entrega a ciegas)", async () => {
    fetchMock.mockRejectedValueOnce(new Error("timeout"));

    const d = await decidirEntrega({ ciudad: "Piura" });

    expect(d.cobertura?.estado).toBe("desconocido");
    expect(d.modalidadPago).toBe("adelanto_agencia");
  });

  it("sin token configurado no llama a la API y usa Shalom", async () => {
    vi.stubEnv("ALICLIK_COBERTURA_TOKEN", "");

    const d = await decidirEntrega({ ciudad: "Cusco" });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(d.modalidadPago).toBe("adelanto_agencia");
  });

  it("guarda la respuesta en caché: la segunda consulta del mismo lugar no llama a la API", async () => {
    fetchMock.mockResolvedValueOnce(respuestaConCobertura("Puno", "San Roman", "Juliaca"));

    await decidirEntrega({ ciudad: "Juliaca" });
    const d = await decidirEntrega({ ciudad: "Juliaca" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(d.zona).toBe("provincia_cod");
  });

  it("sin ubicación reconocible no decide (el bot pregunta la ciudad)", async () => {
    const d = await decidirEntrega({ direccion: "hola, quiero información" });
    expect(d.zona).toBe("desconocida");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("ubicar el texto del cliente", () => {
  it("con solo la ciudad usa su capital", () => {
    expect(ubicarEnPunto({ ciudad: "Piura" })?.distrito).toBe("piura");
  });

  it("un distrito escrito gana a la capital de su provincia", () => {
    expect(ubicarEnPunto({ direccion: "vivo en Trujillo, La Esperanza" })?.distrito).toBe("la esperanza");
  });

  it("Huacho es provincia aunque sea del departamento de Lima", () => {
    const p = ubicarEnPunto({ ciudad: "Huacho" });
    expect(p?.provincia).toBe("huaura");
  });
});

describe("guion de venta", () => {
  const historial = [
    { role: "assistant" as const, content: "Te cuento: 3 frascos S/199, envío gratis." },
    { role: "user" as const, content: "quiero 3, soy de Arequipa" },
  ];

  it("en provincia con contra entrega pide los datos como en Lima", () => {
    const g = renderGuionVenta({ conversationId: "c1", historial, contraEntregaProvincia: true });
    expect(g.etapa).toBe("datos_lima");
    expect(g.bloque).not.toMatch(/adelanto de S\/20 al Yape/);
  });

  it("en provincia sin contra entrega sigue el flujo Shalom", () => {
    const g = renderGuionVenta({ conversationId: "c1", historial });
    expect(g.etapa).toBe("datos_provincia");
  });
});
