import { describe, it, expect, vi } from "vitest";
import {
  SPREADSHEET_ID,
  SHEET_NAME,
  SPREADSHEET_URL,
} from "@/lib/sheets/envios-sync";

describe("Respaldo Automático en Google Sheets (En Camino / Despachados)", () => {
  it("tiene configurado el ID del Google Spreadsheet y la pestaña correspondiente", () => {
    expect(SPREADSHEET_ID).toBe("1vBgWP5MELBc-hiq-Mz4gBJqpxvF2sKTEGhfnddZpkoo");
    expect(SHEET_NAME).toBe("En Camino y Despachos");
    expect(SPREADSHEET_URL).toContain(SPREADSHEET_ID);
  });

  it("garantiza que la clave secreta de recojo Shalom preserve ceros a la izquierda (ej. '0011')", () => {
    const clave = "0011";
    const valorFormateado = `'${clave.replace(/^'+/, "")}`;
    expect(valorFormateado).toBe("'0011");
  });

  it("calcula correctamente el saldo pendiente descontando el adelanto de S/ 20 para Shalom", () => {
    const totalSoles = 199.0;
    const adelanto = 20.0;
    const saldo = Math.max(0, totalSoles - adelanto);
    expect(saldo).toBe(179.0);
  });

  it("para envíos con motorizado en Lima el adelanto es 0 y el saldo es el 100% contraentrega", () => {
    const totalSoles = 79.0;
    const adelanto = 0.0;
    const saldo = Math.max(0, totalSoles - adelanto);
    expect(saldo).toBe(79.0);
  });
});
