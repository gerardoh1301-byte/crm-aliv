import { describe, expect, it } from "vitest";
import {
  CATEGORIA_AVISO,
  SUPERVISOR_ADMINISTRADOR,
  destinatariosAviso,
  type TipoSituacionCritica,
} from "@/lib/alerts/perfiles-supervisor";
import { esNumeroEntrenador } from "@/lib/alerts/supervisor-alerts";
import { esSupervisorPagos } from "@/lib/supervisor/comandos";

const GERARDO = "951365418";
const LOURDES = "945226853";

const tiposDe = (categoria: string) =>
  (Object.keys(CATEGORIA_AVISO) as TipoSituacionCritica[]).filter((t) => CATEGORIA_AVISO[t] === categoria);

describe("Perfiles de supervisor: a quién va cada aviso", () => {
  it("un aviso logístico o de dinero solo llega a Gerardo (Administrador)", () => {
    for (const tipo of [
      "shalom_envio_confirmado",
      "shalom_cambio_destino",
      "shalom_24h_retraso",
      "shalom_preguia_pago_almacen",
      "cambio_agencia_con_guia",
      "comprobante_pago",
      "aliclik_entregado",
    ] as TipoSituacionCritica[]) {
      expect(destinatariosAviso(tipo), tipo).toEqual([GERARDO]);
    }
    for (const tipo of tiposDe("logistica")) expect(destinatariosAviso(tipo), tipo).toEqual([GERARDO]);
  });

  it("un aviso comercial llega a Gerardo y a Lourdes", () => {
    expect(destinatariosAviso("pedido_shopify")).toEqual([GERARDO, LOURDES]);
    expect(destinatariosAviso("pedido_chat")).toEqual([GERARDO, LOURDES]);
  });

  it("un aviso de atención al cliente llega a Gerardo y a Lourdes", () => {
    for (const tipo of ["reclamo_medico", "pide_humano_llamada", "guardrail_bloqueo", "bot_sin_respuesta"] as TipoSituacionCritica[]) {
      expect(destinatariosAviso(tipo), tipo).toEqual([GERARDO, LOURDES]);
    }
  });

  it("las órdenes por WhatsApp siguen siendo solo del Administrador", () => {
    expect(SUPERVISOR_ADMINISTRADOR).toBe(GERARDO);
    expect(esSupervisorPagos("+51951365418")).toBe(true);
    expect(esSupervisorPagos("+51945226853")).toBe(false);
  });

  it("ambos siguen en la lista blanca", () => {
    expect(esNumeroEntrenador("+51951365418")).toBe(true);
    expect(esNumeroEntrenador("+51945226853")).toBe(true);
  });
});
