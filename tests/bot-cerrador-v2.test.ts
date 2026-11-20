import { describe, expect, it } from "vitest";
import {
  detectarEtapa,
  detectarSituacion,
  elegirEjemplos,
  renderGuionVenta,
  varianteAB,
} from "@/lib/agent/guion-venta";
import {
  ajustarAHorario,
  decidirSeguimiento,
  detectarPromesa,
  mensajeSeguimiento,
} from "@/lib/agent/seguimiento-reglas";
import { nombreParaSaludo } from "@/lib/nombres";
import { EJEMPLOS_VENTA } from "../config/ejemplos-venta";

const u = (content: string) => ({ role: "user", content });
const a = (content: string) => ({ role: "assistant", content });

describe("prueba A/B del primer mensaje", () => {
  it("reparte de forma estable y aproximadamente 50/50", () => {
    expect(varianteAB("conv-123", "on")).toBe(varianteAB("conv-123", "on"));
    let b = 0;
    for (let i = 0; i < 1000; i++) if (varianteAB(`c-${i}-x`, "on") === "B") b++;
    expect(b).toBeGreaterThan(420);
    expect(b).toBeLessThan(580);
  });
  it("se puede apagar o fijar en B", () => {
    expect(varianteAB("x", "off")).toBe("A");
    expect(varianteAB("x", "B")).toBe("B");
  });
  it("solo la variante B recibe la regla del mensaje corto, y solo en el primer turno", () => {
    let conB = "";
    for (let i = 0; i < 50 && !conB; i++) if (varianteAB(`k${i}`, "on") === "B") conB = `k${i}`;
    const prev = process.env.AB_PRIMER_MENSAJE;
    process.env.AB_PRIMER_MENSAJE = "on";
    const g = renderGuionVenta({ conversationId: conB, historial: [u("¡Hola! Quiero más información")], productoAnuncio: "nac600" });
    expect(g.etapa).toBe("primer_contacto");
    expect(g.bloque).toContain("350 caracteres");
    const g2 = renderGuionVenta({ conversationId: conB, historial: [u("Hola"), a("Hola, ¿para ti?"), u("precio")] });
    expect(g2.bloque).not.toContain("350 caracteres");
    process.env.AB_PRIMER_MENSAJE = prev;
  });
});

describe("etapas y situaciones", () => {
  it("detecta la etapa del chat", () => {
    expect(detectarEtapa([u("hola")])).toBe("primer_contacto");
    expect(detectarEtapa([u("hola"), a("¿Para ti o para regalar?"), u("para mi")])).toBe("consulta");
    expect(detectarEtapa([u("precio"), a("• 1 frasco *S/119* • 3 frascos *S/199*"), u("mmm")])).toBe("cotizado");
    expect(detectarEtapa([u("quiero el de 3"), a("Pásame tu dirección con referencia"), u("ok")])).toBe("datos_lima");
    expect(detectarEtapa([u("soy de Arequipa, quiero 3"), a("Te queda cerca la agencia Shalom Cayma. ¿Te lo enviamos ahí?"), u("si")])).toBe("datos_provincia");
    expect(detectarEtapa([u("si"), a("Separas con un adelanto de S/20 al Yape *951365418* y me pasas tu DNI"), u("ya")])).toBe("adelanto");
    expect(detectarEtapa([u("hola")], { tienePedido: true })).toBe("con_pedido");
  });
  it("reconoce lo que plantea el cliente", () => {
    expect(detectarSituacion("Uy está caro")).toBe("caro");
    expect(detectarSituacion("ok lo voy a pensar")).toBe("lo_pienso");
    expect(detectarSituacion("lo consulto con mi esposo")).toBe("consulta_tercero");
    expect(detectarSituacion("no será estafa?")).toBe("confianza");
    expect(detectarSituacion("en unos 20 minutos le paso")).toBe("promete_volver");
    expect(detectarSituacion("cuánto cuesta")).toBe("pide_precio");
    expect(detectarSituacion("ok")).toBe("silencio_ok");
  });
  it("elige ejemplos parecidos y del producto correcto", () => {
    const ej = elegirEjemplos("cotizado", "caro", "termix");
    expect(ej.length).toBeGreaterThan(0);
    expect(ej[0].situacion).toBe("caro");
    expect(ej.every((e) => e.producto !== "nac600")).toBe(true);
  });
  it("con pedido no hay ejemplos de venta", () => {
    const g = renderGuionVenta({ conversationId: "x", historial: [u("¿cuándo llega?")], tienePedido: true });
    expect(g.bloque).not.toContain("Ejemplos");
  });
});

describe("banco de respuestas", () => {
  it("respeta precios, garantía y formas de pago", () => {
    for (const e of EJEMPLOS_VENTA) {
      const t = e.respuesta;
      expect(t.length, e.id).toBeLessThanOrEqual(420);
      expect(t, e.id).not.toMatch(/devolvemos (tu|el) dinero|efectivo|tarjeta|cura|garantizad/i);
      for (const m of t.match(/S\/\s?(\d+)/g) ?? []) {
        expect(["79", "119", "139", "189", "199", "20", "2"].some((p) => m.endsWith(p)), `${e.id}: ${m}`).toBe(true);
      }
    }
  });
});

