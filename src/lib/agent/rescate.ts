import "server-only";
import { nombreParaSaludo } from "@/lib/nombres";
import { esNumeroEntrenador } from "@/lib/alerts/supervisor-alerts";
import { mostrarNumeroOrden } from "@/lib/pedidos/numero-formato";
import { db } from "@/db";
import { activities, contacts, conversations, deals, messages, pipelineStages, whatsappTemplates } from "@/db/schema";
import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import { getConfig } from "@/lib/config";
import { deliverMessage } from "@/lib/channels/deliver";
import { corregirFrasesSalud } from "./filtro-salud";
import { aplicarEtiquetaAContacto } from "./etiquetado";
import { pedidosOrdenes } from "../../../modules/pedidos/tabla";
import { esPedidoDeProvincia } from "@/lib/pedidos/adelanto";
import { createChatCompletionWithFallback, hasOpenRouterKey, getAgentModel } from "./openrouter";
import { limpiarFormatoWhatsApp } from "./formato";
import { abandonoEnCurso } from "@/lib/abandonos/reglas";

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
    estado?: string | null;
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
/** Ventanas del rescate: primer toque 2-22 h, segundo (y último) toque 22-72 h. */
export const VENTANA_PRIMER_TOQUE = { min: 2, max: 22 };
export const VENTANA_SEGUNDO_TOQUE = { min: 22, max: 72 };

