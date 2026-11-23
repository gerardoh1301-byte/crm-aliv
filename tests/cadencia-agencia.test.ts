import { describe, expect, it } from "vitest";
import { avisosEnviados, decidirToqueAgencia, mensajeToqueAgencia, type EntradaCadencia } from "@/lib/agencias/cadencia-agencia";

// 10:00 Lima = 15:00 UTC
const aviso10 = "[AVISO_LLEGADA_ENVIADO:2026-11-22T15:00 guia=104401923]";
const en = (iso: string) => new Date(iso);
const base = (over: Partial<EntradaCadencia> = {}): EntradaCadencia => ({
  ahora: en("2026-11-22T20:30:00Z"), // 15:30 Lima, 5.5 h después del aviso
  notasPedido: aviso10,
  horasEnAgencia: 6,
  ultimoEntranteEn: en("2026-11-22T13:00:00Z"),
  ultimoMensajeEn: en("2026-11-22T15:00:00Z"),
  ...over,
});
const datos = { nombre: "Juan", agencia: "Pisco", guia: "104401923", codigo: "ABCD", saldo: 179, medioPago: "Yape" };

describe("cadencia de avisos en agencia Shalom", () => {
  it("lee las marcas de aviso de las notas", () => {
    expect(avisosEnviados(`x\n${aviso10}\n[AVISO_LLEGADA_ENVIADO:2026-11-23T13:31 guia=1]`)).toHaveLength(2);
    expect(avisosEnviados(null)).toEqual([]);
  });

  it("sin avisos: aviso de llegada", () => {
    expect(decidirToqueAgencia(base({ notasPedido: "" }))).toMatchObject({ accion: "enviar", toque: "llegada" });
  });

  it("4 h después, el mismo día y antes de las 18:00: toque de la tarde", () => {
    expect(decidirToqueAgencia(base())).toMatchObject({ accion: "enviar", toque: "tarde" });
  });

  it("no hay toque de la tarde si el cliente respondió, si es tarde o si la ventana de 24 h está cerrada", () => {
    expect(decidirToqueAgencia(base({ ultimoEntranteEn: en("2026-11-22T16:00:00Z") })).accion).toBe("esperar");
    expect(decidirToqueAgencia(base({ ahora: en("2026-11-22T23:30:00Z") })).accion).toBe("esperar"); // 18:30 Lima
    expect(decidirToqueAgencia(base({ ultimoEntranteEn: en("2026-11-20T10:00:00Z") })).accion).toBe("esperar");
    expect(decidirToqueAgencia(base({ ahora: en("2026-11-22T17:00:00Z") })).accion).toBe("esperar"); // solo 2 h
  });

  it("al día siguiente: recordatorio diario; desde el día 4: riesgo", () => {
    const manana = base({ ahora: en("2026-11-23T15:30:00Z"), horasEnAgencia: 30, ultimoMensajeEn: en("2026-11-22T19:30:00Z") });
    expect(decidirToqueAgencia({ ...manana, notasPedido: `${aviso10}\n[AVISO_LLEGADA_ENVIADO:2026-11-22T19:30 guia=1]` })).toMatchObject({
      accion: "enviar",
      toque: "diario",
      diasEnAgencia: 2,
    });
    const dia4 = base({ ahora: en("2026-11-25T15:30:00Z"), horasEnAgencia: 80, ultimoMensajeEn: en("2026-11-24T15:00:00Z"), notasPedido: `${aviso10}\n[AVISO_LLEGADA_ENVIADO:2026-11-24T15:00 guia=1]` });
    expect(decidirToqueAgencia(dia4)).toMatchObject({ accion: "enviar", toque: "riesgo", diasEnAgencia: 4 });
  });

  it("no repite si hubo conversación hace menos de 20 h", () => {
    const e = base({ ahora: en("2026-11-23T16:00:00Z"), horasEnAgencia: 30, ultimoMensajeEn: en("2026-11-23T10:00:00Z") });
    expect(decidirToqueAgencia({ ...e, notasPedido: `${aviso10}\n[AVISO_LLEGADA_ENVIADO:2026-11-22T19:30 guia=1]` }).accion).toBe("esperar");
  });

  it("pedido avisado antes de las marcas (solo etiqueta): sigue con el diario, no repite la llegada", () => {
    const e = base({ notasPedido: "", avisadoSinMarca: true, ultimoMensajeEn: en("2026-11-21T10:00:00Z"), horasEnAgencia: 50 });
    expect(decidirToqueAgencia(e)).toMatchObject({ accion: "enviar", toque: "diario" });
  });

  it("mensajes con saldo y días; el de riesgo menciona la devolución", () => {
    expect(mensajeToqueAgencia("tarde", 1, datos)).toContain("S/ 179.00");
    expect(mensajeToqueAgencia("diario", 2, datos)).toContain("día 2");
    const r = mensajeToqueAgencia("riesgo", 5, datos);
    expect(r).toContain("5 días");
    expect(r).toMatch(/devuelve/);
  });
});
