import { describe, expect, it } from "vitest";
import {
  decidirUbicacionCE,
  mensajeRecordatorioUbicacion,
  recordatorioEnviadoEn,
} from "@/lib/pedidos/ubicacion-ce-reglas";

const creadoEn = new Date("2026-11-24T15:00:00Z");
const en = (min: number) => new Date(creadoEn.getTime() + min * 60_000);
const base = { creadoEn, notas: null as string | null, tienePin: false, tieneReferencia: false };

describe("mejora 9b: referencia y ubicación en CE", () => {
  it("espera 10 min antes de recordar", () => {
    expect(decidirUbicacionCE({ ...base, ahora: en(5) }).accion).toBe("esperar");
    expect(decidirUbicacionCE({ ...base, ahora: en(11) })).toEqual({ accion: "recordar", faltaPin: true, faltaReferencia: true });
  });

  it("con pin y referencia queda resuelto de inmediato", () => {
    expect(decidirUbicacionCE({ ...base, ahora: en(1), tienePin: true, tieneReferencia: true }).accion).toBe("pin_ok");
  });

  it("10 min después del recordatorio sin pin pasa al plan B (Google)", () => {
    const notas = "[UBICACION_RECORDATORIO] 2026-11-24T15:11:00.000Z Recordatorio de ubicación: enviado.";
    expect(recordatorioEnviadoEn(notas)?.toISOString()).toBe("2026-11-24T15:11:00.000Z");
    expect(decidirUbicacionCE({ ...base, notas, ahora: en(15) }).accion).toBe("esperar");
    expect(decidirUbicacionCE({ ...base, notas, ahora: en(22) }).accion).toBe("plan_b");
    expect(decidirUbicacionCE({ ...base, notas, ahora: en(22), tienePin: true }).accion).toBe("pin_ok");
  });

  it("no repite cuando ya quedó el punto", () => {
    expect(decidirUbicacionCE({ ...base, notas: "[UBICACION_GOOGLE] …", ahora: en(60) }).accion).toBe("nada");
    expect(decidirUbicacionCE({ ...base, ahora: en(7 * 60) }).accion).toBe("nada");
  });

  it("mensaje según lo que falta", () => {
    const ambos = mensajeRecordatorioUbicacion({ nombre: "MARÍA lopez", numeroVisible: "CHAT-0012", faltaPin: true, faltaReferencia: true });
    expect(ambos).toMatch(/^María, para que el motorizado llegue sin perderse con tu pedido CHAT-0012/);
    expect(ambos).toMatch(/ubicación.*referencia/);
    expect(mensajeRecordatorioUbicacion({ nombre: null, numeroVisible: "", faltaPin: false, faltaReferencia: true })).toMatch(/referencia de tu casa/);
  });
});
