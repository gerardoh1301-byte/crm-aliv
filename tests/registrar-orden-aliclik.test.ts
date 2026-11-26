import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  coordenadasDeTexto,
  cotizarEnvio,
  crearOrdenAliclik,
  elegirCourier,
  geocodificarDireccion,
  ordenAliclikRegistrada,
  pedidoParaRegistroAliclik,
  productosParaAliclik,
  referenciaCercana,
  referenciaDeTexto,
  nombreParaAliclik,
  separarNombre,
  separarReferencia,
  telefonoAliclik,
} from "@/lib/aliclik/registrar-orden";
import { textoUbicacion } from "@/lib/channels/ubicacion";

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("ALICLIK_COBERTURA_TOKEN", "token-de-prueba");
  vi.stubEnv("GOOGLE_MAPS_API_KEY", "clave-maps-prueba");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("orden del supervisor", () => {
  it("reconoce «registra 1171 en aliclik» y variantes", () => {
    expect(pedidoParaRegistroAliclik("registra 1171 en aliclik")).toBe("1171");
    expect(pedidoParaRegistroAliclik("Sube el #1171 a AliClik")).toBe("1171");
    expect(pedidoParaRegistroAliclik("crear orden aliclik LEG-1066")).toBe("LEG-1066");
    expect(pedidoParaRegistroAliclik("regístralo en aliclik 942843548")).toBe("942843548");
  });

  it("entiende el pedido escrito con sus palabras (caso Gerardo 23/11)", () => {
    expect(
      pedidoParaRegistroAliclik(
        "el pedido de Juan Carlos Rodriguez (#1171) es Contra entrega y en Lima, puedes programar su entrega en aliclik?"
      )
    ).toBe("1171");
    expect(pedidoParaRegistroAliclik("agenda en aliclik el 1171 por favor")).toBe("1171");
  });

  it("una pregunta o un mensaje sin AliClik no es la orden", () => {
    expect(pedidoParaRegistroAliclik("¿se registró el 1171 en aliclik?")).toBeNull();
    expect(pedidoParaRegistroAliclik("¿ya está registrado el 1171 en aliclik?")).toBeNull();
    expect(pedidoParaRegistroAliclik("registra 1171")).toBeNull();
    expect(pedidoParaRegistroAliclik("pasa 1140 a confirmado")).toBeNull();
  });
});