export function determinarEscenarioRescate(
  contexto: ContextoChatParaAuditoria,
  ahora: Date = new Date(),
  opciones: { segundoToque?: boolean } = {}
): ResultadoAuditoriaRescate {
  const { contact, conversation, ultimoMensaje, pedidoReciente, historialMensajes } = contexto;
  const tags = contact.tags ?? [];
  const segundoToque = Boolean(opciones.segundoToque);
  const ventana = segundoToque ? VENTANA_SEGUNDO_TOQUE : VENTANA_PRIMER_TOQUE;

  // 0. Formulario web abandonado en curso: su propia secuencia le escribe (no duplicar).
  if (abandonoEnCurso(tags)) {
    return { esElegible: false, motivoDescarte: "Formulario abandonado en curso (lo atiende su secuencia)" };
  }

  // 1. Validar etiquetas excluyentes (clientes ya atendidos, pagados, en logística o cerrados)
  const tagsExcluyentes = [
    "no-reactivar",
    "cancelado",
    "compra exitosa",
    "orden en camino",
    "adelanto pagado",
    "adelanto_pagado",
    "en agencia shalom",
    "comprobante recibido",
    "rescate_2_enviado",
    "por despachar",
    "esperando clave",
    // El primer toque solo se envía una vez; el segundo exige que el primero ya haya salido.
    ...(segundoToque ? [] : ["rescate_enviado"]),
  ];
  const tieneExcluyente = tags.some((t) => tagsExcluyentes.includes(t.toLowerCase().trim()));
  if (tieneExcluyente) {
    return { esElegible: false, motivoDescarte: "Contacto con etiqueta de cierre, pagado o ya rescatado" };
  }
  if (segundoToque && !tags.some((t) => t.toLowerCase().trim() === "rescate_enviado")) {
    return { esElegible: false, motivoDescarte: "Segundo toque sin primer rescate previo" };
  }

  // 1.1 Si el pedido ya está en estado pagado o logístico
  if (pedidoReciente && (pedidoReciente as any).estado) {
    const est = String((pedidoReciente as any).estado).toLowerCase();
    if (["adelanto_pagado", "confirmado", "preparando", "enviado", "entregado"].includes(est)) {
      return { esElegible: false, motivoDescarte: `Pedido ya se encuentra en estado logístico: ${est}` };
    }
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
  if (horasTranscurridas < ventana.min) {
    return { esElegible: false, motivoDescarte: `Solo han pasado ${horasTranscurridas.toFixed(1)}h (mínimo ${ventana.min}h)` };
  }
  if (horasTranscurridas > ventana.max) {
    return { esElegible: false, motivoDescarte: `Han pasado ${horasTranscurridas.toFixed(1)}h (fuera de ventana ${ventana.max}h)` };
  }

  // 3.1 Protección de descanso nocturno: si el último mensaje fue durante la madrugada (22:00 a 06:00),
  // no enviar rescate temprano en la mañana (8:30 a.m.). Esperar al menos 9 horas para no importunar.
  const horaUltimoMsg = fechaUltimo.toLocaleTimeString("en-US", { timeZone: "America/Lima", hour12: false, hour: "numeric" });
  const horaNumUltimo = parseInt(horaUltimoMsg, 10);
  const esMensajeMadrugada = horaNumUltimo >= 22 || horaNumUltimo < 6;
  if (esMensajeMadrugada && horasTranscurridas < 9) {
    return {
      esElegible: false,
      motivoDescarte: `Mensaje fue en la madrugada (${horaNumUltimo}:00). Esperando al menos 9h para no importunar al cliente`,
    };
  }

  const nombreLimpio = nombreParaSaludo(contact.name) ?? "";
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

  // 3.2 Si el cliente ya envió comprobante o voucher de pago en sus mensajes
  const clienteEnvioComprobante =
    mensajesCliente.some((m) =>
      (m.body || "").includes("[imagen]") ||
      (m.body || "").includes("COMPROBANTE DE PAGO") ||
      /\b(voucher|comprobante|constancia|captura|operaci[oó]n|ya yape[eé]|ya transfer[ií]|ya pagu[eé]|ya deposit[eé])\b/i.test(m.body || "")
    ) ||
    /ya recib[ií] tu comprobante|verificar[aá] tu abono de adelanto|equipo de administraci[oó]n verificar[aá]/i.test(textosHistorial);

  if (clienteEnvioComprobante) {
    return {
      esElegible: false,
      motivoDescarte: "Cliente ya envió comprobante de pago o adelanto (pendiente de validación/clave)",
    };
  }

  // 3.3 Si el cliente indicó que pagará más tarde o en fecha futura ("mañana", "más tarde", etc.)
  const clienteDijoPagariaMasTarde =
    /\b(mañana|maña|mñn|le paso mañ|en la tarde|m[aá]s tarde|luego|despu[eé]s|fin de mes|a fin de mes|el s[aá]bado|el domingo|el lunes|el martes|el mi[eé]rcoles|el jueves|el viernes|cuando cobre|cuando me paguen|apenas cobre|apenas pueda|hoy en la noche|en la noche)\b/i.test(
      ultimoMsgCliente
    );

  if (clienteDijoPagariaMasTarde) {
    return {
      esElegible: false,
      motivoDescarte: `Cliente postergó el abono para fecha/hora futura: "${ultimoMsgCliente.slice(0, 50)}"`,
    };
  }

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

  // Detección estricta de provincia (evita ofrecer motorizado / contraentrega donde no aplica).
  // Solo cuenta lo que dijo el CLIENTE (o su pedido/etiquetas): el bot escribe "provincia" y
  // "agencia" al cotizar a cualquiera ("¿Te lo enviamos a Lima o a provincia?"), y usar sus
  // textos clasificaba como provincia a casi todas las consultas de Lima.
  const textoCliente = mensajesCliente.map((m) => m.body || "").join(" ").toLowerCase();
  // Para saber QUÉ pack acordó: lo que dijo el cliente + las confirmaciones del bot que
  // nombran un solo precio ("tu pedido de 3 frascos por S/199"). Las cotizaciones con la
  // lista completa (119/189/199) no dicen nada de lo elegido y antes forzaban "1 frasco".
  const confirmacionesBot = (historialMensajes || [])
    .filter((m) => m.direction === "out")
    .map((m) => (m.body || "").toLowerCase())
    .filter((b) => new Set(b.match(/\b(79|119|139|189|199)\b/g) ?? []).size === 1);
  const textoPack = [textoCliente, ...confirmacionesBot].join(" ");
  const fieldsCliente = (contact.customFields ?? {}) as Record<string, unknown>;
  const ciudadFicha = String(fieldsCliente.departamento_ciudad ?? fieldsCliente.ciudad ?? "");
  const esProvincia =
    tags.some((t) => /provincia|adelanto|shalom/i.test(t)) ||
    (pedidoReciente &&
      esPedidoDeProvincia({
        ciudad: pedidoReciente.ciudad ?? null,
        distrito: pedidoReciente.distrito ?? null,
        direccionEnvio: pedidoReciente.direccionEnvio ?? null,
      })) ||
    /\b(abancay|chalhuanca|trujillo|arequipa|cusco|puno|piura|chiclayo|tacna|ica|pisco|huancayo|ayacucho|chimbote|huaraz|iquitos|pucallpa|tarapoto|madre de dios|tambopata|tumbes|cajamarca|moquegua|chota|jaen|bagua|sullana|talara|juliaca|chincha|nazca|andahuaylas|pasco|huanuco|tingo mar[ií]a|chachapoyas|ilo|mollendo|caman[aá]|moyobamba|yurimaguas|tarma|la merced|satipo|pichanaqui|oxapampa|cerro de pasco|puquio|barranca|huacho|huaral|cañete|imperial|mala)\b/i.test(
      (pedidoReciente?.ciudad || "") + " " + (pedidoReciente?.direccionEnvio || "") + " " + ciudadFicha + " " + textoCliente
    ) ||
    /\b(shalom|olva|agencia|provincia)\b/i.test(textoCliente);

  // ESCENARIO A: Dirección Incompleta (SOLO LIMA / CALLAO para entrega con motorizado a domicilio)
  // En provincia NUNCA debe ejecutarse este escenario ni enviar la plantilla aliv_completar_direccion.
  if (!esProvincia) {
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
      const ordenTxt = pedidoReciente.numeroOrden ? `${mostrarNumeroOrden(pedidoReciente.numeroOrden)} ` : "";
      return {
        esElegible: true,
        escenario: "direccion_incompleta",
        mensajeRescate: `${saludo} Te saluda Aliv Perú 🌿. Tu pedido ${ordenTxt}de ${nombreProducto} está separado y listo para embalar 📦. Solo nos falta confirmar el número de tu calle o una referencia para programar la entrega a tu puerta. ¿Nos confirmas tu dirección completa o nos compartes tu ubicación por aquí? 📍`,
      };
    }

    // Caso 2: Cierre en chat donde el cliente acordó un pack pero quedó pendiente su dirección o nombre completo (Lima)
    if (!pedidoReciente && botPreguntoPorDireccion) {
      let detallePack = esTermix ? "tu Tobillera Termix" : "tu pedido de NAC600 + NAD+";
      if (esTermix) {
        if (/\b(3\s*(?:tobilleras?|unidades?)|pack\s*(?:de\s*)?3|189)\b/i.test(textoPack)) {
          detallePack = "tus 3 Tobilleras Termix";
        } else if (/\b(2\s*(?:tobilleras?|unidades?)|pack\s*(?:de\s*)?2|139)\b/i.test(textoPack)) {
          detallePack = "tu promo de 2 Tobilleras Termix";
        } else if (/\b(1\s*(?:tobillera|unidad)|79)\b/i.test(textoPack)) {
          detallePack = "tu Tobillera Termix";
        }
      } else {
        if (/\b(3\s*frascos?|pack\s*(?:de\s*)?3|199)\b/i.test(textoPack)) {
          detallePack = "tus 3 frascos de NAC600 + NAD+";
        } else if (/\b(2\s*frascos?|pack\s*(?:de\s*)?2|189)\b/i.test(textoPack)) {
          detallePack = "tus 2 frascos de NAC600 + NAD+";
        } else if (/\b(1\s*frasco|119)\b/i.test(textoPack)) {
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
  }

  // ESCENARIO B: Freno por Adelanto en Provincia (cuando aún no ha pagado los S/20)
  if (esProvincia) {
    let totalNum = 199;
    if (pedidoReciente?.total) {
      totalNum = Number(pedidoReciente.total);
    } else if (esTermix) {
      totalNum = /\b(3\s*(?:tobilleras?|unidades?)|189)\b/i.test(textoPack)
        ? 189
        : /\b(79|1\s*(?:tobillera|unidad))\b/i.test(textoPack)
          ? 79
          : 139;
    } else {
      totalNum = /\b(1\s*frasco|119)\b/i.test(textoPack)
        ? 119
        : /\b(2\s*frascos?|189)\b/i.test(textoPack)
          ? 189
          : 199;
    }
    const saldo = Math.max(totalNum - 20, 0);
    return {
      esElegible: true,
      escenario: "adelanto_provincia",
      mensajeRescate: `${saludo} Quería darte la tranquilidad de que somos Aliv Perú (RUC 20612283134) y despachamos a diario por Shalom con garantía de 30 días por fallas de fábrica a todo el país. Los S/20 son solo para generar tu guía oficial; cuando tu paquete llegue a la agencia, nos transfieres el saldo de S/${saldo} y te enviamos tu clave secreta de recojo para que lo retires con tu DNI. Puedes rastrear tu envío en tiempo real en la web de Shalom. ¿A qué agencia Shalom te quedaría más cómodo que te lo enviemos?`,
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
        mensajeRescate: `${saludo} Quería consultarte si tuviste oportunidad de revisar cómo funciona la Tobillera Termix con calor de grafeno y masaje vibratorio ✨. Recuerda que es talla universal y viene con garantía de 30 días por fallas de fábrica. ¿Tienes alguna duda adicional sobre su funcionamiento?`,
      };
    }
    return {
      esElegible: true,
      escenario: "cotizacion_abandonada",
      mensajeRescate: `${saludo} Quería saber si pudiste revisar la información sobre cómo apoya NAC600 + NAD+ a tu bienestar y salud celular ✨. Si te animas a probarlo, recuerda que en Lima pagas recién al recibir en tu puerta con envío gratis y garantía de 30 días por fallas de fábrica. ¿Te gustaría que te programemos 1 frasco de S/119 o prefieres aprovechar la promo de 3 por S/199?`,
    };
  }

  // ESCENARIO D: Cotización / Información de precios sin respuesta
  if (esTermix) {
    return {
      esElegible: true,
      escenario: "cotizacion_abandonada",
      mensajeRescate: `${saludo} Quería saber si tuviste oportunidad de revisar los detalles de la Tobillera Termix ✨. Recuerda que incluye calor constante de grafeno, masaje por vibración y garantía de 30 días por fallas de fábrica con envío gratis. ¿Te gustaría aprovechar la promo de 2 por S/139 o prefieres empezar con 1 por S/79?`,
    };
  }

  return {
    esElegible: true,
    escenario: "cotizacion_abandonada",
    mensajeRescate: `${saludo} Quería saber si tuviste oportunidad de revisar la información de NAC600 + NAD+ ✨. Recuerda que tenemos envío gratis con pago al recibir en Lima y garantía de 30 días por fallas de fábrica. ¿Te gustaría empezar con 1 frasco de S/119 o prefieres aprovechar la promo de 3 por S/199?`,
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
Analiza el siguiente historial reciente de WhatsApp para determinar si la conversación quedó REALMENTE TRABADA en una venta que requiere rescate, o si por el contrario es un chat concluido, atendido, pagado o con seguimiento agendado.

HISTORIAL DEL CHAT:
${transcripcion || `Aliv Perú: ${ultimoMensaje?.body ?? ""}`}

DATOS DEL CLIENTE:
- Nombre: ${nombre}
- Producto principal: ${producto}
- Pedido Shopify en sistema: ${pedidoReciente?.numeroOrden ? mostrarNumeroOrden(pedidoReciente.numeroOrden) : "Ninguno aún"}
- Evaluación heurística previa: Escenario "${evaluacionHeuristica.escenario}", mensaje propuesto: "${evaluacionHeuristica.mensajeRescate}"

REGLAS DE DECISIÓN CRÍTICAS (CUMPLIMIENTO ESTRICTO):
1. DEBES RESPONDER "debeRescatar": false SI:
   - El cliente YA PAGÓ (envió voucher, captura, constancia de Yape/BCP o saldo de adelanto), o el bot/asesor ya confirmó la recepción del comprobante.
   - El cliente ya proporcionó sus datos de envío (DNI, Agencia Shalom) o el pedido ya está en preparación, despachado o entregado.
   - El cliente indicó que pagará en una fecha u hora futura (ej: "mañana le paso", "más tarde", "el sábado", "fin de mes", "cuando cobre"). NO insistir antes de tiempo.
   - El pedido es de provincia (fuera de Lima/Callao) y la propuesta habla de motorizado contraentrega. (En provincia es por agencia Shalom/Olva).
   - El cliente YA COMPRÓ, ya coordinó la entrega con motorizado, o el pedido ya fue agendado/confirmado.
   - La conversación concluyó cordialmente con agradecimiento o despedida mutua (ej: el cliente dijo "no listo gracias", "gracias amigo", "todo claro" y el bot respondió cordialmente).
   - El cliente rechazó la compra ("no gracias", "ya no deseo", "muy caro").
   - El último mensaje fue del cliente (aún espera respuesta nuestra, no está abandonado por él).

2. DEBES RESPONDER "debeRescatar": true ÚNICAMENTE SI:
   - Hay una venta en proceso que se detuvo por falta de respuesta del cliente tras 2 a 22 horas y NO existe ningún pago ni promesa de pago postergada:
     a) Ya eligió o acordó un producto/pack pero quedó pendiente enviar su dirección, nombre o ubicación en LIMA/CALLAO. (NUNCA en provincia).
     b) Aceptó el envío a provincia pero quedó pendiente realizar el adelanto de S/20 para la guía Shalom (y NO ha enviado voucher ni dicho que pagará después).
     c) Pidió precios o cotización y no decidió qué opción tomar.
     d) Hizo una consulta médica o técnica, se le respondió, y no continuó.

