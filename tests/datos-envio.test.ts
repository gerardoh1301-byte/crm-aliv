import { describe, expect, it } from "vitest";
import {
  agenciaConfirmada,
  evaluarRequisitosShalom,
  exigirDatosEnvio,
  SIN_REQUISITOS,
} from "@/lib/agent/datos-envio";
import { resolverAgenciaOficial, textoAgenciaOficial } from "@/lib/agencias/shalom-directorio";

// Caso #1153 (20/11): pedido web a Trujillo con dirección de casa, sin DNI, adelanto enviado.
const pedidoTrujillo = {
  numeroOrden: "#1153",
  estado: "por_confirmar_cod",
  ciudad: "Trujillo",
  distrito: null,
  direccionEnvio: "Sto. Toribio de mogrovejo 640 san andres",
  dniCliente: null,
  transportadora: null,
  numeroGuia: null,
  modalidadPago: "contraentrega",
  notas: null,
};

const base = {
  campos: {},
  notasContacto: null,
  zonaContraEntrega: false,
  chatVaPorShalom: true,
  intencionProvincia: false,
};

describe("requisitos de envío Shalom", () => {
  it("pedido web de provincia sin DNI ni agencia oficial: faltan ambos y propone sedes", () => {
    const r = evaluarRequisitosShalom({ ...base, pedido: pedidoTrujillo });
    expect(r.aplica).toBe(true);
    expect(r.faltaDni).toBe(true);
    expect(r.faltaAgencia).toBe(true);
    expect(r.opciones.length).toBeGreaterThan(0);
    expect(r.numeroOrden).toBe("#1153");
  });

  it("la respuesta real del bot a Manuel queda corregida: sin promesa de clave y pidiendo DNI y agencia", () => {
    const req = evaluarRequisitosShalom({ ...base, pedido: pedidoTrujillo });
    const original =
      "Muchas gracias por tu constancia, Manuel. Nuestro equipo de administración verificará tu abono en cuenta y un asesor humano te enviará de inmediato tu clave de retiro para que puedas recoger tu paquete en la agencia Shalom de Trujillo. 🌿";
    const r = exigirDatosEnvio(original, req);
    expect(r.promesaQuitada).toBe(true);
    expect(r.agregado).toBe(true);
    expect(r.texto).not.toMatch(/clave de retiro/i);
    expect(r.texto).toMatch(/Muchas gracias por tu constancia/);
    expect(r.texto).toMatch(/DNI/);
    expect(r.texto).toMatch(/agencia Shalom/i);
  });

  it("una despedida tras 'Ok' se convierte en el pedido de datos", () => {
    const req = evaluarRequisitosShalom({ ...base, pedido: pedidoTrujillo });
    const r = exigirDatosEnvio(
      "Quedo a tu disposición si necesitas cualquier otra consulta sobre tus cápsulas de NAC600, Manuel. ¡Que tengas un excelente día! 🌿",
      req
    );
    expect(r.agregado).toBe(true);
    expect(r.texto).not.toMatch(/excelente día/);
    expect(r.texto).toMatch(/DNI/);
  });

  it("con DNI y agencia oficial guardados ya no exige nada", () => {
    const ag = resolverAgenciaOficial({ texto: "Av. Larco 1120", ciudad: "Trujillo" }).agencia!;
    const req = evaluarRequisitosShalom({
      ...base,
      pedido: { ...pedidoTrujillo, dniCliente: "12345678", direccionEnvio: textoAgenciaOficial(ag) },
    });
    expect(agenciaConfirmada(textoAgenciaOficial(ag), "Trujillo")).toBe(true);
    expect(req.faltaDni).toBe(false);
    expect(req.faltaAgencia).toBe(false);
    const r = exigirDatosEnvio("¡Perfecto! Un asesor verifica tu adelanto.", req);
    expect(r.agregado).toBe(false);
  });

  it("si la respuesta ya pide el DNI, solo agrega la agencia", () => {
    const req = evaluarRequisitosShalom({ ...base, pedido: pedidoTrujillo });
    const r = exigirDatosEnvio("¡Gracias! ¿Me compartes tu número de DNI para la guía?", req);
    expect(r.agregado).toBe(true);
    expect(r.texto.match(/DNI/g)?.length).toBe(1);
    expect(r.texto).toMatch(/agencia Shalom/i);
  });

  it("no duplica si el modelo ya pidió DNI y agencia sin signo de pregunta", () => {
    const req = evaluarRequisitosShalom({ ...base, pedido: pedidoTrujillo });
    const r = exigirDatosEnvio(
      "¡Muchas gracias por la constancia! 🌿\n\nPara dejar lista tu guía, por favor compárteme tu *número de DNI* y confírmame si te queda bien la agencia *Shalom Av. Larco* o prefieres otra de nuestras sedes.",
      req
    );
    expect(r.agregado).toBe(false);
  });

  it("no aplica a Lima, a pedidos ya despachados ni a contra entrega AliClik", () => {
    expect(evaluarRequisitosShalom({ ...base, pedido: { ...pedidoTrujillo, ciudad: "Lima", direccionEnvio: "Av. Arequipa 123" } }).aplica).toBe(false);
    expect(evaluarRequisitosShalom({ ...base, pedido: { ...pedidoTrujillo, numeroGuia: "104650169", estado: "enviado" } }).aplica).toBe(false);
    expect(evaluarRequisitosShalom({ ...base, pedido: { ...pedidoTrujillo, transportadora: "AliClik" } }).aplica).toBe(false);
    expect(
      evaluarRequisitosShalom({ ...base, chatVaPorShalom: false, zonaContraEntrega: true, pedido: pedidoTrujillo }).aplica
    ).toBe(false);
    expect(exigirDatosEnvio("Hola", SIN_REQUISITOS).texto).toBe("Hola");
  });

  it("intención de compra en provincia sin pedido también exige los datos", () => {
    const r = evaluarRequisitosShalom({
      ...base,
      pedido: null,
      campos: { departamento_ciudad: "Pucallpa" },
      intencionProvincia: true,
    });
    expect(r.aplica).toBe(true);
    expect(r.conPedido).toBe(false);
    expect(r.faltaDni && r.faltaAgencia).toBe(true);
  });
});

describe("no repetir la lista de agencias (25/11, #1181)", () => {
  it("si el modelo ya listó las sedes y preguntó, no se vuelve a pegar", () => {
    const req = { aplica: true, conPedido: true, faltaDni: false, faltaAgencia: true, ciudad: "Piura paita", numeroOrden: "#1181",
      opciones: ["Shalom Paita (MZ. H LT. 14 URB. SOL Y MAR - PAITA)", "Shalom Ayabaca (CALLE BOLOGNESI N° 136)"] };
    const reply = "Necesito el nombre exacto de la agencia Shalom para tu guía.\n\n• Shalom Paita (MZ. H LT. 14 URB. SOL Y MAR - PAITA)\n• Shalom Ayabaca (CALLE BOLOGNESI N° 136)\n\n¿Cuál de estas es la que te queda mejor?";
    const r = exigirDatosEnvio(reply, req);
    expect(r.agregado).toBe(false);
    expect(r.texto).toBe(reply);
  });
});
