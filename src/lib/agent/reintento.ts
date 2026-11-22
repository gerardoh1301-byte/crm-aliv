/**
 * Qué hacer cuando el bot no logra responder (la IA falla, responde vacío o se queda sin
 * rondas). Puro para poder probarlo.
 *
 * Antes: un solo reintento a los 20 s y luego «Disculpa la demora» + «requiere humano»; como
 * el último mensaje quedaba nuestro, nadie volvía a intentar y el cliente se quedaba con una
 * promesa incumplida si el equipo no estaba (auditoría 21/11, E3).
 *
 * Ahora: 1.ª falla → cortesía y reintento a los 3 min; 2.ª → reintento a los 10 min (sin otro
 * mensaje); 3.ª → recién ahí se avisa al equipo.
 */

export const MENSAJE_CORTESIA = "Disculpa la demora 🙏 En unos minutos te respondo por aquí.";

/** Motivos con que se marca un trabajo del bot que no logró responder. */
export const MOTIVOS_SIN_RESPUESTA = ["llm_failure", "empty_reply", "max_tool_rounds_exceeded"] as const;

/** Ventana en la que se cuentan las fallas anteriores del mismo chat. */
export const VENTANA_FALLAS_MS = 30 * 60_000;

export type DecisionReintento =
  | { accion: "reintentar"; enMs: number; cortesia: boolean }
  | { accion: "avisar_equipo" };

export function decidirReintento(fallasPrevias: number): DecisionReintento {
  if (fallasPrevias <= 0) return { accion: "reintentar", enMs: 3 * 60_000, cortesia: true };
  if (fallasPrevias === 1) return { accion: "reintentar", enMs: 10 * 60_000, cortesia: false };
  return { accion: "avisar_equipo" };
}

/** El mensaje de cortesía no es una respuesta: el historial lo ignora para que el reintento conteste. */
export function esMensajeCortesia(direction: string | null, body: string | null): boolean {
  return direction === "out" && (body ?? "").trim() === MENSAJE_CORTESIA;
}
