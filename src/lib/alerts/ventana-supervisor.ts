/**
 * Ventana de 24 h de los supervisores (Gerardo y Lourdes).
 *
 * Los avisos internos salen solo como texto libre, sin plantilla, para no generar cobros de
 * Meta (decisión de Gerardo, 23/11/2026). Eso exige que la ventana de 24 h de cada supervisor
 * siga abierta. Este barrido le avisa al supervisor, UNA vez por ventana, que la suya está por
 * cerrarse, para que responda cualquier cosa («ok») y la renueve.
 *
 * Cuándo avisa:
 * - cuando faltan 3 h o menos para que cierre, o
 * - de noche temprano (20:00–22:00 Lima) si la ventana cerraría antes de las 10:00 del día
 *   siguiente, para que la renueve antes de dormir y no pierda los avisos de la madrugada.
 *
 * La respuesta corta del supervisor («ok», «listo», «👍») la contesta el CRM sin IA.
 */
import { VENTANA_WHATSAPP_MS } from "@/lib/channels/ventana-24h";

/** Marca del aviso: sirve para no repetirlo dentro de la misma ventana. */
export const MARCA_AVISO_VENTANA = "⏳ *Tu ventana de WhatsApp con el CRM";
const AVISAR_ANTES_MS = 3 * 3_600_000;
/** Debajo de este margen Meta ya podría rechazar el texto (ver ventana-24h.ts). */
const MARGEN_MS = 10 * 60_000;

function horaLima(d: Date): number {
  const h = new Intl.DateTimeFormat("en-GB", { timeZone: "America/Lima", hour: "2-digit", minute: "2-digit", hour12: false })
    .format(d)
    .split(":")
    .map(Number);
  return (h[0] % 24) + h[1] / 60;
}

export function horaCierreTexto(cierre: Date): string {
  return new Intl.DateTimeFormat("es-PE", {
    timeZone: "America/Lima",
    weekday: "long",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(cierre);
}

/**
 * ¿Toca avisar ahora? `ultimoEntrante`: último mensaje del supervisor. `avisoYaEnviado`: si
 * ya salió el aviso después de ese mensaje (una vez por ventana).
 */
export function debeAvisarVentana(ultimoEntrante: Date | null, avisoYaEnviado: boolean, ahora: Date = new Date()): boolean {
  if (!ultimoEntrante || avisoYaEnviado) return false;
  const cierre = ultimoEntrante.getTime() + VENTANA_WHATSAPP_MS;
  const restante = cierre - ahora.getTime();
  if (restante <= MARGEN_MS) return false; // ya no se puede mandar texto
  if (restante <= AVISAR_ANTES_MS) return true;
  const h = horaLima(ahora);
  if (h >= 20 && h < 22) {
    // ¿Cierra antes de las 10:00 de mañana (Lima)? Hasta las 10:00 de mañana faltan (34 - h) h.
    const hastaMananaDiez = (34 - h) * 3_600_000;
    return restante < hastaMananaDiez;
  }
  return false;
}

export function textoAvisoVentana(nombre: string, cierre: Date): string {
  return (
    `${MARCA_AVISO_VENTANA} se cierra el ${horaCierreTexto(cierre)}* (hora Perú).\n\n` +
    `${nombre}, respóndeme cualquier cosa (por ejemplo *ok*) para mantenerla abierta 24 h más. ` +
    `Si se cierra, los avisos del CRM no te llegarán hasta que vuelvas a escribir.`
  );
}

/** «ok», «listo», «👍»: respuesta para renovar la ventana; no es una orden ni una consulta. */
export function esRenovacionVentana(texto: string | null | undefined): boolean {
  if (!texto) return false;
  const t = texto
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[.!¡\s]+$/g, "")
    .replace(/^[.!¡\s]+/g, "");
  if (!t) return true; // solo puntos o signos
  if (/^(👍|👌|✅|🙌|🆗)+$/u.test(t.replace(/\s|️|[\u{1F3FB}-\u{1F3FF}]/gu, ""))) return true;
  return /^(ok|oki|okey|okay|ok gracias|listo|activo|aqui|aqui estoy|presente|renovar|renueva|ventana|sigo aqui|vale|dale|gracias)$/.test(t);
}
