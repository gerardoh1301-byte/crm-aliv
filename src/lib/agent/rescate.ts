import "server-only";
import { db } from "@/db";
import { activities, contacts, conversations, deals, messages, pipelineStages } from "@/db/schema";
import { and, desc, eq, gte, lte } from "drizzle-orm";
import { getConfig } from "@/lib/config";
import { deliverMessage } from "@/lib/channels/deliver";
import { aplicarEtiquetaAContacto } from "./etiquetado";
import { pedidosOrdenes } from "../../../modules/pedidos/tabla";
import { esPedidoDeProvincia } from "@/lib/pedidos/adelanto";

export type TipoEscenarioRescate = "direccion_incompleta" | "adelanto_provincia" | "cotizacion_abandonada";

export interface ContextoChatParaAuditoria {
  contact: {
    id: string;
    name: string;
    phone: string | null;
    tags: string[] | null;
    customFields?: Record<string, unknown> | null;
  };
  conversation: {
    id: string;
    lastMessageAt: Date | string | null;
    channel: string;
  };
  ultimoMensaje: {
    direction: string;
    body: string | null;
    createdAt?: Date | string | null;
  } | null;
  historialMensajes?: Array<{
    direction: string;
    body: string | null;
    createdAt?: Date | string | null;
  }>;
  pedidoReciente?: {
    numeroOrden?: string | null;
    total?: string | number | null;
    direccionEnvio?: string | null;
    ciudad?: string | null;
    distrito?: string | null;
    items?: unknown;
  } | null;
}

export interface ResultadoAuditoriaRescate {
  esElegible: boolean;
  motivoDescarte?: string;
  escenario?: TipoEscenarioRescate;
  mensajeRescate?: string;
}

/**
 * Detecta con máxima precisión el producto principal de la conversación,
 * priorizando el texto real de los mensajes intercambiados sobre las etiquetas
 * (evitando falsos cruces si el contacto recibió un pitch de cross-sell de otro producto).
 */
export function detectarProductoRescate(contexto: ContextoChatParaAuditoria): "nac600" | "termix" {
  const { contact, ultimoMensaje, pedidoReciente, historialMensajes } = contexto;
  const tags = (contact.tags ?? []).map((t) => t.toLowerCase().trim());

  // 1. Si hay un pedido en base de datos con items explícitos
  const itemsStr = JSON.stringify(pedidoReciente?.items ?? "").toLowerCase();
  if (itemsStr.includes("termix") || itemsStr.includes("tobillera")) return "termix";
  if (itemsStr.includes("nac") || itemsStr.includes("glutation") || itemsStr.includes("frasco")) return "nac600";

  // 2. Analizar el historial de mensajes de la conversación (últimos mensajes del bot y cliente)
  const mensajesTexto = [
    ultimoMensaje?.body ?? "",
    ...(historialMensajes ?? []).map((m) => m.body ?? ""),
  ]
    .join(" ")
    .toLowerCase();

  const nacMatches = (
    mensajesTexto.match(/\b(nac|nac600|glutation|frasco|frascos|c[aá]psulas?|h[ií]gado|antioxidante|nad\+?)\b/gi) || []
  ).length;
  const termixMatches = (
    mensajesTexto.match(/\b(termix|tobillera|tobillo|tobillos|grafeno|masaje)\b/gi) || []
  ).length;

  // Si hay menciones en el historial, la conversación manda sobre las etiquetas
  if (nacMatches > 0 && nacMatches >= termixMatches) {
    return "nac600";
  }
  if (termixMatches > 0 && termixMatches > nacMatches) {
    return "termix";
  }

  // 3. Desempate por etiquetas solo si no se mencionó ninguno en el historial
  const tieneTagNac = tags.some((t) => t.includes("nac"));
  const tieneTagTermix = tags.some((t) => t.includes("termix") || t.includes("tobillera"));

  if (tieneTagNac && !tieneTagTermix) return "nac600";
  if (tieneTagTermix && !tieneTagNac) return "termix";

  // Si tiene ambos o ninguno, por defecto en Aliv Perú es nac600
  return "nac600";
}

