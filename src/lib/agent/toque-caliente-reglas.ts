/**
 * Toque en caliente (clase CRM Driven, 22/11). Reglas puras, sin base de datos.
 *
 * Cuando el bot pidió el adelanto, los datos de envío o dio el precio y el cliente se quedó
 * callado, el rescate esperaba al menos 2 h; para entonces el cliente ya se enfrió. Este
 * toque sale una sola vez entre los 12 y 45 minutos, mientras el cliente aún tiene el chat
 * a mano. Va dentro de la ventana de 24 h de WhatsApp (texto libre, sin costo de plantilla).
 */
import { nombreParaSaludo } from "@/lib/nombres";
import { abandonoEnCurso } from "@/lib/abandonos/reglas";
import { dentroDeHorario } from "./seguimiento-reglas";

export const PREFIJO_TOQUE_CALIENTE = "[TOQUE CALIENTE]";
/** Minutos de silencio del cliente tras el último mensaje del bot. */
export const VENTANA_TOQUE_CALIENTE = { minMin: 12, maxMin: 45 };

export type EscenarioToqueCaliente = "adelanto" | "datos" | "cotizacion";

const TAGS_EXCLUYENTES = [
  "no-reactivar",
  "postulante",
  "cancelado",
  "compra exitosa",
  "orden en camino",
  "adelanto pagado",
  "adelanto_pagado",
  "en agencia shalom",
  "comprobante recibido",
  "por despachar",
  "esperando clave",
];

const ESTADOS_CERRADOS = ["adelanto_pagado", "confirmado", "preparando", "enviado", "entregado", "cancelado"];

/** El mensaje del bot cierra la conversación (no espera nada del cliente). */
const RE_CIERRE =
  /(pedido (qued[oó] |queda |ha sido |fue )?(registrado|confirmado)|(qued[oó]|queda|est[aá]) (programad|agendad|anotad|registrad)[oa]|quedamos en contacto|gracias por tu compra|que tengas (un )?(buen|lindo|excelente)|hasta pronto|cualquier (duda|consulta) (me |nos )?(escribes|avisas))/i;

/** Contra entrega (Lima o provincia con cobertura): ahí no hay adelanto que perseguir. */
const RE_CONTRA_ENTREGA = /contra ?entrega|pagas? al recibir|pago al recibir/i;

/**
 * Qué estaba esperando el bot según su último mensaje; null si no esperaba nada concreto
 * (respuesta informativa, despedida, confirmación).
 */
export function escenarioDesdeMensajeBot(texto: string | null | undefined): EscenarioToqueCaliente | null {
  const t = String(texto ?? "").replace(/\s+/g, " ").trim();
  if (!t) return null;
  if (RE_CIERRE.test(t)) return null;
  const pregunta = t.includes("?");
  // «Yape o Plin» como forma de pago contra entrega NO es pedir el adelanto (caso Juan #1171, 23/11).
  if (
    !RE_CONTRA_ENTREGA.test(t) &&
    (/\badelanto\b/i.test(t) || (/\b(yape|plin)\b/i.test(t) && /(captura|comprobante|voucher)/i.test(t)))
  ) {
    return "adelanto";
  }
  if (
    /\b(dni|direcci[oó]n|referencia|agencia|sede|nombre completo|nombres? y apellidos?|ubicaci[oó]n|distrito|ciudad)\b/i.test(t) &&
    (pregunta || /\b(p[aá]sa(me|nos)|env[ií]a(me|nos)|ind[ií]ca(me|nos)|conf[ií]rma(me|nos)|necesito|falta)\b/i.test(t))
  ) {
    return "datos";
  }
  if (/s\/\s?\d{2,3}/i.test(t) && pregunta) return "cotizacion";
  return null;
}

