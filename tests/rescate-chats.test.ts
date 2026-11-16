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
    expect(res.mensajeRescate).toContain("clave secreta");
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

  it("CASO DJ ZETA: Cierre de NAC600 en chat pendiente de dirección no debe cruzar a Tobillera", () => {
    const contexto: ContextoChatParaAuditoria = {
      contact: {
        id: "c-dj",
        name: "DJ ZETA",
        phone: "+1963299384",
        // El contacto pudo recibir pitch previo de termix o tener ambas etiquetas
        tags: ["interes:nac600", "interes:termix"],
      },
      conversation: {
        id: "conv-dj",
        lastMessageAt: new Date(ahora.getTime() - 2.5 * 60 * 60 * 1000), // Hace 2.5 horas
        channel: "whatsapp",
      },
      ultimoMensaje: {
        direction: "out",
        body: "por favor confirmame tu dirección exacta, si puedes enviarme la ubicación mucho mejor para poder agendar la orden.",
      },
      historialMensajes: [
        {
          direction: "out",
          body: "por favor confirmame tu dirección exacta, si puedes enviarme la ubicación mucho mejor para poder agendar la orden.",
        },
        {
          direction: "out",
          body: "¡Llegaría el lunes a la dirección exacta que nos indiques! 📦 Para poder registrarlo y dejarlo listo en el sistema, por favor compárteme tu nombre completo y tu dirección exacta con número y referencia en Carabayllo.",
        },
        {
          direction: "in",
          body: "Cuando estaría llegando",
        },
        {
          direction: "out",
          body: "¡Anotado el celular 963299384! Para dejar registrado tu pedido de los 3 frascos de NAC600 + NAD+ por S/199, solo me falta tu nombre completo y tu dirección exacta con número y referencia en Carabayllo.",
        },
        {
          direction: "in",
          body: "Carabayllo",
        },
        {
          direction: "out",
          body: "¡Perfecto, Carabayllo! Te llevas el pack de 3 frascos de NAC600 + NAD+ por S/199 para 90 días de uso constante. ¿Cuál es tu dirección exacta?",
        },
      ],
      // No hay pedido aún en Shopify porque faltaba la dirección exacta
      pedidoReciente: null,
    };

    const res = determinarEscenarioRescate(contexto, ahora);
    expect(res.esElegible).toBe(true);
    expect(res.escenario).toBe("direccion_incompleta");
    // Debe hablar de NAC600 y los 3 frascos
    expect(res.mensajeRescate).toContain("3 frascos de NAC600 + NAD+");
    expect(res.mensajeRescate).toContain("Carabayllo");
    expect(res.mensajeRescate).toContain("este lunes");
    expect(res.mensajeRescate).toContain("dirección exacta");
    // JAMÁS debe hablar de Tobillera Termix
    expect(res.mensajeRescate).not.toContain("Tobillera");
    expect(res.mensajeRescate).not.toContain("Termix");
  });

  it("CASO JOSÉ (+51 998 283 493): Descarte por pedido ya agendado con motorizado y despedida cordial", () => {
    const contexto: ContextoChatParaAuditoria = {
      contact: {
        id: "c-jose",
        name: "José",
        phone: "+51998283493",
        tags: ["cliente", "interes:nac600"],
      },
      conversation: {
        id: "conv-jose",
        lastMessageAt: new Date(ahora.getTime() - 2.5 * 60 * 60 * 1000), // Hace 2.5 horas
        channel: "whatsapp",
      },
      ultimoMensaje: {
        direction: "out",
        body: "¡A ti, José! Que tengas un excelente día. Quedamos a tu disposición para cualquier consulta. ⭐",
      },
      historialMensajes: [
        {
          direction: "out",
          body: "¡A ti, José! Que tengas un excelente día. Quedamos a tu disposición para cualquier consulta. ⭐",
        },
        {
          direction: "in",
          body: "No listo gracias",
        },
        {
          direction: "out",
          body: "Así es, José, de preferencia con el desayuno. ¿Te queda alguna otra duda sobre tus cápsulas de NAC600?",
        },
        {
          direction: "in",
          body: "Después del desayuno cierto",
        },
        {
          direction: "out",
          body: "¡Claro que sí, José! No te preocupes, ya le indiqué expresamente al motorizado que te mande un mensaje por WhatsApp apenas esté llegando este sábado de 8 a 4 a tu domicilio en Lurigancho Chosica. ¿Te queda alguna otra duda sobre tus cápsulas de NAC600? NAC600 es un complemento alimenticio... Se toman 2 cápsulas al día con agua, de preferencia con el desayuno. Un frasco trae 60 cápsulas y rinde 30 días.",
        },
        {
          direction: "in",
          body: "Q le Escriba Al llegar x fvsor",
        },
        {
          direction: "out",
          body: "¡Entendido, José! Ya le dejé la indicación exacta al motorizado para que te escriba por WhatsApp apenas esté llegando a tu dirección en Lurigancho Chosica este sábado.",
        },
      ],
      pedidoReciente: null,
    };

    const res = determinarEscenarioRescate(contexto, ahora);
    // JAMÁS debe intentar rescatar a un cliente que ya compró y se despidió cordialmente
    expect(res.esElegible).toBe(false);
    expect(res.motivoDescarte).toMatch(/ya coordinado|concluida cordialmente/i);
    expect(res.mensajeRescate).toBeUndefined();
  });

  it("Descarte por rechazo explícito del cliente ('ya no deseo')", () => {
    const contexto: ContextoChatParaAuditoria = {
      contact: {
        id: "c-rechazo",
        name: "Marcos",
        phone: "+51999887766",
        tags: ["interes:nac600"],
      },
      conversation: {
        id: "conv-rechazo",
        lastMessageAt: new Date(ahora.getTime() - 3 * 60 * 60 * 1000),
        channel: "whatsapp",
      },
      ultimoMensaje: {
        direction: "out",
        body: "Comprendo perfectamente, cualquier cosa estamos para servirle.",
      },
      historialMensajes: [
        {
          direction: "out",
          body: "Comprendo perfectamente, cualquier cosa estamos para servirle.",
        },
        {
          direction: "in",
          body: "Muchas gracias pero ya no deseo, compré en otro lado.",
        },
      ],
    };

    const res = determinarEscenarioRescate(contexto, ahora);
    expect(res.esElegible).toBe(false);
    expect(res.motivoDescarte).toMatch(/no desea continuar/i);
  });

  it("BLINDAJE: Cotización de NAC600 con etiqueta 'interes:termix' residual mantiene rescate de NAC600", () => {
    const contexto: ContextoChatParaAuditoria = {
      contact: {
        id: "c-nac-cot",
        name: "Renato",
        phone: "+51955112233",
        tags: ["interes:nac600", "interes:termix"],
      },
      conversation: {
        id: "conv-nac-cot",
        lastMessageAt: new Date(ahora.getTime() - 3 * 60 * 60 * 1000),
        channel: "whatsapp",
      },
      ultimoMensaje: {
        direction: "out",
        body: "El frasco de NAC600 + NAD+ sale en S/119 y la promo de 3 frascos en S/199 con envío gratis en Lima.",
      },
      historialMensajes: [
        {
          direction: "out",
          body: "El frasco de NAC600 + NAD+ sale en S/119 y la promo de 3 frascos en S/199 con envío gratis en Lima.",
        },
        {
          direction: "in",
          body: "Buenas tardes, información de las cápsulas de NAC600 para el hígado",
        },
      ],
      pedidoReciente: null,
    };

    const res = determinarEscenarioRescate(contexto, ahora);
    expect(res.esElegible).toBe(true);
    expect(res.escenario).toBe("cotizacion_abandonada");
    expect(res.mensajeRescate).toContain("NAC600 + NAD+");
    expect(res.mensajeRescate).toContain("promo de 3 por S/199");
    expect(res.mensajeRescate).not.toContain("Tobillera");
    expect(res.mensajeRescate).not.toContain("Termix");
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