/**
 * Verifica si la hora actual está dentro del horario seguro para enviar
 * mensajes de rescate (08:30 a 19:30 en hora de Perú).
 */
export function esHorarioPermitidoRescate(
  ahora: Date = new Date(),
  zonaHoraria: string = "America/Lima"
): boolean {
  try {
    const formateador = new Intl.DateTimeFormat("en-US", {
      timeZone: zonaHoraria,
      hour: "numeric",
      minute: "numeric",
      hour12: false,
    });
    const partes = formateador.formatToParts(ahora);
    const hora = parseInt(partes.find((p) => p.type === "hour")?.value ?? "0", 10);
    const minuto = parseInt(partes.find((p) => p.type === "minute")?.value ?? "0", 10);
    const decimal = hora + minuto / 60;
    return decimal >= 8.5 && decimal <= 19.5;
  } catch {
    return true;
  }
}

/**
 * Función pura que audita los datos de una conversación y decide si amerita
 * rescate y qué mensaje enviar.
 */
export function determinarEscenarioRescate(
  contexto: ContextoChatParaAuditoria,
  ahora: Date = new Date()
): ResultadoAuditoriaRescate {
  const { contact, conversation, ultimoMensaje, pedidoReciente, historialMensajes } = contexto;
  const tags = contact.tags ?? [];

  // 1. Validar etiquetas excluyentes
  const tagsExcluyentes = ["no-reactivar", "cancelado", "compra exitosa", "orden en camino", "rescate_enviado"];
  const tieneExcluyente = tags.some((t) => tagsExcluyentes.includes(t.toLowerCase().trim()));
  if (tieneExcluyente) {
    return { esElegible: false, motivoDescarte: "Contacto con etiqueta de cierre o ya rescatado" };
  }

  // 2. Validar que el último mensaje fue saliente (el bot o asesor preguntó y el cliente no respondió)
  if (!ultimoMensaje || ultimoMensaje.direction !== "out") {
    return { esElegible: false, motivoDescarte: "Último mensaje no fue saliente o el cliente ya respondió" };
  }

  // 3. Validar ventana de tiempo (entre 2 y 22 horas desde el último mensaje)
  const fechaUltimo = conversation.lastMessageAt ? new Date(conversation.lastMessageAt) : null;
  if (!fechaUltimo || isNaN(fechaUltimo.getTime())) {
    return { esElegible: false, motivoDescarte: "Sin fecha de último mensaje válida" };
  }

  const horasTranscurridas = (ahora.getTime() - fechaUltimo.getTime()) / (1000 * 60 * 60);
  if (horasTranscurridas < 2) {
    return { esElegible: false, motivoDescarte: `Solo han pasado ${horasTranscurridas.toFixed(1)}h (mínimo 2h)` };
  }
  if (horasTranscurridas > 22) {
    return { esElegible: false, motivoDescarte: `Han pasado ${horasTranscurridas.toFixed(1)}h (fuera de ventana segura 22h)` };
  }

  const nombre = (contact.name || "hola").split(" ")[0].trim();
  const nombreLimpio = nombre && nombre.toLowerCase() !== "desconocido" && nombre.toLowerCase() !== "lead" ? nombre : "";
  const saludo = nombreLimpio ? `¡Hola ${nombreLimpio}!` : "¡Hola!";

  const bodyUltimo = (ultimoMensaje.body || "").toLowerCase();

  // Historial acumulado para entender la conversación completa
  const textosHistorial = [
    ultimoMensaje.body || "",
    ...(historialMensajes || []).map((m) => m.body || ""),
  ]
    .join(" ")
    .toLowerCase();

  // Determinar producto de interés real
  const productoPrincipal = detectarProductoRescate(contexto);
  const esTermix = productoPrincipal === "termix";
  const nombreProducto = esTermix ? "la Tobillera Termix" : "NAC600 + NAD+";

  // ESCENARIO A: Dirección Incompleta o Datos de Despacho Pendientes
  // Caso 1: Pedido web con dirección incompleta (caso Laura)
  const direccion = (pedidoReciente?.direccionEnvio || "").trim();
  const direccionCortaOIncompleta =
    direccion.length > 0 &&
    (direccion.length < 15 || !/\d/.test(direccion) || /calle \d+\s*(?:san)?$/i.test(direccion));

  const botPreguntoPorDireccion =
    /\b(direcci[oó]n|calle|referencia|ubicaci[oó]n|n[uú]mero de tu calle|agendar la orden|programar el despacho|dejar registrado tu pedido|dejamos agendado|tu nombre completo)\b/i.test(
      bodyUltimo
    ) ||
    /\b(direcci[oó]n exacta|conf[ií]rmame tu nombre completo|cu[aá]l es tu direcci[oó]n|ubicaci[oó]n mucho mejor)\b/i.test(
      textosHistorial
    );

  if (pedidoReciente && (direccionCortaOIncompleta || botPreguntoPorDireccion)) {
    const ordenTxt = pedidoReciente.numeroOrden ? `#${pedidoReciente.numeroOrden} ` : "";
    return {
      esElegible: true,
      escenario: "direccion_incompleta",
      mensajeRescate: `${saludo} Te saluda Aliv Perú 🌿. Tu pedido ${ordenTxt}de ${nombreProducto} está separado y listo para embalar 📦. Solo nos falta confirmar el número de tu calle o una referencia para programar la entrega a tu puerta. ¿Nos confirmas tu dirección completa o nos compartes tu ubicación por aquí? 📍`,
    };
  }

  // Caso 2: Cierre en chat donde el cliente acordó un pack pero quedó pendiente su dirección o nombre completo (caso DJ Zeta)
  if (!pedidoReciente && botPreguntoPorDireccion) {
    let detallePack = esTermix ? "tu Tobillera Termix" : "tu pedido de NAC600 + NAD+";
    if (esTermix) {
      if (/\b(3\s*(?:tobilleras?|unidades?)|pack\s*(?:de\s*)?3|189)\b/i.test(textosHistorial)) {
        detallePack = "tus 3 Tobilleras Termix";
      } else if (/\b(2\s*(?:tobilleras?|unidades?)|pack\s*(?:de\s*)?2|139)\b/i.test(textosHistorial)) {
        detallePack = "tu promo de 2 Tobilleras Termix";
      } else if (/\b(1\s*(?:tobillera|unidad)|79)\b/i.test(textosHistorial)) {
        detallePack = "tu Tobillera Termix";
      }
    } else {
      if (/\b(3\s*frascos?|pack\s*(?:de\s*)?3|199)\b/i.test(textosHistorial)) {
        detallePack = "tus 3 frascos de NAC600 + NAD+";
      } else if (/\b(2\s*frascos?|pack\s*(?:de\s*)?2|169)\b/i.test(textosHistorial)) {
        detallePack = "tus 2 frascos de NAC600 + NAD+";
      } else if (/\b(1\s*frasco|119)\b/i.test(textosHistorial)) {
        detallePack = "tu frasco de NAC600 + NAD+";
      }
    }

    // Detectar distrito mencionado si existe
    const matchDistrito = textosHistorial.match(
      /\b(carabayllo|comas|los olivos|san mart[ií]n|independencia|san miguel|magdalena|jes[uú]s mar[ií]a|pueblo libre|surco|miraflores|san borja|san isidro|la molina|ate|chorrillos|san juan de lurigancho|sjl|sjm|villa el salvador|ves|callao|bellavista|ventanilla)\b/i
    );
    const destinoTxt = matchDistrito
      ? ` a ${matchDistrito[1].charAt(0).toUpperCase() + matchDistrito[1].slice(1).toLowerCase()}`
      : "";

    return {
      esElegible: true,
      escenario: "direccion_incompleta",
      mensajeRescate: `${saludo} Te saluda Aliv Perú 🌿. Tenemos ${detallePack} separado y listo para programar tu entrega${destinoTxt}. Solo nos falta que nos confirmes tu nombre completo y dirección exacta (calle y número o referencia) para dejar tu despacho agendado. Si te es más fácil, ¿nos puedes compartir tu ubicación por aquí? 📍`,
    };
  }

  // ESCENARIO B: Freno por Adelanto en Provincia (caso Carlos)
  const esProvincia =
    tags.includes("Pendiente de adelanto") ||
    (pedidoReciente &&
      esPedidoDeProvincia({
        ciudad: pedidoReciente.ciudad ?? null,
        distrito: pedidoReciente.distrito ?? null,
        direccionEnvio: pedidoReciente.direccionEnvio ?? null,
      })) ||
    /\b(adelanto|yape\s+951365418|shalom|provincia)\b/i.test(textosHistorial);

  if (esProvincia) {
    let totalNum = 199;
    if (pedidoReciente?.total) {
      totalNum = Number(pedidoReciente.total);
    } else if (esTermix) {
      totalNum = /\b(3\s*(?:tobilleras?|unidades?)|189)\b/i.test(textosHistorial)
        ? 189
        : /\b(79|1\s*(?:tobillera|unidad))\b/i.test(textosHistorial)
          ? 79
          : 139;
    } else {
      totalNum = /\b(1\s*frasco|119)\b/i.test(textosHistorial)
        ? 119
        : /\b(2\s*frascos?|169)\b/i.test(textosHistorial)
          ? 169
          : 199;
    }
    const saldo = Math.max(totalNum - 20, 0);
    return {
      esElegible: true,
      escenario: "adelanto_provincia",
      mensajeRescate: `${saludo} Quería darte la tranquilidad de que somos Aliv Perú (RUC 20612283134) y despachamos a diario por Shalom con 30 días de garantía a todo el país. Los S/20 son solo para generar tu guía oficial de Shalom; el saldo restante de S/${saldo} lo pagas recién al verificar tu paquete en la misma agencia. ¿A qué agencia Shalom te quedaría más cómodo recibirlo?`,
    };
  }

  // ESCENARIO C: Cotización / Información sin respuesta
  if (esTermix) {
    return {
      esElegible: true,
      escenario: "cotizacion_abandonada",
      mensajeRescate: `${saludo} Quería saber si tuviste oportunidad de revisar los detalles de la Tobillera Termix ✨. Recuerda que incluye calor constante de grafeno, masaje por vibración y 30 días de garantía con envío gratis. ¿Te gustaría aprovechar la promo de 2 por S/139 o prefieres empezar con 1 por S/79?`,
    };
  }

  return {
    esElegible: true,
    escenario: "cotizacion_abandonada",
    mensajeRescate: `${saludo} Quería saber si tuviste oportunidad de revisar la información de NAC600 + NAD+ ✨. Recuerda que tenemos envío gratis con pago al recibir en Lima y 30 días de garantía. ¿Te gustaría empezar con 1 frasco de S/119 o prefieres aprovechar la promo de 3 por S/199?`,
  };
}