3. REGLAS PARA EL MENSAJE DE RETOMA (si debeRescatar es true):
   - NUNCA sonar como una plantilla genérica ("Quería saber si tuviste oportunidad de revisar...").
   - NUNCA ofrecer motorizado contraentrega ni entrega a domicilio a pedidos de provincia (Abancay, Chalhuanca, Trujillo, etc. van SOLO por agencia Shalom / Olva).
   - Retoma EXACTAMENTE desde el punto donde se detuvo el proceso.
   - Si ya acordó el pack (ej: 3 frascos por S/199), el distrito (ej: Carabayllo) o el día de llegada (ej: lunes), menciónalos con naturalidad.
   - NUNCA cambies de producto (si hablaban de NAC600, no menciones Tobillera ni viceversa).
   - NUNCA uses los términos "cápsula blanda" o "softgel" para NAC600 (usa siempre "cápsulas").
   - En provincia por Shalom: NUNCA digas que el cliente paga en ventanilla de la agencia. El cliente nos transfiere el saldo a nosotros cuando llega a la agencia y nosotros le enviamos la clave secreta de recojo para que retire con su DNI.
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
    }, { origen: "rescate" });

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
        // Reglas 2 y 3: sin promesas de salud ni "estándares" también en el rescate.
        mensajeRescate: limpiarFormatoWhatsApp(corregirFrasesSalud(mensajeFinal).texto),
      };
    }
  } catch (err) {
    console.warn("[rescate-ia] Error en evaluación con IA, usando heurística blindada:", err);
  }

  return evaluacionHeuristica;
}


