import { describe, expect, it } from "vitest";
import { esAfirmacion, esRechazo, evaluarConfirmacion, type MensajeChat } from "@/lib/pedidos/confirmacion";

const bot = (body: string): MensajeChat => ({ direction: "out", body });
const cli = (body: string): MensajeChat => ({ direction: "in", body });
const cod = { estado: "por_confirmar_cod", modalidadPago: "contraentrega", notas: "[ENTREGA_WEB:CE|lima_formulario|2026-11-27]", direccionEnvio: "Av. Tomás Valle 917" };

describe("esAfirmacion / esRechazo", () => {
  it("reconoce el sí del cliente", () => {
    for (const t of ["Siii", "Sí", "Si deseo pedir", "Confirmo", "ok", "Correcto, gracias", "Aún deseo el pedido"]) {
      expect(esAfirmacion(t)).toBe(true);
    }
  });
  it("no cuenta el mensaje de la landing ni dudas", () => {
    expect(esAfirmacion("Hola Aliv, soy Julio. Quiero confirmar mi pedido #1208 🙌")).toBe(false);
    expect(esAfirmacion("Q producto era")).toBe(false);
    expect(esAfirmacion("Ya. ¿Ah, cómo está?")).toBe(false);
  });
  it("reconoce rechazos", () => {
    expect(esRechazo("Ya no")).toBe(true);
    expect(esRechazo("no gracias")).toBe(true);
    expect(esAfirmacion("Si, pero ya no lo quiero")).toBe(false);
  });
});

describe("evaluarConfirmacion", () => {
  it("contra entrega: sí tras la pregunta del bot + dirección = confirmado", () => {
    const r = evaluarConfirmacion({ ...cod, mensajes: [bot("Tu pedido de 3 frascos por S/199 a Av. Tomás Valle 917. ¿Te lo agendo para mañana?"), cli("Sí")] });
    expect(r.confirmado).toBe(true);
  });
  it("solo el mensaje de la landing = intención", () => {
    const r = evaluarConfirmacion({
      ...cod,
      mensajes: [bot("¡Hola! Recibimos tu pedido #1208. ¿Confirmas?"), cli("Hola Aliv, soy Julio. Quiero confirmar mi pedido #1208")],
    });
    expect(r.confirmado).toBe(false);
  });
  it("un sí sin pregunta del bot no cuenta", () => {
    expect(evaluarConfirmacion({ ...cod, mensajes: [cli("ok")] }).confirmado).toBe(false);
  });
  it("llamada IA confirmada = confirmado", () => {
    const notas = cod.notas + "\n[LLAMADA_IA_RESULTADO] 2026-11-26 estado=confirmado duracion=62s";
    expect(evaluarConfirmacion({ ...cod, notas, mensajes: [] }).confirmado).toBe(true);
  });
  it("confirmó pero sin dirección exacta = intención", () => {
    const r = evaluarConfirmacion({ ...cod, direccionEnvio: "agua rey", mensajes: [bot("¿Confirmas tu pedido?"), cli("si")] });
    expect(r).toMatchObject({ confirmado: false });
  });
  it("agencia: solo con adelanto verificado", () => {
    const ag = { estado: "por_confirmar_cod", modalidadPago: "adelanto_agencia", notas: "", direccionEnvio: "Agencia Shalom Arequipa" };
    expect(evaluarConfirmacion({ ...ag, mensajes: [bot("¿Confirmas tu pedido?"), cli("Sí")] }).confirmado).toBe(false);
    expect(evaluarConfirmacion({ ...ag, notas: "[ADELANTO VERIFICADO] S/20", mensajes: [] }).confirmado).toBe(true);
  });
  it("orden AliClik o guía = confirmado", () => {
    expect(evaluarConfirmacion({ ...cod, notas: "[ALICLIK_ORDEN:ERG1]", mensajes: [] }).confirmado).toBe(true);
  });
  it("rechazo al final = no confirmado", () => {
    const r = evaluarConfirmacion({ ...cod, mensajes: [bot("¿Confirmas?"), cli("Sí"), bot("..."), cli("Ya no")] });
    expect(r).toMatchObject({ confirmado: false, rechazo: true });
  });
});
