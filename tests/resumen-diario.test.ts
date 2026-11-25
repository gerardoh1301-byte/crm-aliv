import { describe, expect, it } from "vitest";
import {
  horaLima,
  tocaResumen,
  textoResumenAdmin,
  textoResumenVendedor,
  MAX_POR_SECCION,
  type Pendiente,
} from "@/lib/resumen-diario/formato";
import { SUPERVISORES, destinatariosAviso } from "@/lib/alerts/perfiles-supervisor";

const ahora = new Date("2026-11-26T03:05:00Z"); // 22:05 en Lima
const p = (o: Partial<Pendiente>): Pendiente => ({
  tipo: "esperando",
  conversationId: "c1",
  ownerId: "m-lourdes",
  nombre: "Ana",
  telefono: "+51987654321",
  detalle: "¿Cuánto cuesta?",
  desde: new Date(ahora.getTime() - 90 * 60_000),
  ...o,
});

describe("resumen diario de pendientes", () => {
  it("sale desde las 22:00 de Lima", () => {
    expect(horaLima(ahora)).toBe(22);
    expect(tocaResumen(ahora)).toBe(true);
    expect(tocaResumen(new Date("2026-11-26T02:59:00Z"))).toBe(false); // 21:59
  });

  it("al vendedor sin pendientes no se le escribe", () => {
    expect(textoResumenVendedor("Lourdes", [], ahora)).toBeNull();
  });

  it("el vendedor ve sus clientes por sección, con teléfono y hace cuánto", () => {
    const t = textoResumenVendedor(
      "Lourdes",
      [p({}), p({ tipo: "asesor", nombre: "Luis", detalle: "Quiere llamada" }), p({ tipo: "por_cerrar", nombre: "Rosa", detalle: "Intencion de compra" })],
      ahora
    )!;
    expect(t).toContain("Pendientes para mañana, Lourdes");
    expect(t).toContain("Esperan tu respuesta* (1)");
    expect(t).toContain("Ana (987 654 321) — ¿Cuánto cuesta? · hace 2 h");
    expect(t).toContain("Pidieron hablar con una persona* (1)");
    expect(t).toContain("Por cerrar");
  });

  it("los postulantes no le llegan al vendedor, solo al administrador", () => {
    const post = p({ tipo: "postulante", nombre: "Oscar", detalle: "Postulante asesor comercial" });
    expect(textoResumenVendedor("Lourdes", [post], ahora)).toBeNull();
    const t = textoResumenAdmin({
      pendientes: [post],
      actividad: { chatsNuevos: 0, mensajesClientes: 0, pedidosNuevos: 0, etapas: [] },
      vendedores: [{ id: "m-lourdes", nombre: "Lourdes" }],
      envios: [],
      ahora,
    });
    expect(t).toContain("Postulantes por contactar* (1)");
    expect(t).toContain("Sin chats pendientes");
  });

  it("corta las listas largas", () => {
    const muchos = Array.from({ length: MAX_POR_SECCION + 3 }, (_, i) => p({ nombre: `C${i}` }));
    const t = textoResumenVendedor("Lourdes", muchos, ahora)!;
    expect(t).toContain("… y 3 más en el CRM");
    expect(t.length).toBeLessThanOrEqual(4000);
  });

  it("el administrador ve totales por vendedor y si los resúmenes llegaron", () => {
    const t = textoResumenAdmin({
      pendientes: [p({}), p({ ownerId: null, nombre: "Sin dueño" })],
      actividad: { chatsNuevos: 12, mensajesClientes: 80, pedidosNuevos: 3, etapas: [{ nombre: "Pedido confirmado", n: 5 }, { nombre: "Vacía", n: 0 }] },
      vendedores: [{ id: "m-lourdes", nombre: "Lourdes" }],
      envios: [{ nombre: "Lourdes", ok: true }, { nombre: "Stephano", ok: false, error: "fuera_de_ventana_24h" }],
      ahora,
    });
    expect(t).toContain("Resumen del día — 2026-11-25");
    expect(t).toContain("12 chats nuevos · 80 mensajes de clientes · 3 pedidos nuevos");
    expect(t).toContain("• Pedido confirmado: 5");
    expect(t).not.toContain("Vacía");
    expect(t).toContain("• Lourdes: 1 esperan");
    expect(t).toContain("• Sin asignar: 1 esperan");
    expect(t).toContain("Stephano: NO enviado (fuera_de_ventana_24h)");
  });

  it("Stephano recibe los avisos comerciales y de atención como Lourdes, no los de dinero", () => {
    const s = SUPERVISORES.find((x) => x.nombre === "Stephano")!;
    expect(s.digitos).toBe("977126462");
    expect(destinatariosAviso("pedido_chat")).toContain("977126462");
    expect(destinatariosAviso("comprobante_pago")).not.toContain("977126462");
  });
});