describe("datos del pedido para AliClik", () => {
  it("lee las coordenadas de la ubicación que guardó el CRM", () => {
    const texto = textoUbicacion({ latitud: -11.8601, longitud: -77.0712 });
    expect(coordenadasDeTexto(texto)).toEqual({ lat: -11.8601, lng: -77.0712 });
    expect(coordenadasDeTexto("https://maps.google.com/?q=-12.0805,-76.9412")).toEqual({ lat: -12.0805, lng: -76.9412 });
    expect(coordenadasDeTexto("hola, vivo en Carabayllo")).toBeNull();
    // Fuera de Perú no vale.
    expect(coordenadasDeTexto("lat 40.4168, lng -3.7038")).toBeNull();
  });

  it("separa la referencia de la dirección", () => {
    expect(separarReferencia("Rinconada del Lago 1649 (Ref: esquina Jr Cusco)")).toEqual({
      direccion: "Rinconada del Lago 1649",
      referencia: "esquina Jr Cusco",
    });
    expect(separarReferencia("Calle San Martín Mz X Lt 28")).toEqual({ direccion: "Calle San Martín Mz X Lt 28", referencia: "" });
  });

  it("celular con 51 y nombre en nombre y apellido", () => {
    expect(telefonoAliclik("+51 942 843 548")).toBe("51942843548");
    expect(telefonoAliclik("942843548")).toBe("51942843548");
    expect(telefonoAliclik("01 4567890")).toBeNull();
    expect(separarNombre("Juan Pérez Soto")).toEqual({ name: "Juan", lastName: "Pérez Soto" });
    expect(separarNombre("Juan")).toEqual({ name: "Juan", lastName: "" });
    expect(nombreParaAliclik("  Juan  Carlos Rodriguez ")).toBe("Juan Carlos Rodriguez");
  });

  it("usa el EAN de AliClik y reparte el total del pack", () => {
    const r = productosParaAliclik([{ sku: "", titulo: "NAC600 + NAD+", cantidad: 3, precioUnitario: 119 }], 199);
    // Precio exacto (66,3333…): AliClik no suma `delivery`, así que el céntimo no se puede
    // compensar con envío (26/11, #1188 salió S/ 198,99).
    expect(r.productos[0]).toMatchObject({ ean: "1400091740516", sku: "SABC1", quantity: 3 });
    expect(r.productos[0].price).toBeCloseTo(199 / 3, 6);
    expect(r.cobrar).toBe(199);

    const dos = productosParaAliclik([{ sku: "", titulo: "NAC600", cantidad: 2, precioUnitario: 119 }], 189);
    expect(dos.productos[0].price).toBe(94.5);
    expect(dos.cobrar).toBe(189);

    const t = productosParaAliclik([{ sku: "", titulo: "Termix Tobillera", cantidad: 1, precioUnitario: 79 }], 79);
    expect(t.productos[0]).toMatchObject({ ean: "1400035195600", price: 79 });
    expect(t.cobrar).toBe(79);
  });

  it("NAC600 + Termix: el total se reparte entre los dos y suma lo mismo", () => {
    const r = productosParaAliclik(
      [
        { sku: "", titulo: "NAC600", cantidad: 1, precioUnitario: 119 },
        { sku: "", titulo: "Termix", cantidad: 1, precioUnitario: 59 },
      ],
      178
    );
    expect(r.productos.map((p) => p.price)).toEqual([119, 59]);
    expect(r.cobrar).toBe(178);
  });

  it("un producto que no está en AliClik se avisa", () => {
    const r = productosParaAliclik([{ sku: "", titulo: "Melena de León", cantidad: 1, precioUnitario: 89 }], 89);
    expect(r.productos).toHaveLength(0);
    expect(r.desconocidos).toEqual(["Melena de León"]);
  });

  it("elige el courier estándar más barato", () => {
    const c = elegirCourier([
      { transportId: 15, deliveryCost: 9, returnCost: 6, addDays: 0, flagDeliveryExpress: true, scheduleExpressStart: "00:00", scheduleExpressEnd: "11:30" },
      { transportId: 1, transportName: "ALIDRIVER", deliveryCost: 16.5, returnCost: 9.5, addDays: 3, schedule: "23:59" },
      { transportId: 2, deliveryCost: 12, returnCost: 7, addDays: 1 },
    ]);
    expect(c).toMatchObject({ transportId: 2, deliveryCost: 12, flagDeliveryExpress: false });
  });

  it("detecta un pedido ya registrado", () => {
    expect(ordenAliclikRegistrada("algo\n[ALICLIK_ORDEN:ALC000123456789] registrado")).toBe("ALC000123456789");
    expect(ordenAliclikRegistrada("sin registrar")).toBeNull();
  });
});

