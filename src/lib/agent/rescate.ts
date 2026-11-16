import "server-only";
import { db } from "@/db";
import { activities, contacts, conversations, deals, messages, pipelineStages } from "@/db/schema";
import { and, desc, eq, gte, lte } from "drizzle-orm";
import { getConfig } from "@/lib/config";
import { deliverMessage } from "@/lib/channels/deliver";
import { aplicarEtiquetaAContacto } from "./etiquetado";
import { pedidosOrdenes } from "../../../modules/pedidos/tabla";
import { esPedidoDeProvincia } from "@/lib/pedidos/adelanto";
import { createChatCompletionWithFallback, hasOpenRouterKey, getAgentModel } from "./openrouter";
import { limpiarFormatoWhatsApp } from "./formato";

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

  // Obtener el último mensaje entrante del cliente para conocer su estado final
  const mensajesCliente = (historialMensajes || []).filter((m) => m.direction === "in");
  const ultimoMsgCliente = mensajesCliente[0] ? (mensajesCliente[0].body || "").toLowerCase() : "";

  // 4. Validar si el pedido YA fue agendado/coordinado con el motorizado o en proceso de despacho (Caso José)
  const pedidoYaAgendado =
    /\b(ya le dej[eé] la indicaci[oó]n|al motorizado|el motorizado|ya tengo registrado tu pedido|ya agendamos tu pedido|pedido agendado|dej[eé] listo tu despacho|apenas est[eé] llegando a tu direcci[oó]n|el equipo validar[aá] tu comprobante y se encargar[aá] de despachar|se encargar[aá] de despachar tus|despacharemos tus|dejar la indicaci[oó]n al motorizado)\b/i.test(
      textosHistorial
    );

  if (pedidoYaAgendado) {
    return {
      esElegible: false,
      motivoDescarte: "Pedido ya coordinado, agendado con motorizado o en proceso de despacho (post-venta activa)",
    };
  }

  // 5. Validar rechazo explícito del cliente (prioridad alta sobre despedidas corteses)
  const clienteRechazo =
    /\b(ya no deseo|no deseo|no gracias|no voy a querer|canc[eé]lalo|muy caro|compr[eé] en otro|ya no me interesa|deja no m[aá]s)\b/i.test(
      ultimoMsgCliente
    );

  if (clienteRechazo) {
    return {
      esElegible: false,
      motivoDescarte: "Cliente indicó explícitamente que no desea continuar la compra",
    };
  }

  // 6. Validar si la conversación concluyó cordialmente con agradecimiento o despedida (Caso José)
  const clienteSeDespidio =
    /\b(no\s+listo\s+gracias|listo\s+gracias|muchas\s+gracias|mil\s+gracias|gracias\s+amig[oa]|todo\s+claro|perfecto\s+gracias|ya\s+est[aá]\s+todo|con\s+eso\s+ser[ií]a\s+todo|no[,.]?\s*listo)\b/i.test(
      ultimoMsgCliente
    ) || /^(ok|gracias|muchas gracias|ok gracias|ok listo|listo gracias|idem)[.!]?$/i.test(ultimoMsgCliente.trim());

  const botSeDespidio =
    /\b(a ti|un excelente d[ií]a|a la orden|quedamos a tu disposici[oó]n|un gusto|buenas tardes|buenas noches|buen d[ií]a|a tu servicio|con gusto)\b/i.test(
      bodyUltimo
    );

  if (clienteSeDespidio || (clienteSeDespidio && botSeDespidio)) {
    return {
      esElegible: false,
      motivoDescarte: "Conversación concluida cordialmente con despedida/agradecimiento",
    };
  }

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

    // Detectar si se conversó un día de entrega específico (ej. lunes)
    const matchDia = textosHistorial.match(
      /\bllegar[ií]a el\s+(lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado)\b/i
    );
    const diaTxt = matchDia ? ` este ${matchDia[1].toLowerCase()}` : "";

    return {
      esElegible: true,
      escenario: "direccion_incompleta",
      mensajeRescate: `${saludo} Te saluda Aliv Perú 🌿. Quería confirmarte que tenemos ${detallePack} separados para coordinar tu entrega${destinoTxt}${diaTxt}. Solo nos falta que nos confirmes tu nombre completo y dirección exacta (calle y número o referencia) para dejar tu orden agendada con el motorizado. Si te es más fácil, ¿nos puedes compartir tu ubicación por aquí? 📍`,
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

  // ESCENARIO C: Duda de Modo de Uso o Beneficio sin Cierre
  const consultoModoOUso =
    /\b(c[oó]mo se toma|dosis|desayuno|h[ií]gado|graso|gastritis|diabetes|contraindicaci[oó]n|efectos|seguro|garant[ií]a|ingredientes|composici[oó]n|qu[eé] contiene|sirve para)\b/i.test(
      textosHistorial
    );

  if (consultoModoOUso) {
    if (esTermix) {
      return {
        esElegible: true,
        escenario: "cotizacion_abandonada",
        mensajeRescate: `${saludo} Quería consultarte si tuviste oportunidad de revisar cómo funciona la Tobillera Termix con calor de grafeno y masaje vibratorio ✨. Recuerda que es talla universal y viene con 30 días de garantía. ¿Tienes alguna duda adicional sobre su funcionamiento?`,
      };
    }
    return {
      esElegible: true,
      escenario: "cotizacion_abandonada",
      mensajeRescate: `${saludo} Quería saber si pudiste revisar la información sobre cómo apoya NAC600 + NAD+ a tu bienestar y salud celular ✨. Si te animas a probarlo, recuerda que en Lima pagas recién al recibir en tu puerta con envío gratis y 30 días de garantía. ¿Te gustaría que te programemos 1 frasco de S/119 o prefieres aprovechar la promo de 3 por S/199?`,
    };
  }

  // ESCENARIO D: Cotización / Información de precios sin respuesta
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
 * Usa IA (Gemini vía pool) para auditar la conversación con máxima sutileza:
 * 1. Confirma si la conversación amerita rescate o si ya está concluida / post-venta.
 * 2. Si amerita, genera un mensaje hiper-contextual que retoma EXACTAMENTE desde
 *    el punto donde quedó el proceso.
 */
export async function evaluarRescateConIA(
  contexto: ContextoChatParaAuditoria,
  evaluacionHeuristica: ResultadoAuditoriaRescate
): Promise<ResultadoAuditoriaRescate> {
  // Si no hay API key de IA disponible, mantener la evaluación heurística
  if (!hasOpenRouterKey()) {
    return evaluacionHeuristica;
  }

  try {
    const { contact, ultimoMensaje, historialMensajes, pedidoReciente } = contexto;
    const nombre = (contact.name || "Cliente").split(" ")[0].trim();
    const producto = detectarProductoRescate(contexto) === "termix" ? "Tobillera Termix" : "NAC600 + NAD+";

    // Formatear los últimos mensajes para el prompt
    const mensajesOrdenados = [...(historialMensajes || [])].reverse();
    const transcripcion = mensajesOrdenados
      .map((m) => `${m.direction === "in" ? "Cliente" : "Aliv Perú (Bot/Asesor)"}: ${m.body || "(sin texto)"}`)
      .join("\n");

    const promptAuditoria = `Eres el supervisor senior de atención y ventas de Aliv Perú (tienda oficial de salud y bienestar).
Analiza el siguiente historial reciente de WhatsApp para determinar si la conversación quedó REALMENTE TRABADA en una venta que requiere rescate, o si por el contrario es un chat concluido, atendido o con pedido ya agendado.

HISTORIAL DEL CHAT:
${transcripcion || `Aliv Perú: ${ultimoMensaje?.body ?? ""}`}

DATOS DEL CLIENTE:
- Nombre: ${nombre}
- Producto principal: ${producto}
- Pedido Shopify en sistema: ${pedidoReciente?.numeroOrden ? `#${pedidoReciente.numeroOrden}` : "Ninguno aún"}
- Evaluación heurística previa: Escenario "${evaluacionHeuristica.escenario}", mensaje propuesto: "${evaluacionHeuristica.mensajeRescate}"

REGLAS DE DECISIÓN CRÍTICAS:
1. DEBES RESPONDER "debeRescatar": false SI:
   - El cliente YA COMPRÓ, ya coordinó la entrega con motorizado, o el pedido ya fue agendado/confirmado (ej: "ya le dejé la indicación al motorizado", "este sábado te llega", etc.).
   - La conversación concluyó cordialmente con agradecimiento o despedida mutua (ej: el cliente dijo "no listo gracias", "gracias amigo", "todo claro" y el bot respondió cordialmente).
   - El cliente rechazó la compra ("no gracias", "ya no deseo", "muy caro").
   - El último mensaje fue del cliente (aún espera respuesta nuestra, no está abandonado por él).

2. DEBES RESPONDER "debeRescatar": true SI:
   - Hay una venta en proceso que se detuvo por falta de respuesta del cliente tras 2 a 22 horas:
     a) Ya eligió o acordó un producto/pack pero quedó pendiente enviar su dirección, nombre o ubicación en Lima.
     b) Aceptó el envío a provincia pero quedó pendiente realizar el adelanto de S/20 para la guía Shalom.
     c) Pidió precios o cotización y no decidió qué opción tomar.
     d) Hizo una consulta médica o técnica, se le respondió, y no continuó.

