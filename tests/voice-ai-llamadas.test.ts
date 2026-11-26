import { describe, expect, it } from "vitest";
import { ubicarEnPunto } from "@/lib/aliclik/cobertura-cod";
import { decisionDesdeMarcaEntregaWeb } from "@/lib/shopify/clasificar-entrega-web";
import {
  construirVariablesLlamadaPedido,
  dentroHorarioLlamadaIA,
  formatearProductoParaVoz,
} from "@/lib/voice/llamar-pedido-reglas";
import { analizarPayloadPostLlamada } from "@/lib/voice/procesar-post-llamada-reglas";

describe("Persistencia de decisión AliClik COD en provincia (Caso #1190 Cusco)", () => {
  it("no desvía Cusco a Vilcabamba cuando la calle se llama Jr. Vilcabamba 109", () => {
    const p = ubicarEnPunto({
      ciudad: "Cusco",
      direccion: "Jr.vilcabamba. 109",
    });
    expect(p?.departamento).toBe("cusco");
    expect(p?.provincia).toBe("cusco");
  });

  it("recupera la decisión provincia_cod desde la marca [ENTREGA_WEB:CE|provincia_cod|...] grabada en el pedido", () => {
    const d = decisionDesdeMarcaEntregaWeb({
      notasPedido: "Pedido web #1190\n[ENTREGA_WEB:CE|provincia_cod|Cusco, Cusco, Cusco|2026-11-26]",
      modalidadPago: "contraentrega",
      ciudad: "Cusco",
    });
    expect(d?.zona).toBe("provincia_cod");
    expect(d?.modalidadPago).toBe("contraentrega");
  });
});

describe("Llamadas inmediatas con IA (ElevenLabs + Twilio) según decisión de AliClik", () => {
  it("arma guion COD_DOMICILIO sin adelanto ni Shalom cuando AliClik dio cobertura (esAgencia=false)", () => {
    const vars = construirVariablesLlamadaPedido({
      pedidoId: "ped-1190",
      numeroOrden: "#1190",
      contactId: "cont-1",
      nombreCliente: "Daniel Quispe",
      telefono: "+51914306439",
      productosTexto: "1x NAC600 + NAD+",
      totalSoles: 119,
      ciudad: "Cusco",
      distrito: "Santiago",
      direccion: "Jr. Vilcabamba 109",
      dni: null,
      esAgencia: false,
      modalidadEntregaTexto: "Contraentrega Domicilio AliClik (Cusco)",
    });

    expect(vars.modalidad).toBe("COD_DOMICILIO");
    expect(vars.adelanto_soles).toBe("0");
    expect(vars.saludo_inicial).toContain("Hola, Daniel");
    expect(vars.saludo_inicial).toContain("pagas al recibir");
    expect(vars.saludo_inicial).toContain("Jirón Vilcabamba 109");
    expect(vars.instrucciones_especificas).toContain("PROHIBIDO pedir adelanto de S/ 20");
    expect(vars.datos_faltantes_pedir).toContain("referencia");
  });

  it("arma guion AGENCIA_SHALOM con sedes cercanas, DNI y adelanto de S/20 cuando no hay cobertura COD (esAgencia=true)", () => {
    const vars = construirVariablesLlamadaPedido({
      pedidoId: "ped-1191",
      numeroOrden: "#1191",
      contactId: "cont-2",
      nombreCliente: "María Flores",
      telefono: "+51987654321",
      productosTexto: "3x NAC600 + NAD+",
      totalSoles: 199,
      ciudad: "Pucallpa",
      distrito: null,
      direccion: "Av. Centenario",
      dni: null,
      esAgencia: true,
      modalidadEntregaTexto: "Agencia Shalom / Olva (Provincia)",
    });

    expect(vars.modalidad).toBe("AGENCIA_SHALOM");
    expect(vars.adelanto_soles).toBe("20");
    expect(vars.saldo_soles).toBe("179");
    expect(vars.agencias_shalom_cercanas).toBeTruthy();
    expect(vars.instrucciones_especificas).toContain("951 365 418");
    expect(vars.datos_faltantes_pedir).toContain("DNI de 8 dígitos");
  });
  it("respeta el horario comercial de 7:00 a. m. a 10:00 p. m. hora Lima (UTC-5)", () => {
    // 06:59 Lima = 11:59 UTC -> fuera de horario
    expect(dentroHorarioLlamadaIA(new Date("2026-11-26T11:59:00Z"))).toBe(false);
    // 07:00 Lima = 12:00 UTC -> dentro de horario
    expect(dentroHorarioLlamadaIA(new Date("2026-11-26T12:00:00Z"))).toBe(true);
    // 21:59 Lima = 02:59 UTC del día siguiente -> dentro de horario
    expect(dentroHorarioLlamadaIA(new Date("2026-11-27T02:59:00Z"))).toBe(true);
    // 22:00 Lima = 03:00 UTC del día siguiente -> fuera de horario
    expect(dentroHorarioLlamadaIA(new Date("2026-11-27T03:00:00Z"))).toBe(false);
  });

  it("formatea los productos de forma natural para lectura por voz", () => {
    expect(formatearProductoParaVoz("3x NAC600 + NAD+ (60 cápsulas)")).toBe("3 frascos de NAC seiscientos");
    expect(formatearProductoParaVoz("1x NAC600 + NAD+")).toBe("un frasco de NAC seiscientos");
    expect(formatearProductoParaVoz("2x Termix Tobillera")).toBe("2 tobilleras Termix");
  });
});

