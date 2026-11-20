/**
 * Seguimiento con hora (paso 5 del plan del bot). Reglas puras, sin base de datos.
 *
 * Cuando el cliente promete volver ("en 20 minutos te paso los datos", "más tarde te
 * confirmo", "mañana te escribo"), el bot agenda un recordatorio. Si a esa hora el cliente
 * no volvió ni compró, el barrido le escribe una sola vez. En los chats del 12 al 19/11 un
 * cliente dijo "en unos 20 minutos le paso" y nadie le escribió hasta el rescate del día
 * siguiente.
 */
import { nombreParaSaludo } from "@/lib/nombres";

export const PREFIJO_SEGUIMIENTO = "[SEGUIMIENTO BOT]";
/** Margen después de la hora prometida antes de escribir. */
const MARGEN_MIN = 10;
/** Horario en que el bot puede escribir por iniciativa propia (hora de Lima). */
export const HORA_INICIO = 9;
export const HORA_FIN = 21;

function horaLima(d: Date): number {
  return (d.getUTCHours() + 24 - 5) % 24;
}

/** Mañana a las 10:00 de Lima. */
function mananaDiezLima(ahora: Date): Date {
  const lima = new Date(ahora.getTime() - 5 * 3_600_000);
  const d = new Date(Date.UTC(lima.getUTCFullYear(), lima.getUTCMonth(), lima.getUTCDate() + 1, 15, 0, 0));
  return d;
}

/**
 * Hora a la que conviene escribirle si el mensaje es una promesa de volver; null si no lo es.
 */
export function detectarPromesa(texto: string, ahora: Date = new Date()): Date | null {
  const t = texto.toLowerCase();
  if (!t.trim()) return null;
  if (/\b(no|nunca|ya no)\b.{0,15}\b(quiero|me interesa|gracias)\b/.test(t)) return null;

  const min = t.match(/\ben (unos |un |como )?(\d{1,3}) ?(min|minutos|mins)\b/);
  if (min) return new Date(ahora.getTime() + (parseInt(min[2], 10) + MARGEN_MIN) * 60_000);
  const horas = t.match(/\ben (unas |una |como )?(\d{1,2}|una|dos|tres) ?(hora|horas|hr|hrs)\b/);
  if (horas) {
    const n = { una: 1, dos: 2, tres: 3 }[horas[2] as "una" | "dos" | "tres"] ?? parseInt(horas[2], 10);
    return new Date(ahora.getTime() + (n * 60 + MARGEN_MIN) * 60_000);
  }
  if (/\b(ma[nñ]ana)\b.{0,25}\b(te|le)?\s*(escribo|aviso|confirmo|paso|mando|env[ií]o|hablo)\b|\b(te|le) (escribo|aviso|confirmo|paso|mando) ma[nñ]ana\b/.test(t)) {
    return mananaDiezLima(ahora);
  }
  if (/\b(m[aá]s tarde|en un rato|ratito|ahorita|al rato|en la tarde|en la noche|esta noche|luego)\b.{0,25}\b(te|le)?\s*(escribo|aviso|confirmo|paso|mando|env[ií]o|respondo|hablo)\b|\b(te|le) (escribo|aviso|confirmo|paso|mando|respondo) (m[aá]s tarde|en un rato|luego|al rato|en la noche|en la tarde)\b/.test(t)) {
    return new Date(ahora.getTime() + 2 * 3_600_000);
  }
  if (/\b(te aviso|le aviso|te confirmo|le confirmo)\b/.test(t)) return new Date(ahora.getTime() + 3 * 3_600_000);
  return null;
}

/** Corre la hora al horario permitido (9:00 a 21:00 de Lima). */
export function ajustarAHorario(fecha: Date): Date {
  const h = horaLima(fecha);
  if (h >= HORA_INICIO && h < HORA_FIN) return fecha;
  if (h >= HORA_FIN) return mananaDiezLima(fecha);
  // de 0:00 a 8:59 Lima: mismo día a las 10:00
  const lima = new Date(fecha.getTime() - 5 * 3_600_000);
  return new Date(Date.UTC(lima.getUTCFullYear(), lima.getUTCMonth(), lima.getUTCDate(), 15, 0, 0));
}

export function dentroDeHorario(ahora: Date): boolean {
  const h = horaLima(ahora);
  return h >= HORA_INICIO && h < HORA_FIN;
}

/** Mensaje corto del recordatorio. */
export function mensajeSeguimiento(nombre: string | null | undefined, etapa: "datos" | "general" = "general"): string {
  const n = nombreParaSaludo(nombre);
  const saludo = n ? `¡Hola, ${n}! ` : "¡Hola! ";
  return etapa === "datos"
    ? `${saludo}Te escribo como quedamos 😊 Tu pedido sigue separado; pásame los datos que faltan y lo dejo registrado.`
    : `${saludo}Te escribo como quedamos 😊 ¿Seguimos con tu pedido? Te lo dejo listo en un minuto.`;
}

export type DecisionSeguimiento =
  | { accion: "esperar" }
  | { accion: "cerrar"; motivo: string }
  | { accion: "enviar" };

/** Qué hacer con un recordatorio vencido (función pura, para pruebas). */
export function decidirSeguimiento(e: {
  ahora: Date;
  programadoPara: Date;
  creadoEn: Date;
  ultimoEntranteEn: Date | null;
  pedidoDespues: boolean;
  aiActivo: boolean;
}): DecisionSeguimiento {
  if (!e.aiActivo) return { accion: "cerrar", motivo: "bot apagado para este contacto" };
  if (e.pedidoDespues) return { accion: "cerrar", motivo: "ya compró" };
  if (e.ultimoEntranteEn && e.ultimoEntranteEn.getTime() > e.creadoEn.getTime()) {
    return { accion: "cerrar", motivo: "el cliente volvió a escribir" };
  }
  if (e.ahora.getTime() < e.programadoPara.getTime()) return { accion: "esperar" };
  // La ventana de WhatsApp para texto libre es de 24 h desde el último mensaje del cliente.
  if (!e.ultimoEntranteEn || e.ahora.getTime() - e.ultimoEntranteEn.getTime() > 23 * 3_600_000) {
    return { accion: "cerrar", motivo: "fuera de la ventana de 24 h (lo toma el rescate)" };
  }
  if (!dentroDeHorario(e.ahora)) return { accion: "esperar" };
  return { accion: "enviar" };
}