describe("llamadas a AliClik y Google", () => {
  it("cotiza el envío con el almacén y el token", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          ubigeo: { district: { name: "CARABAYLLO" }, province: { name: "LIMA" } },
          couriers: [{ transportId: 1, transportName: "ALIDRIVER", deliveryCost: 10, returnCost: 5, addDays: 1 }],
        }),
        { status: 200 }
      )
    );
    const r = await cotizarEnvio(-11.86, -77.07);
    expect(r).toMatchObject({ ok: true, distrito: "CARABAYLLO, LIMA", courier: { transportId: 1, deliveryCost: 10 } });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/integration/order/shipping/cost?warehouseId=373&lat=-11.86&lng=-77.07");
    expect(init.headers.Authorization).toBe("Bearer token-de-prueba");
  });

  it("crea la orden y devuelve el número de AliClik", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ message: "Orden creada correctamente", orderNumber: "ALC000123456789" }), { status: 201 }));
    const orden = {
      channel: "WHATSAPP",
      delivery: 0,
      customer: { name: "Juan", phone: "51942843548" },
      shipping: { address1: "Calle San Martín Mz X Lt 28", lat: "-11.860100", lng: "-77.071200" },
      products: [{ ean: "1400091740516", sku: "SABC1", quantity: 1, price: 119 }],
      courier: { transportId: 1, deliveryCost: 10, returnCost: 5, addDays: 1, schedule: null, scheduleExpressStart: null, scheduleExpressEnd: null, flagDeliveryExpress: false },
    };
    const r = await crearOrdenAliclik(orden);
    expect(r).toEqual({ ok: true, orderNumber: "ALC000123456789" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/\/integration\/order$/);
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toMatchObject({ delivery: 0, products: [{ ean: "1400091740516", quantity: 1, price: 119 }] });
  });

  it("si AliClik rechaza, devuelve su mensaje", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ statusCode: 401, message: "Token inválido o expirado" }), { status: 401 }));
    const r = await cotizarEnvio(-11.86, -77.07);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/Token inválido.*ALICLIK_COBERTURA_TOKEN/);
  });

  it("sin token no llama a AliClik", async () => {
    vi.stubEnv("ALICLIK_COBERTURA_TOKEN", "");
    const r = await cotizarEnvio(-11.86, -77.07);
    expect(r.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("Google Maps convierte la dirección en coordenadas de Perú", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          status: "OK",
          results: [{ formatted_address: "Rinconada del Lago 1649, La Molina", geometry: { location: { lat: -12.0805, lng: -76.9412 }, location_type: "ROOFTOP" } }],
        }),
        { status: 200 }
      )
    );
    const r = await geocodificarDireccion({ direccion: "Rinconada del Lago 1649", distrito: "La Molina" });
    expect(r).toMatchObject({ ok: true, coordenadas: { lat: -12.0805, lng: -76.9412, fuente: "google_maps", precision: "ROOFTOP" } });
    expect(String(fetchMock.mock.calls[0][0])).toContain("components=country:PE");
  });

  it("sin clave de Google no intenta convertir la dirección", async () => {
    vi.stubEnv("GOOGLE_MAPS_API_KEY", "");
    const r = await geocodificarDireccion({ direccion: "Rinconada del Lago 1649" });
    expect(r).toEqual({ ok: false, error: "falta GOOGLE_MAPS_API_KEY" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("referencia para AliClik", () => {
  it("saca la referencia que el cliente escribió en el chat", () => {
    expect(referenciaDeTexto("Referencia: frente al parque Lucyana")).toBe("frente al parque Lucyana");
    expect(referenciaDeTexto("vivo al costado de la bodega Don Pepe")).toBe("al costado de la bodega Don Pepe");
    expect(referenciaDeTexto("ref. espalda del colegio 2045")).toBe("espalda del colegio 2045");
    expect(referenciaDeTexto("hola quiero 2 frascos")).toBe("");
    expect(referenciaDeTexto("https://maps.google.com/?q=-11.8,-77.0")).toBe("");
  });

  it("usa un lugar cercano de Places cuando está habilitado", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          places: [
            { displayName: { text: "Calle San Martín" }, primaryType: "route", location: { latitude: -11.8929, longitude: -77.0309 } },
            { displayName: { text: "Parque Lucyana" }, primaryType: "park", location: { latitude: -11.8935, longitude: -77.0309 } },
            { displayName: { text: "Bodega Don Pepe" }, primaryType: "store", location: { latitude: -11.8929, longitude: -77.0315 } },
          ],
        }),
        { status: 200 }
      )
    );
    const r = await referenciaCercana(-11.89286, -77.030931);
    expect(r?.origen).toBe("places");
    expect(r?.referencia).toMatch(/^Cerca de Parque Lucyana \(a ~\d+ m\) y Bodega Don Pepe/);
  });

  it("sin Places, usa el paradero del Geocoding (caso Juan #1171)", async () => {
    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 403 }));
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          status: "OK",
          results: [
            {
              types: ["establishment", "point_of_interest"],
              address_components: [{ long_name: "203" }],
              geometry: { location: { lat: -11.8925, lng: -77.0305 } },
            },
            {
              types: ["establishment", "point_of_interest", "transit_station"],
              address_components: [{ long_name: "José Carlos Mariátegui" }],
              geometry: { location: { lat: -11.8917, lng: -77.0312 } },
            },
          ],
        }),
        { status: 200 }
      )
    );
    const r = await referenciaCercana(-11.89286, -77.030931);
    expect(r).toEqual({ referencia: "Cerca del paradero José Carlos Mariátegui (a ~130 m)", origen: "geocoding" });
  });

  it("si Google no da nada, no inventa", async () => {
    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 403 }));
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ status: "ZERO_RESULTS", results: [] }), { status: 200 }));
    expect(await referenciaCercana(-11.89286, -77.030931)).toBeNull();
  });
});

describe("traducción de la IA", () => {
  it("la orden de AliClik que devuelve la IA se acepta (con número o con nombre)", async () => {
    const { normalizarTraduccion } = await import("@/lib/supervisor/traduccion");
    expect(normalizarTraduccion({ tipo: "orden", orden: "registra 1171 en aliclik", descripcion: "programar entrega" })).toEqual({
      tipo: "aliclik",
      orden: "registra 1171 en aliclik",
      pedido: "1171",
      descripcion: "programar entrega",
    });
    expect(normalizarTraduccion({ tipo: "orden", orden: "registra juan carlos rodriguez en aliclik", descripcion: "" })).toMatchObject({
      tipo: "aliclik",
      pedido: "juan carlos rodriguez",
    });
  });
});