export interface EntradaToqueCaliente {
  ahora: Date;
  /** Último mensaje de la conversación. */
  ultimo: { direction: "in" | "out"; origin: string | null; body: string | null; createdAt: Date } | null;
  ultimoEntranteEn: Date | null;
  tags: string[] | null;
  estadoPedido: string | null;
  /** Ya salió un toque en caliente desde el último mensaje del cliente. */
  yaTocado: boolean;
  /** El cliente prometió volver y hay un seguimiento con hora pendiente. */
  promesaPendiente: boolean;
  aiActivo: boolean;
}

export type DecisionToqueCaliente =
  | { accion: "enviar"; escenario: EscenarioToqueCaliente }
  | { accion: "esperar"; motivo: string }
  | { accion: "omitir"; motivo: string };

export function decidirToqueCaliente(e: EntradaToqueCaliente): DecisionToqueCaliente {
  if (!e.aiActivo) return { accion: "omitir", motivo: "bot apagado" };
  if (!e.ultimo || e.ultimo.direction !== "out") return { accion: "omitir", motivo: "el cliente respondió" };
  // Solo cuando habló el bot: si escribió una persona del equipo, ella lleva el chat.
  if (e.ultimo.origin !== "agent") return { accion: "omitir", motivo: "el último mensaje no es del bot" };
  if (e.yaTocado) return { accion: "omitir", motivo: "ya se envió el toque en caliente" };
  if (e.promesaPendiente) return { accion: "omitir", motivo: "el cliente prometió volver (lo atiende el seguimiento)" };
  const tags = (e.tags ?? []).map((t) => t.toLowerCase().trim());
  if (abandonoEnCurso(tags)) return { accion: "omitir", motivo: "formulario abandonado en curso" };
  if (tags.some((t) => TAGS_EXCLUYENTES.includes(t))) return { accion: "omitir", motivo: "etiqueta de cierre o pago" };
  if (e.estadoPedido && ESTADOS_CERRADOS.includes(e.estadoPedido.toLowerCase())) {
    return { accion: "omitir", motivo: `pedido en estado ${e.estadoPedido}` };
  }
  if (!e.ultimoEntranteEn || e.ahora.getTime() - e.ultimoEntranteEn.getTime() > 23 * 3_600_000) {
    return { accion: "omitir", motivo: "fuera de la ventana de 24 h" };
  }
  const min = (e.ahora.getTime() - e.ultimo.createdAt.getTime()) / 60_000;
  if (min < VENTANA_TOQUE_CALIENTE.minMin) return { accion: "esperar", motivo: "aún no pasan 12 min" };
  if (min > VENTANA_TOQUE_CALIENTE.maxMin) return { accion: "omitir", motivo: "pasaron más de 45 min (lo toma el rescate)" };
  const escenario = escenarioDesdeMensajeBot(e.ultimo.body);
  if (!escenario) return { accion: "omitir", motivo: "el bot no esperaba un dato concreto" };
  if (!dentroDeHorario(e.ahora)) return { accion: "omitir", motivo: "fuera de horario (9:00 a 21:00)" };
  return { accion: "enviar", escenario };
}

/** Texto corto del toque. Sin promesas de horario de despacho que no podamos cumplir. */
export function mensajeToqueCaliente(escenario: EscenarioToqueCaliente, nombre: string | null | undefined): string {
  const n = nombreParaSaludo(nombre);
  const cuerpo = {
    adelanto:
      "tu pedido sigue separado 📦 Apenas nos envíes la captura del adelanto lo registramos para el próximo despacho a Shalom, y el resto lo pagas al recogerlo en tu agencia. ¿Te ayudo con algo para completarlo? 🙌",
    datos: "solo me faltan esos datos para dejar tu pedido registrado 📝 ¿Me los pasas por aquí? Así lo incluimos en el próximo despacho.",
    cotizacion: "¿te lo separo? 😊 Dime para qué distrito o ciudad es y te confirmo cómo te llega y cuándo.",
  }[escenario];
  if (n) return `${n}, ${cuerpo}`;
  return cuerpo.replace(/^(¿?)(\p{L})/u, (_m, a: string, b: string) => a + b.toUpperCase());
}