/**
 * Segundo y último toque (22-72 h sin respuesta tras el primer rescate). Corto, sin
 * repetir el discurso, con una propuesta concreta que se responde con "sí". Fuera de la
 * ventana de 24 h sale la plantilla aprobada del escenario; este texto queda de vista
 * previa y se envía tal cual si la ventana sigue abierta.
 */
export function mensajeSegundoToque(
  escenario: TipoEscenarioRescate,
  nombre: string | null,
  producto: "nac600" | "termix"
): string {
  const saludo = nombre ? `${nombre}, ` : "";
  const pack = producto === "termix" ? "el par de Tobilleras Termix (S/139)" : "los 3 frascos de NAC600 (S/199)";
  if (escenario === "direccion_incompleta") {
    return `${saludo}tu pedido sigue separado 📦. Solo respóndeme con tu dirección o tu ubicación y lo dejo en ruta para la próxima entrega.`;
  }
  if (escenario === "adelanto_provincia") {
    return `${saludo}te escribo por última vez para no incomodarte 🙂. Si aún lo quieres, con el adelanto de S/20 al Yape *951365418* (Gerardo Huaynalaya) te lo despachamos por Shalom. ¿Te lo separo?`;
  }
  return `${saludo}te escribo por última vez para no incomodarte 🙂. Te puedo separar ${pack} con envío gratis. ¿Te lo agendo? Responde "sí" y lo dejo listo.`;
}

