import { describe, it, expect, beforeEach } from "vitest";
import {
  limpiarIntentosLogin,
  registrarIntentoFallidoLogin,
  resetearTodoRateLimitLogin,
  verificarLimiteIntentosLogin,
} from "@/lib/rate-limit-login";
import {
  construirOrdenVerificada,
  validarRespuestaBotContraOrden,
} from "@/lib/agent/guardrail-orden";
import {
  validarDepartamentoODestino,
  validarTelefonoPeruano,
} from "@/lib/pedidos/validacion-datos";
import {
  agregarNotaSinBorrar,
  extraerOrdenAliclikPrevia,
} from "@/app/api/aliclik/crear-orden/route";
import { calcularStockNacDesdeErp } from "@/lib/finanzas/sync";

describe("Auditoría Externa 18/11 — Bloque 1 y Bloque 2", () => {
  beforeEach(() => {
    resetearTodoRateLimitLogin();
  });

  describe("S1: Límite de 5 intentos fallidos de login cada 15 minutos por IP", () => {
    it("permite los primeros 5 intentos y bloquea el 6to intento durante 15 minutos", () => {
      const ip = "203.0.113.45";
      const t0 = 1_700_000_000_000;

      for (let i = 0; i < 5; i++) {
        expect(verificarLimiteIntentosLogin(ip, t0).permitido).toBe(true);
        registrarIntentoFallidoLogin(ip, t0);
      }

      const bloqueado = verificarLimiteIntentosLogin(ip, t0 + 1000);
      expect(bloqueado.permitido).toBe(false);
      expect(bloqueado.intentosRestantes).toBe(0);
      expect(bloqueado.retryAfterSeg).toBeGreaterThan(800);

      // Pasados 15 minutos + 1 segundo vuelve a permitir
      const tras15Min = verificarLimiteIntentosLogin(ip, t0 + 15 * 60 * 1000 + 1000);
      expect(tras15Min.permitido).toBe(true);
    });

    it("limpia el contador cuando el login es exitoso", () => {
      const ip = "198.51.100.10";
      registrarIntentoFallidoLogin(ip);
      registrarIntentoFallidoLogin(ip);
      limpiarIntentosLogin(ip);
      expect(verificarLimiteIntentosLogin(ip).intentosRestantes).toBe(5);
    });
  });

  describe("C2: Guardrail contra claves de recojo inventadas y montos/cantidades falsos (Caso YESS #1070)", () => {
    const ordenYess1070 = construirOrdenVerificada({
      numeroOrden: "#1070",
      total: "189.00",
      items: [{ cantidad: 2, titulo: "NAC600 + NAD+" }],
      claveRecojo: "0011-1330",
    });

    it("bloquea el caso exacto de YESS (#1070): bot dando 'tu clave de recojo (0011)'", () => {
      const respuestaAlucinada =
        "¡Listo Yess! Aquí tienes tu clave de recojo (0011) para retirar tu paquete en Shalom.";
      const res = validarRespuestaBotContraOrden(respuestaAlucinada, ordenYess1070);

      expect(res.bloqueado).toBe(true);
      expect(res.requiereHumano).toBe(true);
      expect(res.motivo).toBe("clave_recojo_prohibida");
      expect(res.textoSeguro).not.toContain("0011");
      expect(res.textoSeguro).toContain("#1070");
      expect(res.textoSeguro).toContain("2 unidades por S/ 189.00");
    });

    it("bloquea el caso exacto de YESS (#1070): bot hablando de '3 frascos S/199' cuando el pedido es de 2 u. S/189", () => {
      const respuestaMontoErroneo =
        "Para tu pedido de 3 frascos S/199, descontando el adelanto de S/20 te queda un saldo pendiente de S/179.";
      const res = validarRespuestaBotContraOrden(respuestaMontoErroneo, ordenYess1070);

      expect(res.bloqueado).toBe(true);
      expect(res.requiereHumano).toBe(true);
      expect(["cantidad_contradice_orden", "monto_contradice_orden"]).toContain(res.motivo);
      expect(res.textoSeguro).toContain("2 unidades por S/ 189.00");
    });

    it("bloquea cuando no existe orden activa y el bot intenta afirmar un saldo o clave", () => {
      const res = validarRespuestaBotContraOrden(
        "El saldo restante de tu pedido es de S/ 169.00 para liberar tu clave de recojo.",
        null
      );
      expect(res.bloqueado).toBe(true);
      expect(res.requiereHumano).toBe(true);
      expect(res.motivo).toBe("dato_orden_inexistente");
    });

    it("permite una respuesta legítima que cita exactamente las 2 unidades por S/ 189 y el saldo real de S/ 169 sin dar clave", () => {
      const respuestaCorrecta =
        "Tu pedido #1070 de 2 frascos tiene un total de S/ 189.00 (con tu adelanto de S/ 20 resta un saldo de S/ 169.00). Un asesor verificará tu constancia.";
      const res = validarRespuestaBotContraOrden(respuestaCorrecta, ordenYess1070);

      expect(res.bloqueado).toBe(false);
      expect(res.requiereHumano).toBe(false);
    });
  });

  describe("A10: Protección contra doble orden en AliClik y conservación de notas", () => {
    it("detecta una orden previa de AliClik en las notas del deal o del pedido", () => {
      expect(
        extraerOrdenAliclikPrevia(
          "Cliente prefiere turno tarde.\n[AliClik Despacho Auto] Orden ALI-99881 creada con Alidriver.",
          null
        )
      ).toBe("ALI-99881");

      expect(
        extraerOrdenAliclikPrevia(
          null,
          "Adelanto S/20 verificado [ALICLIK_ORDEN:ORD-7721]"
        )
      ).toBe("ORD-7721");
    });

    it("agrega la nueva nota sin borrar las notas anteriores de la operación", () => {
      const prev = "Nota 1: Adelanto S/20 confirmado por Yape.";
      const nueva = "[AliClik Despacho Auto] Orden ALI-555 creada.";
      const combinada = agregarNotaSinBorrar(prev, nueva);
      expect(combinada).toContain(prev);
      expect(combinada).toContain(nueva);
    });
  });

  describe("A2 y A9: Cálculo dinámico de stock sin número fijo 200 y con costos reales", () => {
    it("calcula el stock disponible a partir de lotes y ajustes menos entregados y enviados", () => {
      const res = calcularStockNacDesdeErp({
        lotes: {
          "LOT-1": { productoId: "NAC600", cantidad: 200, costoUnit: 18 },
          "LOT-2": { productoId: "TERMIX", cantidad: 100, costoUnit: 38.42 },
        },
        pedidos: {
          "sh-1": { productoId: "NAC600", estado: "entregado", unidades: 18 },
          "sh-2": { productoId: "NAC600", estado: "enviado", unidades: 19 },
        },
      });
      expect(res.lotesNac).toBe(200);
      expect(res.entregadosNac).toBe(18);
      expect(res.transitoNac).toBe(19);
      expect(res.disponibleNac).toBe(163);
      expect(res.costoUnitNac).toBe(18);
      expect(res.costoUnitTermix).toBe(38.42);
    });
  });

  describe("M2: Validación de teléfono peruano y departamento antes de confirmar pedido", () => {
    it("rechaza identificadores de Meta (+1143828...) y acepta celulares peruanos de 9 dígitos que empiezan con 9", () => {
      expect(validarTelefonoPeruano("+1143828392019283").valido).toBe(false);
      expect(validarTelefonoPeruano("123456789").valido).toBe(false);
      expect(validarTelefonoPeruano("987654321").valido).toBe(true);
      expect(validarTelefonoPeruano("+51 987 654 321").valido).toBe(true);
    });

    it("rechaza destinos inválidos como 'sdsf' y acepta departamentos y ciudades reales del Perú", () => {
      expect(validarDepartamentoODestino("sdsf").valido).toBe(false);
      expect(validarDepartamentoODestino("xxx").valido).toBe(false);
      expect(validarDepartamentoODestino("Chiclayo").valido).toBe(true);
      expect(validarDepartamentoODestino("Lima Metropolitana").valido).toBe(true);
      expect(validarDepartamentoODestino("Arequipa").valido).toBe(true);
    });
  });
});
