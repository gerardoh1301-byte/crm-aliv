import { describe, it, expect } from "vitest";
import { normalizarNombreEtiqueta } from "@/lib/agent/etiquetado";
import { nombresDeTools } from "@/lib/agent/tools";

describe("Capacidad del Bot para analizar y colocar etiquetas", () => {
  it("la tool asignar_etiqueta está registrada y disponible entre las herramientas del agente", () => {
    const tools = nombresDeTools();
    expect(tools).toContain("asignar_etiqueta");
    expect(tools).toContain("agendar_entrega");
    expect(tools).toContain("actualizar_contacto");
  });

  it("normaliza nombres de etiquetas al formato oficial del CRM", () => {
    // Principales (Estado de la conversación)
    expect(normalizarNombreEtiqueta("agendar entrega")).toBe("Agendar entrega");
    expect(normalizarNombreEtiqueta("agendado")).toBe("Agendar entrega");
    expect(normalizarNombreEtiqueta("pendiente adelanto")).toBe("Pendiente de adelanto");
    expect(normalizarNombreEtiqueta("informativo")).toBe("Informativo");
    expect(normalizarNombreEtiqueta("consulta")).toBe("Informativo");
    expect(normalizarNombreEtiqueta("compra exitosa")).toBe("Compra exitosa");
    expect(normalizarNombreEtiqueta("orden en camino")).toBe("Orden en camino");
    expect(normalizarNombreEtiqueta("cancelado")).toBe("Cancelado");

    // Secundarias
    expect(normalizarNombreEtiqueta("adelanto pagado")).toBe("adelanto pagado");
    expect(normalizarNombreEtiqueta("pedido confirmado")).toBe("pedido confirmado");
    expect(normalizarNombreEtiqueta("esperando respuesta")).toBe("esperando respuesta");
    expect(normalizarNombreEtiqueta("en agencia shalom")).toBe("en agencia shalom");
    expect(normalizarNombreEtiqueta("motorizado lima")).toBe("motorizado lima");

    // Interés
    expect(normalizarNombreEtiqueta("interes:nac600")).toBe("interes:nac600");
    expect(normalizarNombreEtiqueta("nac600")).toBe("interes:nac600");
    expect(normalizarNombreEtiqueta("termix")).toBe("interes:termix");
  });
});