type Pasada = "primero" | "segundo";

/**
 * Plantilla del segundo toque: distinta de la del primero para no repetir el mismo texto.
 * Hay que crearla en WhatsApp Manager (Marketing, español) y sincronizar en el CRM:
 *   "Hola {{1}}, te escribo por última vez para no incomodarte 🙂. Seguimos guardando tu
 *    pedido de {{2}}. Si aún lo quieres, responde este mensaje y lo dejamos listo."
 * Mientras no esté aprobada, el segundo toque fuera de la ventana de 24 h no sale.
 */
export const PLANTILLA_SEGUNDO_TOQUE = "aliv_ultimo_recordatorio";

/**
 * Horas de texto libre que se usan como ventana segura: WhatsApp da 24 h desde el último
 * mensaje del cliente; se deja 1 h de margen por la demora entre decidir y entregar.
 */
export const HORAS_VENTANA_SEGURA = 23;

export interface PlantillaRescate {
  name: string;
  language: string;
  params: string[];
}

export type EnvioRescate =
  | { modo: "texto" }
  | { modo: "plantilla"; plantilla: PlantillaRescate }
  | { modo: "omitir"; motivo: string };

/** Plantilla aprobada que corresponde a cada escenario y toque. */
export function plantillaParaRescate(
  pasada: Pasada,
  escenario: TipoEscenarioRescate,
  datos: { nombre: string; producto: string; ciudad: string }
): PlantillaRescate {
  if (pasada === "segundo") {
    return { name: PLANTILLA_SEGUNDO_TOQUE, language: "es", params: [datos.nombre, datos.producto] };
  }
  if (escenario === "direccion_incompleta") {
    return { name: "aliv_completar_direccion", language: "es", params: [datos.nombre, datos.producto, datos.ciudad] };
  }
  if (escenario === "adelanto_provincia") {
    return { name: "aliv_recordatorio_adelanto", language: "es", params: [datos.nombre, datos.producto, datos.ciudad] };
  }
  return { name: "aliv_seguimiento_consulta", language: "es", params: [datos.nombre, datos.producto] };
}