/**
 * Ejecuta el barrido de auditoría sobre todas las conversaciones candidatas en la base de datos.
 */
export async function auditarChatsAbandonados(opts?: { limite?: number; forzarHorario?: boolean }): Promise<{
  procesados: number;
  rescatados: number;
  detalles: Array<{ contactId: string; phone: string | null; escenario: string; mensaje: string }>;
}> {
  const limite = opts?.limite ?? 10;
  const forzarHorario = opts?.forzarHorario ?? false;
  const ahora = new Date();

  // Validar horario comercial de Perú
  if (!forzarHorario && !esHorarioPermitidoRescate(ahora, getConfig().zonaHoraria)) {
    return { procesados: 0, rescatados: 0, detalles: [] };
  }

  // Ventana de 2h a 22h atrás
  const hace2Horas = new Date(ahora.getTime() - 2 * 60 * 60 * 1000);
  const hace22Horas = new Date(ahora.getTime() - 22 * 60 * 60 * 1000);

  // Buscar conversaciones activas dentro de la ventana con IA activa
  const candidatas = await db
    .select({
      convId: conversations.id,
      channel: conversations.channel,
      lastMessageAt: conversations.lastMessageAt,
      contactId: contacts.id,
      contactName: contacts.name,
      contactPhone: contacts.phone,
      contactTags: contacts.tags,
      contactFields: contacts.customFields,
    })
    .from(conversations)
    .innerJoin(contacts, eq(conversations.contactId, contacts.id))
    .where(
      and(
        eq(conversations.aiEnabled, true),
        eq(contacts.aiEnabled, true),
        eq(conversations.channel, "whatsapp"),
        lte(conversations.lastMessageAt, hace2Horas),
        gte(conversations.lastMessageAt, hace22Horas)
      )
    )
    .orderBy(desc(conversations.lastMessageAt))
    .limit(limite * 2);

  let rescatados = 0;
  const detalles: Array<{ contactId: string; phone: string | null; escenario: string; mensaje: string }> = [];

  for (const c of candidatas) {
    if (rescatados >= limite) break;

    // Obtener los últimos mensajes de la conversación para evaluar el contexto completo
    const ultimosMensajes = await db
      .select({
        direction: messages.direction,
        body: messages.body,
        createdAt: messages.createdAt,
      })
      .from(messages)
      .where(eq(messages.conversationId, c.convId))
      .orderBy(desc(messages.createdAt))
      .limit(8);

    const ultimoMsg = ultimosMensajes[0] ?? null;

    // Obtener pedido más reciente si existe
    const [pedido] = await db
      .select({
        numeroOrden: pedidosOrdenes.numeroOrden,
        total: pedidosOrdenes.total,
        direccionEnvio: pedidosOrdenes.direccionEnvio,
        ciudad: pedidosOrdenes.ciudad,
        distrito: pedidosOrdenes.distrito,
        items: pedidosOrdenes.items,
      })
      .from(pedidosOrdenes)
      .where(eq(pedidosOrdenes.contactId, c.contactId))
      .orderBy(desc(pedidosOrdenes.createdAt))
      .limit(1);

    const contexto: ContextoChatParaAuditoria = {
      contact: {
        id: c.contactId,
        name: c.contactName,
        phone: c.contactPhone,
        tags: c.contactTags,
        customFields: c.contactFields as Record<string, unknown> | null,
      },
      conversation: {
        id: c.convId,
        lastMessageAt: c.lastMessageAt,
        channel: c.channel,
      },
      ultimoMensaje: ultimoMsg ?? null,
      historialMensajes: ultimosMensajes,
      pedidoReciente: pedido ?? null,
    };

    const evaluacion = determinarEscenarioRescate(contexto, ahora);
    if (!evaluacion.esElegible || !evaluacion.mensajeRescate || !evaluacion.escenario) {
      continue;
    }

    // Entregar mensaje oficial de rescate
    const entrega = await deliverMessage(c.convId, { text: evaluacion.mensajeRescate }, "agent");
    if (entrega.ok) {
      rescatados++;
      // Aplicar etiqueta 'rescate_enviado' para evitar duplicidad
      await aplicarEtiquetaAContacto({
        contactId: c.contactId,
        etiqueta: "rescate_enviado",
        accion: "agregar",
        motivo: `Rescate de chat abandonado (${evaluacion.escenario})`,
      });

      // Registrar nota en la ficha
      try {
        await db.insert(activities).values({
          type: "note",
          description: `[RESCATE VENTAS] Mensaje enviado automáticamente para recuperar venta abandonada (${evaluacion.escenario}).`,
          contactId: c.contactId,
        });
      } catch (actErr) {
        console.warn("[rescate] Error registrando actividad:", actErr);
      }

      detalles.push({
        contactId: c.contactId,
        phone: c.contactPhone,
        escenario: evaluacion.escenario,
        mensaje: evaluacion.mensajeRescate,
      });
    }
  }

  return {
    procesados: candidatas.length,
    rescatados,
    detalles,
  };
}
