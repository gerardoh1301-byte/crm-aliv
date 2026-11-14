import { describe, it, expect } from "vitest";
import {
  obtenerEtiquetaDeEtapa,
  esEtiquetaDeEtapa,
  ETIQUETAS_PRINCIPALES,
  ETIQUETAS_DE_ETAPA,
} from "@/lib/tags";

describe("Sincronización de etiquetas con etapas del Pipeline", () => {
  it("mapea etapas a las etiquetas principales correspondientes", () => {
    // 1. Ganada / Entregado
    expect(obtenerEtiquetaDeEtapa({ key: "entregado", name: "Entregado y Cobrado", isWon: true })).toBe("Compra exitosa");
    expect(obtenerEtiquetaDeEtapa({ name: "Entregado y Cobrado" })).toBe("Compra exitosa");
    expect(obtenerEtiquetaDeEtapa({ name: "Cualquier Ganada", isWon: true })).toBe("Compra exitosa");

    // 2. En camino / Despachado
    expect(obtenerEtiquetaDeEtapa({ key: "en_reparto", name: "En camino / Despachado" })).toBe("Orden en camino");
    expect(obtenerEtiquetaDeEtapa({ name: "Despachado a agencia" })).toBe("Orden en camino");
    expect(obtenerEtiquetaDeEtapa({ name: "En reparto motorizado" })).toBe("Orden en camino");

    // 3. Agendar entrega / Pedido confirmado
    expect(obtenerEtiquetaDeEtapa({ key: "agendar_entrega", name: "Agendar entrega" })).toBe("Agendar entrega");
    expect(obtenerEtiquetaDeEtapa({ key: "pedido_confirmado", name: "Pedido confirmado" })).toBe("Agendar entrega");
    expect(obtenerEtiquetaDeEtapa({ name: "Pedido confirmado" })).toBe("Agendar entrega");
    expect(obtenerEtiquetaDeEtapa({ name: "Agendar entrega" })).toBe("Agendar entrega");

    // 4. Por confirmar COD
    expect(obtenerEtiquetaDeEtapa({ key: "por_confirmar_cod", name: "Por confirmar COD" })).toBe("Pendiente de adelanto");
    expect(obtenerEtiquetaDeEtapa({ name: "Por confirmar COD" })).toBe("Pendiente de adelanto");
    expect(obtenerEtiquetaDeEtapa({ name: "Adelanto pendiente" })).toBe("Pendiente de adelanto");

    // 5. Consulta de producto / Intención de compra / Catálogo
    expect(obtenerEtiquetaDeEtapa({ key: "consulta_catalogo", name: "Consulta de producto" })).toBe("Informativo");
    expect(obtenerEtiquetaDeEtapa({ key: "carrito_armado", name: "Intencion de compra" })).toBe("Informativo");

    // 6. Cancelado / Rechazado / Perdida
    expect(obtenerEtiquetaDeEtapa({ key: "cancelado_rechazado", name: "Cancelado / Rechazado", isLost: true })).toBe("Cancelado");
    expect(obtenerEtiquetaDeEtapa({ name: "Cancelado" })).toBe("Cancelado");
    expect(obtenerEtiquetaDeEtapa({ name: "Cualquier Perdida", isLost: true })).toBe("Cancelado");
  });

  it("reconoce etiquetas de etapa y preserva etiquetas personalizadas", () => {
    expect(esEtiquetaDeEtapa("Compra exitosa")).toBe(true);
    expect(esEtiquetaDeEtapa("compra exitosa")).toBe(true);
    expect(esEtiquetaDeEtapa("Orden en camino")).toBe(true);
    expect(esEtiquetaDeEtapa("Pendiente de adelanto")).toBe(true);
    expect(esEtiquetaDeEtapa("adelanto pagado")).toBe(true);
    expect(esEtiquetaDeEtapa("Agendar entrega")).toBe(true);
    expect(esEtiquetaDeEtapa("Informativo")).toBe(true);
    expect(esEtiquetaDeEtapa("Cancelado")).toBe(true);

    // Etiquetas que NO son de etapa deben ser preservadas
    expect(esEtiquetaDeEtapa("vip")).toBe(false);
    expect(esEtiquetaDeEtapa("cliente frecuente")).toBe(false);
    expect(esEtiquetaDeEtapa("lima-norte")).toBe(false);
  });

  it("reemplaza correctamente la etiqueta previa de etapa sin perder tags personalizados", () => {
    const tagsIniciales = ["vip", "Informativo", "prioritario"];
    const nuevaEtapa = { key: "en_reparto", name: "En camino / Despachado" };
    const nuevaEtiqueta = obtenerEtiquetaDeEtapa(nuevaEtapa)!;

    const filtrados = tagsIniciales.filter((t) => !esEtiquetaDeEtapa(t));
    const resultado = [...filtrados, nuevaEtiqueta];

    expect(resultado).toEqual(["vip", "prioritario", "Orden en camino"]);
  });
});
