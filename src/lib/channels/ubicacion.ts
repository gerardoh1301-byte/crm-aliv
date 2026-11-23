/**
 * Ubicaciones de WhatsApp que llegan por Zernio (caso Dimas #1163, 22/11).
 *
 * Zernio manda el mensaje como texto «📍 Location», sin adjuntos, y las coordenadas en el
 * `metadata.location` del sobre del webhook (no dentro de `message`). El CRM guardaba solo
 * «📍 Location» y el bot no sabía dónde era. Aquí se arma un texto con el enlace de Google
 * Maps para el bot, el equipo y el motorizado.
 */

export interface UbicacionCliente {
  latitud: number;
  longitud: number;
  nombre?: string;
  direccion?: string;
}

function num(v: unknown): number | null {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

function texto(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

function desdeObjeto(o: unknown): UbicacionCliente | null {
  if (!o || typeof o !== "object") return null;
  const r = o as Record<string, unknown>;
  const lat = num(r.latitude ?? r.lat);
  const lng = num(r.longitude ?? r.lng ?? r.lon);
  if (lat === null || lng === null || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { latitud: lat, longitud: lng, nombre: texto(r.name), direccion: texto(r.address) };
}

/** Busca la ubicación en el sobre del webhook (y, por si Zernio la mueve, dentro del mensaje). */
export function ubicacionDesdePayload(payload: unknown): UbicacionCliente | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, any>;
  return (
    desdeObjeto(p.metadata?.location) ??
    desdeObjeto(p.message?.metadata?.location) ??
    desdeObjeto(p.message?.location) ??
    desdeObjeto((p.message?.attachments ?? []).find((a: any) => String(a?.type ?? "").toLowerCase() === "location"))
  );
}

export function enlaceMaps(u: UbicacionCliente): string {
  return `https://maps.google.com/?q=${u.latitud.toFixed(6)},${u.longitud.toFixed(6)}`;
}

/** Texto que se guarda como cuerpo del mensaje. */
export function textoUbicacion(u: UbicacionCliente): string {
  const lugar = [u.nombre, u.direccion].filter(Boolean).join(", ");
  return `📍 [Ubicación enviada por el cliente${lugar ? `: ${lugar}` : ""}] ${enlaceMaps(u)} (lat ${u.latitud.toFixed(6)}, lng ${u.longitud.toFixed(6)})`;
}
