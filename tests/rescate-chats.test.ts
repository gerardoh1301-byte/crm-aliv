import { describe, it, expect } from "vitest";
import { determinarEscenarioRescate, esHorarioPermitidoRescate, ContextoChatParaAuditoria } from "@/lib/agent/rescate";

describe("Auditoría y Rescate de Chats Abandonados", () => {
  const ahora = new Date("2026-11-14T15:00:00Z"); // 10:00 AM hora de Lima

  it("Escenario A: detecta dirección incompleta de pedido web (caso Laura)", () => {
    const contexto: ContextoChatParaAuditoria = {
      contact: {
        id: "c-1",
        name: "Laura",
        phone: "+51993219399",
        tags: ["shopify", "easysell_cod", "interes:nac600"],
      },
      conversation: {
        id: "conv-1",
        lastMessageAt: new Date(ahora.getTime() - 3 * 60 * 60 * 1000), // Hace 3 horas
        channel: "whatsapp",
      },
      ultimoMensaje: {
        direction: "out",
        body: "En la dirección nos llegó solo 'Calle 11 san'. ¿Nos envías tu dirección completa?",
      },
      pedidoReciente: {
        numeroOrden: "1071",
        total: 199,
        direccionEnvio: "Calle 11 san",
        ciudad: "Lima",
        distrito: "Lima",
        items: [{ titulo: "3x NAC600" }],
      },
    };

    const res = determinarEscenarioRescate(contexto, ahora);
    expect(res.esElegible).toBe(true);
    expect(res.escenario).toBe("direccion_incompleta");
    expect(res.mensajeRescate).toContain("pedido #1071");
    expect(res.mensajeRescate).toContain("número de tu calle o una referencia");
  });

  it("Escenario B: detecta freno por adelanto en provincia Shalom (caso Carlos)", () => {
    const contexto: ContextoChatParaAuditoria = {
      contact: {
        id: "c-2",
        name: "Carlos",
        phone: "+51986990204",
        tags: ["Pendiente de adelanto", "interes:nac600"],
      },
      conversation: {
        id: "conv-2",
        lastMessageAt: new Date(ahora.getTime() - 4 * 60 * 60 * 1000), // Hace 4 horas
        channel: "whatsapp",
      },
      ultimoMensaje: {
        direction: "out",
        body: "Para despachar se necesita un adelanto de S/20 (Yape 951365418 - Gerardo Huaynalaya) y el saldo de S/179 al recoger.",
      },
      pedidoReciente: {
        numeroOrden: "1075",
        total: 199,
        ciudad: "Arequipa",
        distrito: "Arequipa",
      },
    };

    const res = determinarEscenarioRescate(contexto, ahora);
    expect(res.esElegible).toBe(true);
    expect(res.escenario).toBe("adelanto_provincia");
    expect(res.mensajeRescate).toContain("RUC 20612283134");
    expect(res.mensajeRescate).toContain("S/179");
    expect(res.mensajeRescate).toContain("agencia Shalom");
  });

  it("Escenario C: cotización abandonada para Termix Tobillera", () => {
    const contexto: ContextoChatParaAuditoria = {
      contact: {
        id: "c-3",
        name: "Berta",
        phone: "+51912345678",
        tags: ["Informativo", "interes:termix"],
      },
      conversation: {
        id: "conv-3",
        lastMessageAt: new Date(ahora.getTime() - 3.5 * 60 * 60 * 1000), // Hace 3.5 horas
        channel: "whatsapp",
      },
      ultimoMensaje: {
        direction: "out",
        body: "La Termix Tobillera sale 1 por S/79 o 2 por S/139. ¿Te gustaría para ti o para regalar?",
      },
    };

    const res = determinarEscenarioRescate(contexto, ahora);
    expect(res.esElegible).toBe(true);
    expect(res.escenario).toBe("cotizacion_abandonada");
    expect(res.mensajeRescate).toContain("Tobillera Termix");
    expect(res.mensajeRescate).toContain("2 por S/139");
  });

  it("descarta si el cliente ya respondió (último mensaje entrante)", () => {
    const contexto: ContextoChatParaAuditoria = {
      contact: { id: "c-4", name: "Juan", phone: "+51999999999", tags: [] },
      conversation: {
        id: "conv-4",
        lastMessageAt: new Date(ahora.getTime() - 3 * 60 * 60 * 1000),
        channel: "whatsapp",
      },
      ultimoMensaje: {
        direction: "in",
        body: "Ya hice el depósito",
      },
    };

    const res = determinarEscenarioRescate(contexto, ahora);
    expect(res.esElegible).toBe(false);
    expect(res.motivoDescarte).toContain("Último mensaje no fue saliente");
  });

  it("descarta si ya se envió un rescate previo ('rescate_enviado')", () => {
    const contexto: ContextoChatParaAuditoria = {
      contact: { id: "c-5", name: "Pedro", phone: "+51988888888", tags: ["rescate_enviado"] },
      conversation: {
        id: "conv-5",
        lastMessageAt: new Date(ahora.getTime() - 5 * 60 * 60 * 1000),
        channel: "whatsapp",
      },
      ultimoMensaje: {
        direction: "out",
        body: "Cualquier duda quedamos atentos.",
      },
    };

    const res = determinarEscenarioRescate(contexto, ahora);
    expect(res.esElegible).toBe(false);
    expect(res.motivoDescarte).toContain("Contacto con etiqueta de cierre o ya rescatado");
  });

  it("descarta si han pasado menos de 2 horas (muy temprano)", () => {
    const contexto: ContextoChatParaAuditoria = {
      contact: { id: "c-6", name: "Ana", phone: "+51977777777", tags: [] },
      conversation: {
        id: "conv-6",
        lastMessageAt: new Date(ahora.getTime() - 45 * 60 * 1000), // Hace 45 minutos
        channel: "whatsapp",
      },
      ultimoMensaje: {
        direction: "out",
        body: "Precios: 1x S/119",
      },
    };

    const res = determinarEscenarioRescate(contexto, ahora);
    expect(res.esElegible).toBe(false);
    expect(res.motivoDescarte).toContain("mínimo 2h");
  });

  it("valida horario permitido de rescate (08:30 a 19:30 Lima)", () => {
    // 09:00 AM Lima = permitido
    expect(esHorarioPermitidoRescate(new Date("2026-11-14T14:00:00Z"), "America/Lima")).toBe(true);
    // 11:00 PM Lima = bloqueado
    expect(esHorarioPermitidoRescate(new Date("2026-11-14T04:00:00Z"), "America/Lima")).toBe(false);
    // 07:00 AM Lima = bloqueado
    expect(esHorarioPermitidoRescate(new Date("2026-11-14T12:00:00Z"), "America/Lima")).toBe(false);
  });
});