/**
 * Decide cómo sale el rescate. Dentro de la ventana de 24 h se manda el texto (el mensaje
 * contextual de la IA o el segundo toque corto): si se adjunta una plantilla, el conector
 * la prioriza y el cliente recibe la genérica. Fuera de la ventana solo puede salir una
 * plantilla, y solo si está aprobada; si no, se omite en vez de fallar en cada barrido.
 */
export function elegirEnvioRescate(e: {
  lastInboundAt: Date | string | null | undefined;
  ahora: Date;
  plantilla: PlantillaRescate;
  plantillasAprobadas: ReadonlySet<string>;
}): EnvioRescate {
  const ultimo = e.lastInboundAt ? new Date(e.lastInboundAt).getTime() : NaN;
  const horas = Number.isNaN(ultimo) ? Infinity : (e.ahora.getTime() - ultimo) / 3_600_000;
  if (horas <= HORAS_VENTANA_SEGURA) return { modo: "texto" };
  if (!e.plantillasAprobadas.has(e.plantilla.name)) {
    return { modo: "omitir", motivo: `fuera de la ventana de 24 h y la plantilla ${e.plantilla.name} no está aprobada` };
  }
  return { modo: "plantilla", plantilla: e.plantilla };
}

/** Prefijo de las notas que marcan un chat ya revisado sin envío (o con envío fallido). */
export const PREFIJO_REVISADO = "[RESCATE REVISADO]";
export const PREFIJO_REVISADO_FALLO = `${PREFIJO_REVISADO} Falló el envío`;
/** Tras un envío fallido se reintenta una vez pasada esta espera (error transitorio). */
export const HORAS_REINTENTO_FALLO = 1;

/**
 * ¿Hay que saltarse el chat porque ya se revisó desde su último mensaje? Un descarte vale
 * hasta que la conversación cambie; un envío fallido se reintenta pasada 1 h.
 */
export function yaRevisadoSinCambios(
  ultimaNota: { description: string | null; createdAt: Date | string } | null | undefined,
  lastMessageAt: Date | string | null | undefined,
  ahora: Date
): boolean {
  if (!ultimaNota || !lastMessageAt) return false;
  const nota = new Date(ultimaNota.createdAt).getTime();
  if (nota < new Date(lastMessageAt).getTime()) return false;
  if ((ultimaNota.description ?? "").startsWith(PREFIJO_REVISADO_FALLO)) {
    return ahora.getTime() - nota < HORAS_REINTENTO_FALLO * 3_600_000;
  }
  return true;
}

/**
 * Ejecuta el barrido de auditoría sobre todas las conversaciones candidatas en la base de datos.
 * Dos pasadas: primer toque (2-22 h) y segundo toque (22-72 h, solo a quien ya recibió
 * el primero y no respondió). Nunca hay un tercero.
 */
