import { describe, expect, it } from "vitest";
import {
  horaLima,
  tocaResumen,
  textoResumenAdmin,
  textoResumenVendedor,
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

  it("el vendedor recibe un texto corto: cuántos hay y por quién empezar", () => {
    const t = textoResumenVendedor(
      "Lourdes",
      [p({}), p({ tipo: "asesor", nombre: "Luis", detalle: "Quiere llamada" }), p({ tipo: "por_cerrar", nombre: "Rosa", detalle: "Intencion de compra" })],
      ahora
    )!;
    expect(t).toContain("Lourdes, tus pendientes para mañana");
    expect(t).toContain("💬 1 esperan respuesta");
    expect(t).toContain("🙋 1 pidieron hablar con una persona");
    expect(t).toContain("🛒 1 por cerrar venta");
    expect(t).toContain("Empieza por *Ana*: espera respuesta hace 2 h.");
    expect(t).toContain("PDF");
    expect(t).not.toContain("987");
    expect(t.length).toBeLessThan(400);
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
    expect(t).toContain("👔 1 postulantes por contactar");
    expect(t).not.toContain("Por vendedor");
  });

  it("con muchos pendientes el texto sigue corto (la lista va en el PDF)", () => {
    const muchos = Array.from({ length: 80 }, (_, i) => p({ nombre: `C${i}` }));
    const t = textoResumenVendedor("Lourdes", muchos, ahora)!;
    expect(t).toContain("💬 80 esperan respuesta");
    expect(t.length).toBeLessThan(400);
  });

  it("el administrador ve totales por vendedor y si los resúmenes llegaron", () => {
    const t = textoResumenAdmin({
      pendientes: [p({}), p({ ownerId: null, nombre: "Sin dueño" })],
      actividad: { chatsNuevos: 12, mensajesClientes: 80, pedidosNuevos: 3, etapas: [{ nombre: "Pedido confirmado", n: 5 }, { nombre: "Vacía", n: 0 }] },
      vendedores: [{ id: "m-lourdes", nombre: "Lourdes" }],
      envios: [{ nombre: "Lourdes", ok: true }, { nombre: "Stephano", ok: false, error: "fuera_de_ventana_24h" }],
      ahora,
    });
    expect(t).toContain("Resumen del día 25/11");
    expect(t).toContain("Hoy: 12 chats nuevos · 3 pedidos nuevos");
    expect(t).toContain("💬 2 esperan respuesta");
    expect(t).toContain("Por vendedor: Lourdes 1 · Sin asignar 1");
    expect(t).toContain("No les llegó su resumen: Stephano");
    expect(t).not.toContain("Lourdes,");
    expect(t.length).toBeLessThan(500);
  });

  it("Stephano recibe los avisos comerciales y de atención como Lourdes, no los de dinero", () => {
    const s = SUPERVISORES.find((x) => x.nombre === "Stephano")!;
    expect(s.digitos).toBe("977126462");
    expect(destinatariosAviso("pedido_chat")).toContain("977126462");
    expect(destinatariosAviso("comprobante_pago")).not.toContain("977126462");
  });
});

import { generarPdfResumen, textoPdf } from "@/lib/resumen-diario/pdf";
import { leerTokenResumen, tokenResumen } from "@/lib/resumen-diario/token";

describe("PDF del resumen", () => {
  it("quita emojis pero deja tildes y ñ", () => {
    expect(textoPdf("Rossana🛼🛼 Peña ⚽ — ¿Cuánto?")).toBe("Rossana Peña — ¿Cuánto?");
  });

  it("genera un PDF con todas las filas, aunque sean muchas y con emojis", async () => {
    const muchos = Array.from({ length: 60 }, (_, i) => p({ nombre: `Cliente 🦇 ${i}`, detalle: "x".repeat(400) }));
    const pdf = await generarPdfResumen({
      titulo: "Resumen del día 2026-11-25",
      subtitulo: "prueba",
      pendientes: muchos,
      actividad: { chatsNuevos: 1, mensajesClientes: 2, pedidosNuevos: 3, etapas: [{ nombre: "Por despachar", n: 4 }] },
      porVendedor: [{ nombre: "Lourdes", esperando: 60, asesor: 0, porCerrar: 0 }],
      nombreDueno: () => "Lourdes",
    });
    expect(Buffer.from(pdf.slice(0, 5)).toString()).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(2000);
  });

  it("el enlace del PDF va firmado y vence", () => {
    const t = tokenResumen("2026-11-25", "admin", "secreto");
    expect(leerTokenResumen(t, "secreto", new Date("2026-11-26T03:00:00Z"))).toEqual({ fecha: "2026-11-25", destino: "admin" });
    expect(leerTokenResumen(t, "otro", new Date("2026-11-26T03:00:00Z"))).toBeNull();
    expect(leerTokenResumen(t.replace("admin", "b1480004"), "secreto")).toBeNull();
    expect(leerTokenResumen(t, "secreto", new Date("2026-12-05T03:00:00Z"))).toBeNull();
  });
});
