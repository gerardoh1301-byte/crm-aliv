import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Detección de contestadora de Twilio (AMD asíncrono). La herramienta voicemail_detection
 * de ElevenLabs no se activaba con los buzones peruanos: empiezan con pitido o silencio que
 * el transcriptor ve como «...», y Sofía esperaba 15 s o dejaba un mensaje de hasta 3 min.
 * Twilio reconoce la contestadora por el audio y avisa a /api/webhooks/twilio-amd, que cuelga.
 */

export const RUTA_AMD = "/api/webhooks/twilio-amd";

/**
 * Siempre el CRM en producción (como el webhook post-llamada de ElevenLabs): una llamada
 * lanzada desde la PC con un APP_BASE_URL viejo (túnel local) dejaba el aviso de Twilio
 * en el aire (HTTP 502, 27/11). VOICE_WEBHOOK_BASE_URL lo cambia si hiciera falta.
 */
export function urlCallbackAmd(): string {
  const base = (process.env.VOICE_WEBHOOK_BASE_URL || "https://crm-aliv.onrender.com").trim().replace(/\/$/, "");
  return `${base}${RUTA_AMD}`;
}

/** Parámetros que se suman a la creación de la llamada en Twilio. */
export function parametrosAmd(): Record<string, string> {
  return {
    MachineDetection: "Enable",
    AsyncAmd: "true",
    AsyncAmdStatusCallback: urlCallbackAmd(),
    AsyncAmdStatusCallbackMethod: "POST",
  };
}

/** machine_start, machine_end_beep/silence/other y fax: contestadora. human y unknown: se sigue. */
export function esContestadora(answeredBy: string | null | undefined): boolean {
  const v = String(answeredBy ?? "").toLowerCase();
  return v.startsWith("machine") || v === "fax";
}

/** Firma X-Twilio-Signature: HMAC-SHA1 de la URL + parámetros ordenados, en base64. */
export function firmaTwilio(url: string, params: Record<string, string>, authToken: string): string {
  const datos = url + Object.keys(params).sort().map((k) => k + params[k]).join("");
  return createHmac("sha1", authToken).update(datos, "utf8").digest("base64");
}

export function firmaTwilioValida(
  url: string,
  params: Record<string, string>,
  firma: string | null | undefined,
  authToken: string
): boolean {
  if (!firma || !authToken) return false;
  const esperada = Buffer.from(firmaTwilio(url, params, authToken));
  const recibida = Buffer.from(firma);
  return esperada.length === recibida.length && timingSafeEqual(esperada, recibida);
}
