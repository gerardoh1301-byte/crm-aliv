/**
 * Respuesta fija cuando la IA falla DESPUÉS de haber ejecutado herramientas (puro, sin red).
 *
 * Caso real 23/11 (pedido #1175): el cliente dio «Martes 24 a partir de las 2pm», el bot agendó
 * la entrega y avisó al asesor, pero al escribir la confirmación Gemini falló y el respaldo
 * (OpenRouter) devolvió 401. Como ya había herramientas ejecutadas no se reintenta (podría
 * duplicar acciones) y el cliente recibió solo «Disculpa la demora», sin confirmación.
 *
 * Ahora, si lo que se hizo se puede contar sin IA, se le cuenta al cliente:
 * 1. el texto que el modelo ya había escrito junto a las herramientas, si lo hubo;
 * 2. si se agendó una entrega, una confirmación con el día y el horario.
 * Si no hay nada seguro que decir, devuelve null y sigue el aviso de siempre.
 */

export interface HerramientaEjecutada {
  nombre: string;
  args: unknown;
  ok: boolean;
}

function primerNombre(nombre: string | null | undefined): string {
  const n = (nombre ?? "").trim().split(/\s+/)[0] ?? "";
  // Un «nombre» que es un teléfono o un usuario no sirve para saludar.
  return /^[\p{L}][\p{L}'-]{1,}$/u.test(n) ? n.charAt(0).toUpperCase() + n.slice(1).toLowerCase() : "";
}

/** "2026-11-24" → "el martes 24 de noviembre" (sin depender de la zona del servidor). */
export function fechaLegible(fecha: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(fecha.trim());
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12));
  if (Number.isNaN(d.getTime())) return null;
  const texto = new Intl.DateTimeFormat("es-PE", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(d);
  return `el ${texto.replace(",", "")}`;
}

function textoArg(args: unknown, clave: string): string {
  const v = (args as Record<string, unknown> | null)?.[clave];
  return typeof v === "string" ? v.trim() : "";
}

export function mensajeRespaldoTrasHerramientas(params: {
  nombre: string | null;
  herramientas: HerramientaEjecutada[];
  textoParcial?: string | null;
}): string | null {
  const parcial = (params.textoParcial ?? "").trim();
  // El texto del modelo solo vale si todas las herramientas salieron bien (si no, podría prometer algo que no se hizo).
  if (parcial && params.herramientas.every((h) => h.ok)) return parcial;

  const entrega = [...params.herramientas]
    .reverse()
    .find((h) => h.nombre === "agendar_entrega" && h.ok && (textoArg(h.args, "tipo") || "entrega") === "entrega");
  if (!entrega) return null;

  const fecha = fechaLegible(textoArg(entrega.args, "fecha"));
  if (!fecha) return null;
  const horario = textoArg(entrega.args, "horario");
  // El horario a veces repite el día ("Martes 24 a partir de las 2pm"): se usa tal cual entre paréntesis.
  const cuando = horario ? `${fecha} (${horario.replace(/\.$/, "")})` : fecha;
  const nombre = primerNombre(params.nombre);

  return [
    `¡Listo${nombre ? `, ${nombre}` : ""}! 🙌 Tu entrega quedó agendada para ${cuando}.`,
    "Pagas al recibir. El motorizado te escribe o te llama antes de llegar.",
    "",
    "¿Hay alguna referencia que le ayude a ubicar tu dirección más rápido? 📍",
  ].join("\n");
}
