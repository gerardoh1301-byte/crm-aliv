import { describe, expect, it } from "vitest";
import { resolverMejorImagen, buscarImagenReferencia } from "@/lib/agent/imagenes-referencia";

describe("Selección de Fotos y Blindaje Anti-Cruce de Productos", () => {
  it("encuentra imágenes por clave directa y por alias", () => {
    const nac = buscarImagenReferencia("nac600_frasco");
    expect(nac).toBeDefined();
    expect(nac?.id).toBe("nac600_frasco");

    const termix = buscarImagenReferencia("termix_tobillera");
    expect(termix).toBeDefined();
    expect(termix?.id).toBe("termix_tobillera");
  });

  it("BLINDAJE: Si el contexto habla de NAC600 pero el bot solicitó 'termix_tobillera', corrige a NAC600", () => {
    const res = resolverMejorImagen({
      claveSolicitada: "termix_tobillera",
      motivo: "¡Aquí tienes la foto de nuestro NAC600 + NAD+!",
      textoContexto: "El cliente preguntó por el frasco de NAC600 para el hígado",
      interesProducto: "interes:nac600 interes:termix",
    });

    expect(res.corregida).toBe(true);
    expect(res.imagen.id).toBe("nac600_frasco");
    expect(res.motivoCorreccion).toContain("Cruce detectado");
  });

  it("BLINDAJE: Si se habla de beneficios de NAC600 y se pide Termix, corrige a 'nac600_beneficios'", () => {
    const res = resolverMejorImagen({
      claveSolicitada: "termix_caracteristicas",
      motivo: "Ficha de beneficios e ingredientes de NAC600",
      textoContexto: "¿Cómo se toma el NAC y qué beneficios tiene para la energía?",
    });

    expect(res.corregida).toBe(true);
    expect(res.imagen.id).toBe("nac600_beneficios");
  });

  it("NO DEBE cambiar NAC600 a Termix cuando se ofreció cross-sell de tobillera en el contexto", () => {
    const res = resolverMejorImagen({
      claveSolicitada: "nac600_frasco",
      motivo: "Foto del frasco",
      textoContexto: "¡Excelente, Andrés! Ya tengo registrado tu pedido para la agencia Shalom de Sta Rosa en Sullana. El equipo validará tu comprobante y se encargará de despachar tus 3 frascos de NAC600. Si te interesa complementar tu rutina, te cuento que también tenemos la *Termix Tobillera* a S/79 para calmar los tobillos cansados con calor de grafeno y masaje.",
      interesProducto: "interes:nac600 interes:termix",
    });

    expect(res.imagen.id).toBe("nac600_frasco");
    expect(res.corregida).toBe(false);
  });

  it("BLINDAJE: Si el contexto habla de Tobillera Termix pero el bot solicitó 'nac600_frasco', corrige a Termix", () => {
    const res = resolverMejorImagen({
      claveSolicitada: "nac600_frasco",
      motivo: "¡Aquí tienes la foto de nuestra Tobillera Termix!",
      textoContexto: "Quiero ver cómo es la tobillera térmica para el dolor de tobillo",
      interesProducto: "interes:termix",
    });

    expect(res.corregida).toBe(true);
    expect(res.imagen.id).toBe("termix_tobillera");
  });

  it("SELECCIÓN INTELIGENTE: Pide foto real o desconfía de la compra -> 'termix_foto_real'", () => {
    const res = resolverMejorImagen({
      motivo: "Foto real en mano del producto",
      textoContexto: "¿Tienes fotos reales de la tobillera en vivo? Quiero asegurarme antes de comprar",
    });

    expect(res.imagen.id).toBe("termix_foto_real");
  });

  it("SELECCIÓN INTELIGENTE: Pregunta qué incluye la caja -> 'termix_contenido_caja'", () => {
    const res = resolverMejorImagen({
      motivo: "Contenido de la caja",
      textoContexto: "¿Qué viene dentro de la caja de la tobillera? ¿Incluye el cargador?",
    });

    expect(res.imagen.id).toBe("termix_contenido_caja");
  });

  it("SELECCIÓN INTELIGENTE: Pregunta por precios u ofertas de Termix -> 'termix_promocion'", () => {
    const res = resolverMejorImagen({
      motivo: "Precios y promociones por cantidad",
      textoContexto: "¿Cuánto cuesta la tobillera y qué ofertas tienes por packs?",
    });

    expect(res.imagen.id).toBe("termix_promocion");
  });

  it("SELECCIÓN INTELIGENTE: Datos de pago o adelanto provincia -> 'yape_adelanto'", () => {
    const res = resolverMejorImagen({
      motivo: "Datos oficiales de Yape",
      textoContexto: "Pásame el número de Yape para pagar el adelanto de S/20 para provincia",
    });

    expect(res.imagen.id).toBe("yape_adelanto");
  });

  it("RECURSOS VIDEO: encuentra y despacha video oficial cuando el cliente pide video de NAC600", () => {
    const nacVideo = buscarImagenReferencia("nac600_video");
    expect(nacVideo).toBeDefined();
    expect(nacVideo?.tipo).toBe("video");
    expect(nacVideo?.url).toContain("drive.usercontent.google.com");

    // Cuando el cliente pide 'quiero ver un video' o 'envíame un video del producto'
    const res = resolverMejorImagen({
      claveSolicitada: "nac600_frasco",
      motivo: "Video oficial de NAC600",
      textoContexto: "Quiero ver un video del producto NAC600 + NAD+",
    });

    expect(res.imagen.id).toBe("nac600_video");
    expect(res.imagen.tipo).toBe("video");
  });

  it("RECURSOS VIDEO: despacha video de unboxing cuando el cliente pide video de Tobillera Termix", () => {
    const termixVideo = buscarImagenReferencia("termix_video");
    expect(termixVideo).toBeDefined();
    expect(termixVideo?.tipo).toBe("video");

    const res = resolverMejorImagen({
      claveSolicitada: "termix_tobillera",
      motivo: "Video demostrativo de la tobillera",
      textoContexto: "¿Tienes video de la tobillera en funcionamiento?",
    });

    expect(res.imagen.id).toBe("termix_video");
    expect(res.imagen.tipo).toBe("video");
  });

  it("BLINDAJE VIDEO: Cruce detectado con video -> corrige al video del producto correcto", () => {
    const res = resolverMejorImagen({
      claveSolicitada: "termix_tobillera",
      motivo: "Video del producto",
      textoContexto: "Envíame un video del producto NAC600 para ver las cápsulas",
    });

    expect(res.corregida).toBe(true);
    expect(res.imagen.id).toBe("nac600_video");
    expect(res.imagen.tipo).toBe("video");
  });
});
