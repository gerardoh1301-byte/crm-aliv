import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  CAMPO_CUPON,
  aplicarCupon,
  crearCupon,
  cuponParaOtorgar,
  cuponVigente,
  lineaCupon,
  marcarUsado,
} from "@/lib/pedidos/cupon-recompra";

const leer = (rel: string) => fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
const hoy = new Date("2026-11-24T15:00:00Z");

describe("cupón de recompra S/ 15 (mejora 6)", () => {
  it("vale S/ 15 por 30 días", () => {
    const c = crearCupon("#ALIV-1140", hoy);
    expect(c.monto).toBe(15);
    expect(new Date(c.vence).getTime() - hoy.getTime()).toBe(30 * 86400000);
    expect(lineaCupon(c)).toMatch(/S\/ 15 de descuento/);
  });

  it("solo vale sin usar y sin vencer", () => {
    const c = crearCupon("#1", hoy);
    expect(cuponVigente({ [CAMPO_CUPON]: c }, hoy)).not.toBeNull();
    expect(cuponVigente({ [CAMPO_CUPON]: marcarUsado(c, "#2", hoy) }, hoy)).toBeNull();
    expect(cuponVigente({ [CAMPO_CUPON]: c }, new Date("2027-01-01T00:00:00Z"))).toBeNull();
    expect(cuponVigente({}, hoy)).toBeNull();
    expect(cuponVigente(null, hoy)).toBeNull();
  });

  it("no se acumula ni se alarga con otra clave", () => {
    const c = crearCupon("#1", hoy);
    expect(cuponParaOtorgar({ [CAMPO_CUPON]: c }, "#2", hoy)).toBeNull();
    expect(cuponParaOtorgar({ [CAMPO_CUPON]: marcarUsado(c, "#2", hoy) }, "#3", hoy)?.pedido_origen).toBe("#3");
  });

  it("descuenta S/ 15 una vez y nunca deja el total en cero", () => {
    const c = crearCupon("#1", hoy);
    expect(aplicarCupon(189, c)).toEqual({ total: 174, descuento: 15 });
    expect(aplicarCupon(10, c)).toEqual({ total: 1, descuento: 9 });
    expect(aplicarCupon(189, null)).toEqual({ total: 189, descuento: 0 });
  });

  it("el pedido del chat aplica y gasta el cupón; el bot y la posventa lo recuerdan", () => {
    const pedido = leer("modules/pedidos/servidor.tsx");
    expect(pedido).toContain("aplicarCupon(totalSoles, cupon)");
    expect(pedido).toContain("marcarUsado(cupon, numeroOrden)");
    expect(leer("src/lib/agent/prompt.ts")).toContain("bloqueCuponParaBot(cupon)");
    expect(leer("src/lib/postventa/engine.ts")).toContain("cuponVigente(contact.customFields)");
    expect(leer("src/lib/supervisor/comandos.ts")).toContain("guardarCupon(p.contactId");
  });
});
