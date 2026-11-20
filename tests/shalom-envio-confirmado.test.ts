import { describe, expect, it } from "vitest";
import { debeAvisarEnvioConfirmado, MARCA_ENVIO_CONFIRMADO } from "@/lib/agencias/shalom-rastreo";

const base = { ok: true, confirmadoEnOrigen: true, enDestinoListoParaRecojo: false, yaEntregado: false };

describe("aviso de envío confirmado en Shalom", () => {
  it("avisa cuando el almacén ya dejó el paquete en la agencia de origen", () => {
    expect(debeAvisarEnvioConfirmado(base, null)).toBe(true);
  });
  it("no avisa mientras es solo preguía (Págalo: 'aún no ha sido confirmado')", () => {
    expect(debeAvisarEnvioConfirmado({ ...base, confirmadoEnOrigen: false }, null)).toBe(false);
  });
  it("avisa una sola vez por pedido", () => {
    expect(debeAvisarEnvioConfirmado(base, `nota\n${MARCA_ENVIO_CONFIRMADO}:2026-11-20T10:00 guia=1]`)).toBe(false);
  });
  it("no avisa si ya llegó a destino o se entregó", () => {
    expect(debeAvisarEnvioConfirmado({ ...base, enDestinoListoParaRecojo: true }, null)).toBe(false);
    expect(debeAvisarEnvioConfirmado({ ...base, yaEntregado: true }, null)).toBe(false);
    expect(debeAvisarEnvioConfirmado({ ...base, ok: false }, null)).toBe(false);
  });
});
