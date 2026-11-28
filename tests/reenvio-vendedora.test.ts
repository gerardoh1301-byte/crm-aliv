import { describe, expect, it } from "vitest";
import {
  cuerpoParaAviso,
  interpretarRespuestaVendedora,
  refCliente,
  textoAvisoVendedora,
} from "../src/lib/supervisor/reenvio-vendedora-reglas";

describe("respuesta de Gerardo al número de la vendedora", () => {
  it("instrucción con referencia", () => {
    expect(interpretarRespuestaVendedora("r 4464 dile que sí llega mañana")).toEqual({
      tipo: "responder", ref: "4464", texto: "dile que sí llega mañana", literal: false,
    });
  });
  it("texto exacto entre comillas", () => {
    expect(interpretarRespuestaVendedora('R 4464 "Hola, sí llega mañana 🙌"')).toEqual({
      tipo: "responder", ref: "4464", texto: "Hola, sí llega mañana 🙌", literal: true,
    });
    expect(interpretarRespuestaVendedora("r «Gracias por escribir»")).toMatchObject({ ref: null, literal: true });
  });
  it("sin referencia va al último aviso", () => {
    expect(interpretarRespuestaVendedora("r: pregúntale su distrito")).toEqual({
      tipo: "responder", ref: null, texto: "pregúntale su distrito", literal: false,
    });
  });
  it("confirmar y descartar", () => {
    expect(interpretarRespuestaVendedora("r ok")).toEqual({ tipo: "confirmar" });
    expect(interpretarRespuestaVendedora("R sí")).toEqual({ tipo: "confirmar" });
    expect(interpretarRespuestaVendedora("r no")).toEqual({ tipo: "descartar" });
  });
  it("no confunde otros mensajes", () => {
    expect(interpretarRespuestaVendedora("resumen de hoy")).toBeNull();
    expect(interpretarRespuestaVendedora("r")).toBeNull();
    expect(interpretarRespuestaVendedora("SI 1140")).toBeNull();
    expect(interpretarRespuestaVendedora("registra 1171 en aliclik")).toBeNull();
  });
  it("aviso con referencia y adjuntos", () => {
    expect(refCliente("+51 980 592 464")).toBe("2464");
    expect(cuerpoParaAviso(null, "audio")).toBe("[🎤 audio]");
    expect(cuerpoParaAviso("mira", "image")).toBe("[📷 imagen] mira");
    const t = textoAvisoVendedora({
      nombre: "Laura", telefono: "+51987654321", cuerpo: "hola", botEncendido: true, vendedora: "Rossana", conversationId: "abc",
    });
    expect(t).toContain("ref *4321*");
    expect(t).toContain("r 4321");
  });
});