describe("Extracción post-llamada (/api/webhooks/voice-ai)", () => {
  it("extrae referencia, horario y confirmación de una llamada COD atendida", () => {
    const res = analizarPayloadPostLlamada({
      data: {
        conversation_id: "conv_123",
        metadata: { call_duration_secs: 48 },
        transcript: [
          { role: "agent", message: "¡Hola, Daniel! Te llamo de Aliv Perú para confirmar tu pedido #1190..." },
          {
            role: "user",
            message: "Sí señorita, claro que lo confirmo. Mi casa es frente al colegio San José, puerta marrón, estoy en la mañana de 9 a 1.",
          },
        ],
        analysis: {
          transcript_summary: "El cliente confirmó su pedido y dio referencia y horario.",
          data_collection_results: {
            confirmado: { value: "true" },
            referencia_domicilio: { value: "Frente al colegio San José, puerta marrón" },
            horario_entrega: { value: "En la mañana de 9 a 1 pm" },
          },
        },
      },
    });

    expect(res.contestada).toBe(true);
    expect(res.estadoConfirmacion).toBe("confirmado");
    expect(res.referenciaDomicilio).toBe("Frente al colegio San José, puerta marrón");
    expect(res.horarioEntrega).toBe("En la mañana de 9 a 1 pm");
  });

  it("extrae DNI de 8 dígitos de la transcripción aunque el cliente lo dicte separado", () => {
    const res = analizarPayloadPostLlamada(
      {
        data: {
          conversation_id: "conv_456",
          metadata: { call_duration_secs: 55 },
          transcript: [
            { role: "agent", message: "¿Me dictas tu DNI y qué agencia Shalom prefieres?" },
            { role: "user", message: "Sí claro, mi DNI es 45 89 21 03 y ahorita te mando el Yape." },
          ],
        },
      },
      "Cusco"
    );

    expect(res.contestada).toBe(true);
    expect(res.dniExtraido).toBe("45892103");
    expect(res.compromisoAdelantoYape).toBe(true);
  });

  it("extrae datos incluso cuando ElevenLabs V2 usa claves aitem_... con name interno y espacios", () => {
    const res = analizarPayloadPostLlamada({
      data: {
        conversation_id: "conv_6001m8ccpsc3fxkt64qcgepz1t72",
        metadata: { call_duration_secs: 61 },
        transcript: [
          { role: "agent", message: "¡Hola, Gerardo! ..." },
          { role: "user", message: "Sí." },
          { role: "agent", message: "¿Me das una referencia de tu casa?" },
          { role: "user", message: "Frente a Molycentro." },
          { role: "agent", message: "¿Qué día y en qué horario estarás?" },
          { role: "user", message: "Mañana, eh, 4:00 p.m." },
        ],
        analysis: {
          data_collection_results: {
            aitem_5101m8c5wsgfewcar94974k07xke: {
              name: "confirmado ",
              value: true,
            },
            aitem_7901m8c5xv7se0gt1vm1fjrdjdqf: {
              name: "referencia_domicilio",
              value: "Frente a Molycentro",
            },
            aitem_2201m8cap3a3fd2s1rn1nww179ck: {
              name: "horario_entrega",
              value: "Mañana 4:00 p.m.",
            },
          },
        },
      },
    });

    expect(res.contestada).toBe(true);
    expect(res.estadoConfirmacion).toBe("confirmado");
    expect(res.referenciaDomicilio).toBe("Frente a Molycentro");
    expect(res.horarioEntrega).toBe("Mañana 4:00 p.m.");
  });

  it("detecta cuando el cliente no contestó la llamada", () => {
    const res = analizarPayloadPostLlamada({
      data: {
        conversation_id: "conv_789",
        metadata: { call_duration_secs: 0 },
        transcript: [],
      },
    });

    expect(res.contestada).toBe(false);
    expect(res.estadoConfirmacion).toBe("no_contesto");
  });
});
