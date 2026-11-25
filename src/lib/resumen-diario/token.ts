import crypto from "node:crypto";

/**
 * Enlace del PDF del resumen: WhatsApp (Zernio) lo descarga por URL pública, así que la ruta
 * es pública pero firmada: `<fecha>.<destino>.<firma>`. Sin base de datos: la firma se
 * recalcula. Vence a los 3 días.
 */
const VIGENCIA_MS = 3 * 24 * 60 * 60 * 1000;

function firma(fecha: string, destino: string, secreto: string): string {
  return crypto.createHmac("sha256", secreto).update(`resumen:${fecha}:${destino}`).digest("base64url").slice(0, 32);
}

export function tokenResumen(fecha: string, destino: string, secreto: string): string {
  return `${fecha}.${destino}.${firma(fecha, destino, secreto)}`;
}

export function leerTokenResumen(
  token: string,
  secreto: string,
  ahora = new Date()
): { fecha: string; destino: string } | null {
  const m = /^(\d{4}-\d{2}-\d{2})\.([A-Za-z0-9-]{1,64})\.([A-Za-z0-9_-]{32})$/.exec(token);
  if (!m || !secreto) return null;
  const [, fecha, destino, f] = m;
  const esperada = firma(fecha, destino, secreto);
  if (!crypto.timingSafeEqual(Buffer.from(f), Buffer.from(esperada))) return null;
  const edad = ahora.getTime() - new Date(`${fecha}T05:00:00Z`).getTime();
  if (edad > VIGENCIA_MS || edad < -VIGENCIA_MS) return null;
  return { fecha, destino };
}