3. REGLAS PARA EL MENSAJE DE RETOMA (si debeRescatar es true):
   - NUNCA sonar como una plantilla genérica ("Quería saber si tuviste oportunidad de revisar...").
   - Retoma EXACTAMENTE desde el punto donde se detuvo el proceso.
   - Si ya acordó el pack (ej: 3 frascos por S/199), el distrito (ej: Carabayllo) o el día de llegada (ej: lunes), menciónalos con naturalidad.
   - NUNCA cambies de producto (si hablaban de NAC600, no menciones Tobillera ni viceversa).
   - NUNCA uses los términos "cápsula blanda" o "softgel" para NAC600 (usa siempre "cápsulas").
   - Extensión: 2 a 3 líneas naturales de WhatsApp, cálidas y cordiales, con 1 emoji adecuado.

Responde ÚNICAMENTE un objeto JSON válido con la siguiente estructura:
{
  "debeRescatar": boolean,
  "motivo": string,
  "puntoDondeQuedo": string,
  "mensajeRetoma": string
}`;

    const completion = await createChatCompletionWithFallback({
      model: getAgentModel(),
      messages: [
        { role: "system", content: "Responde únicamente en formato JSON válido sin markdown ni texto extra." },
        { role: "user", content: promptAuditoria },
      ],
      temperature: 0.2,
      response_format: { type: "json_object" },
    });

    const contenido = completion.choices[0]?.message?.content?.trim();
    if (!contenido) return evaluacionHeuristica;

    const data = JSON.parse(contenido);
    if (data.debeRescatar === false) {
      return {
        esElegible: false,
        motivoDescarte: `Auditoría IA: ${data.motivo || "Conversación no requiere rescate"} (${data.puntoDondeQuedo || "proceso concluido"})`,
      };
    }

    if (data.debeRescatar === true && typeof data.mensajeRetoma === "string" && data.mensajeRetoma.trim().length > 15) {
      // Blindaje de seguridad sobre el texto generado por IA:
      // 1. Prohibir cápsula blanda / softgel
      let mensajeFinal = data.mensajeRetoma
        .replace(/c[aá]psulas?\s+blandas?/gi, "cápsulas")
        .replace(/softgels?/gi, "cápsulas");

      // 2. Verificar que no haya cruzado de producto
      const esTermixReal = producto.includes("Tobillera");
      const hablaDeTermix = /termix|tobillera/i.test(mensajeFinal);
      const hablaDeNac = /nac|nac600|glutation|frasco/i.test(mensajeFinal);

      if (!esTermixReal && hablaDeTermix && !hablaDeNac) {
        console.warn("[rescate-ia] IA generó mensaje de Tobillera para chat de NAC600. Usando heurística.");
        return evaluacionHeuristica;
      }
      if (esTermixReal && hablaDeNac && !hablaDeTermix) {
        console.warn("[rescate-ia] IA generó mensaje de NAC para chat de Tobillera. Usando heurística.");
        return evaluacionHeuristica;
      }

      return {
        esElegible: true,
        escenario: evaluacionHeuristica.escenario,
        mensajeRescate: limpiarFormatoWhatsApp(mensajeFinal),
      };
    }
  } catch (err) {
    console.warn("[rescate-ia] Error en evaluación con IA, usando heurística blindada:", err);
  }

  return evaluacionHeuristica;
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

    // Auditoría contextual inteligente con IA (Gemini vía pool) para confirmar o enriquecer la retoma
    const evaluacionFinal = await evaluarRescateConIA(contexto, evaluacion);
    if (!evaluacionFinal.esElegible || !evaluacionFinal.mensajeRescate || !evaluacionFinal.escenario) {
      continue;
    }

    // Entregar mensaje oficial de rescate
    const entrega = await deliverMessage(c.convId, { text: evaluacionFinal.mensajeRescate }, "agent");
    if (entrega.ok) {
      rescatados++;
      // Aplicar etiqueta 'rescate_enviado' para evitar duplicidad
      await aplicarEtiquetaAContacto({
        contactId: c.contactId,
        etiqueta: "rescate_enviado",
        accion: "agregar",
        motivo: `Rescate de chat abandonado (${evaluacionFinal.escenario})`,
      });

      // Registrar nota en la ficha
      try {
        await db.insert(activities).values({
          type: "note",
          description: `[RESCATE VENTAS] Mensaje enviado automáticamente para recuperar venta abandonada (${evaluacionFinal.escenario}).`,
          contactId: c.contactId,
        });
      } catch (actErr) {
        console.warn("[rescate] Error registrando actividad:", actErr);
      }

      detalles.push({
        contactId: c.contactId,
        phone: c.contactPhone,
        escenario: evaluacionFinal.escenario,
        mensaje: evaluacionFinal.mensajeRescate,
      });
    }
  }

  return {
    procesados: candidatas.length,
    rescatados,
    detalles,
  };
}