export async function auditarChatsAbandonados(opts?: { limite?: number; forzarHorario?: boolean }): Promise<{
  procesados: number;
  rescatados: number;
  detalles: Array<{ contactId: string; phone: string | null; escenario: string; mensaje: string; toque?: number }>;
}> {
  const limite = opts?.limite ?? 10;
  const forzarHorario = opts?.forzarHorario ?? false;
  const ahora = new Date();

  // Validar horario comercial de Perú
  if (!forzarHorario && !esHorarioPermitidoRescate(ahora, getConfig().zonaHoraria)) {
    return { procesados: 0, rescatados: 0, detalles: [] };
  }

  let procesados = 0;
  let rescatados = 0;
  const detalles: Array<{ contactId: string; phone: string | null; escenario: string; mensaje: string; toque?: number }> = [];

  // Plantillas aprobadas (según la última sincronización con Meta): fuera de la ventana de
  // 24 h solo se envía si la del escenario está aquí.
  const aprobadas = await db
    .select({ name: whatsappTemplates.name })
    .from(whatsappTemplates)
    .where(sql`upper(${whatsappTemplates.status}) = 'APPROVED'`);
  const plantillasAprobadas = new Set(aprobadas.map((t) => t.name));

  /** Deja constancia de que el chat se revisó sin envío, para no reevaluarlo (ni gastar IA) en cada barrido. */
  const marcarRevisado = async (contactId: string, detalle: string) => {
    try {
      await db.insert(activities).values({ type: "note", description: `${PREFIJO_REVISADO} ${detalle}`, contactId });
    } catch (err) {
      console.warn("[rescate] Error registrando revisión:", err);
    }
  };

  for (const pasada of ["primero", "segundo"] as Pasada[]) {
    const ventana = pasada === "primero" ? VENTANA_PRIMER_TOQUE : VENTANA_SEGUNDO_TOQUE;
    const desde = new Date(ahora.getTime() - ventana.max * 60 * 60 * 1000);
    const hasta = new Date(ahora.getTime() - ventana.min * 60 * 60 * 1000);

    // Buscar conversaciones activas dentro de la ventana con IA activa
    const candidatas = await db
      .select({
        convId: conversations.id,
        channel: conversations.channel,
        lastMessageAt: conversations.lastMessageAt,
        lastInboundAt: conversations.lastInboundAt,
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
          lte(conversations.lastMessageAt, hasta),
          gte(conversations.lastMessageAt, desde),
          ...(pasada === "segundo"
            ? [sql`${contacts.tags} @> ARRAY['rescate_enviado']::text[]`, sql`not (${contacts.tags} @> ARRAY['rescate_2_enviado']::text[])`]
            : [])
        )
      )
      .orderBy(desc(conversations.lastMessageAt))
      .limit(limite * 2);

    procesados += candidatas.length;

    for (const c of candidatas) {
      if (rescatados >= limite) break;
      // Lista blanca: los supervisores prueban el bot; no se les manda rescate.
      if (esNumeroEntrenador(c.contactPhone)) continue;

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

      // Verificar si ya existe una actividad de seguimiento pendiente o programada recientemente
      const [actividadFutura] = await db
        .select({ id: activities.id })
        .from(activities)
        .where(
          and(
            eq(activities.contactId, c.contactId),
            eq(activities.type, "follow_up"),
            gte(activities.scheduledAt, new Date(ahora.getTime() - 6 * 60 * 60 * 1000))
          )
        )
        .limit(1);

      if (actividadFutura) {
        continue; // Hay un seguimiento programado, no enviar rescate automático
      }

      // Ya revisado desde su último mensaje (descartado o envío fallido hace < 1 h): saltar.
      const [ultimaRevision] = await db
        .select({ description: activities.description, createdAt: activities.createdAt })
        .from(activities)
        .where(
          and(
            eq(activities.contactId, c.contactId),
            sql`${activities.description} like ${PREFIJO_REVISADO + "%"}`
          )
        )
        .orderBy(desc(activities.createdAt))
        .limit(1);
      if (yaRevisadoSinCambios(ultimaRevision, c.lastMessageAt, ahora)) continue;

      // Obtener pedido más reciente si existe
      const [pedido] = await db
        .select({
          numeroOrden: pedidosOrdenes.numeroOrden,
          total: pedidosOrdenes.total,
          direccionEnvio: pedidosOrdenes.direccionEnvio,
          ciudad: pedidosOrdenes.ciudad,
          distrito: pedidosOrdenes.distrito,
          items: pedidosOrdenes.items,
          estado: pedidosOrdenes.estado,
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

      const evaluacion = determinarEscenarioRescate(contexto, ahora, { segundoToque: pasada === "segundo" });
      if (!evaluacion.esElegible || !evaluacion.mensajeRescate || !evaluacion.escenario) {
        continue;
      }

      const nombreCliente = nombreParaSaludo(c.contactName) ?? "estimado(a)";
      const prodRescate = detectarProductoRescate(contexto);

      // Cómo saldría (texto dentro de 24 h, plantilla aprobada fuera). Se decide antes de
      // llamar a la IA: si no hay forma de entregarlo, no se gasta la llamada.
      const prodNombre = prodRescate === "termix" ? "Tobillera Termix" : "suplemento NAC600 + NAD+";
      const ciudadDestino = (pedido?.ciudad || "Perú").trim() || "Perú";
      const envio = elegirEnvioRescate({
        lastInboundAt: c.lastInboundAt,
        ahora,
        plantilla: plantillaParaRescate(pasada, evaluacion.escenario, {
          nombre: nombreCliente,
          producto: prodNombre,
          ciudad: ciudadDestino,
        }),
        plantillasAprobadas,
      });
      if (envio.modo === "omitir") {
        await marcarRevisado(c.contactId, `Sin envío (toque ${pasada === "primero" ? 1 : 2}): ${envio.motivo}.`);
        continue;
      }
      // E6: tope de 3 mensajes nuestros seguidos sin respuesta (bot, equipo y automáticos).
      const { puedeEnviarToque } = await import("./toques-servidor");
      if (!(await puedeEnviarToque(c.convId))) {
        await marcarRevisado(c.contactId, `Sin envío (toque ${pasada === "primero" ? 1 : 2}): ya hay 3 mensajes nuestros sin respuesta.`);
        continue;
      }

      // Primer toque: auditoría contextual con IA. Segundo toque: mensaje corto y fijo
      // (la IA ya tuvo su oportunidad; aquí solo se ofrece cerrar o se despide).
      let evaluacionFinal = evaluacion;
      if (pasada === "primero") {
        evaluacionFinal = await evaluarRescateConIA(contexto, evaluacion);
        if (!evaluacionFinal.esElegible || !evaluacionFinal.mensajeRescate || !evaluacionFinal.escenario) {
          await marcarRevisado(
            c.contactId,
            `Descartado: ${evaluacionFinal.motivoDescarte ?? "la IA no lo consideró rescatable"}`.slice(0, 500)
          );
          continue;
        }
      } else {
        const nombreReal = nombreParaSaludo(c.contactName);
        evaluacionFinal = {
          ...evaluacion,
          mensajeRescate: mensajeSegundoToque(evaluacion.escenario!, nombreReal, prodRescate),
        };
      }

      // Dentro de 24 h sale el texto tal cual (sin plantilla: el conector la priorizaría).
      // Fuera, la plantilla aprobada; el texto queda como vista previa en el CRM.
      const entrega = await deliverMessage(
        c.convId,
        envio.modo === "texto"
          ? { text: evaluacionFinal.mensajeRescate! }
          : { template: { ...envio.plantilla, previewText: evaluacionFinal.mensajeRescate! } },
        "agent"
      );
      if (!entrega.ok) {
        await marcarRevisado(
          c.contactId,
          `${PREFIJO_REVISADO_FALLO.slice(PREFIJO_REVISADO.length + 1)} (toque ${pasada === "primero" ? 1 : 2}, ${
            envio.modo === "texto" ? "texto" : `plantilla ${envio.plantilla.name}`
          }): ${entrega.error ?? "sin detalle"}`.slice(0, 500)
        );
        continue;
      }

      rescatados++;
      // rescate_enviado tras el primer toque, rescate_2_enviado tras el último
      const etiqueta = pasada === "primero" ? "rescate_enviado" : "rescate_2_enviado";
      await aplicarEtiquetaAContacto({
        contactId: c.contactId,
        etiqueta,
        accion: "agregar",
        motivo: `Rescate de chat abandonado (${evaluacionFinal.escenario}, toque ${pasada === "primero" ? 1 : 2})`,
      });

      // Registrar nota en la ficha
      try {
        await db.insert(activities).values({
          type: "note",
          description:
            pasada === "primero"
              ? `[RESCATE VENTAS] Mensaje enviado automáticamente para recuperar venta abandonada (${evaluacionFinal.escenario}).`
              : `[RESCATE VENTAS] Segundo y último toque enviado (${evaluacionFinal.escenario}).`,
          contactId: c.contactId,
        });
      } catch (actErr) {
        console.warn("[rescate] Error registrando actividad:", actErr);
      }

      detalles.push({
        contactId: c.contactId,
        phone: c.contactPhone,
        escenario: evaluacionFinal.escenario!,
        mensaje: evaluacionFinal.mensajeRescate!,
        toque: pasada === "primero" ? 1 : 2,
      });
    }
  }

  return {
    procesados,
    rescatados,
    detalles,
  };
}