describe("seguimiento con hora", () => {
  const ahora = new Date("2026-11-20T16:00:00Z"); // 11:00 Lima
  it("detecta promesas de volver", () => {
    expect(detectarPromesa("En unos 20 minutos le paso ok", ahora)?.toISOString()).toBe("2026-11-20T16:30:00.000Z");
    expect(detectarPromesa("en una hora te confirmo", ahora)?.toISOString()).toBe("2026-11-20T17:10:00.000Z");
    expect(detectarPromesa("mañana te escribo", ahora)?.toISOString()).toBe("2026-11-21T15:00:00.000Z");
    expect(detectarPromesa("más tarde te paso los datos", ahora)).not.toBeNull();
    expect(detectarPromesa("quiero el de 3", ahora)).toBeNull();
    expect(detectarPromesa("no gracias, ya no quiero", ahora)).toBeNull();
  });
  it("no escribe de noche", () => {
    const noche = new Date("2026-11-21T03:00:00Z"); // 22:00 Lima
    expect(ajustarAHorario(noche).toISOString()).toBe("2026-11-21T15:00:00.000Z");
    const madrugada = new Date("2026-11-21T08:00:00Z"); // 3:00 Lima
    expect(ajustarAHorario(madrugada).toISOString()).toBe("2026-11-21T15:00:00.000Z");
  });
  it("decide enviar, esperar o cerrar", () => {
    const base = {
      ahora,
      programadoPara: new Date("2026-11-20T15:50:00Z"),
      creadoEn: new Date("2026-11-20T15:20:00Z"),
      ultimoEntranteEn: new Date("2026-11-20T15:19:00Z"),
      pedidoDespues: false,
      aiActivo: true,
    };
    expect(decidirSeguimiento(base).accion).toBe("enviar");
    expect(decidirSeguimiento({ ...base, programadoPara: new Date("2026-11-20T17:00:00Z") }).accion).toBe("esperar");
    expect(decidirSeguimiento({ ...base, ultimoEntranteEn: new Date("2026-11-20T15:40:00Z") }).accion).toBe("cerrar");
    expect(decidirSeguimiento({ ...base, pedidoDespues: true }).accion).toBe("cerrar");
    expect(decidirSeguimiento({ ...base, aiActivo: false }).accion).toBe("cerrar");
    expect(decidirSeguimiento({ ...base, ultimoEntranteEn: new Date("2026-11-19T14:00:00Z") }).accion).toBe("cerrar");
  });
  it("el mensaje es corto y sin nombres de usuario raros", () => {
    expect(mensajeSeguimiento("chambearevalocarlosalbert")).toMatch(/^¡Hola! /);
    expect(mensajeSeguimiento("rosa maría")).toMatch(/^¡Hola, Rosa! /);
    expect(mensajeSeguimiento("Juan", "datos").length).toBeLessThan(160);
  });
});

describe("nombres para saludar", () => {
  it("filtra usuarios pegados, números y palabras genéricas", () => {
    expect(nombreParaSaludo("chambearevalocarlosalbert")).toBeNull();
    expect(nombreParaSaludo("rodriguezruizlita")).toBeNull();
    expect(nombreParaSaludo("WhatsApp 51987")).toBeNull();
    expect(nombreParaSaludo("Cliente")).toBeNull();
    expect(nombreParaSaludo("ROSA PEREZ")).toBe("Rosa");
    expect(nombreParaSaludo("josé")).toBe("José");
  });
});

import { validarRespuestaBotContraOrden } from "@/lib/agent/guardrail-orden";
describe("filtro de pedidos inexistentes en plena venta", () => {
  it("deja pasar respuestas normales de cierre sin pedido registrado", () => {
    for (const t of [
      "Te dejo tu pedido separado: 2 tobilleras por *S/139* con envío gratis. ¿A qué distrito te lo enviamos?",
      "Para emitir tu guía a tu nombre, separas tu pedido con un adelanto de S/20 al Yape y el saldo lo pagas cuando el paquete llegue a tu agencia.",
      "Perfecto, Raúl. Tu pedido de 2 tobilleras (*S/139*) queda separado; aquí te espero con los datos.",
    ]) {
      expect(validarRespuestaBotContraOrden(t, null).bloqueado, t).toBe(false);
    }
  });
  it("sigue bloqueando saldos y claves inventados", () => {
    expect(validarRespuestaBotContraOrden("El saldo restante de tu pedido es de S/ 169.00 para liberar tu clave de recojo.", null).bloqueado).toBe(true);
    expect(validarRespuestaBotContraOrden("Tu pedido está listo, te faltan S/ 99 para recogerlo.", null).bloqueado).toBe(true);
  });
});
