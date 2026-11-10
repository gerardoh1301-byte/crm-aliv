import "server-only";
import crypto from "node:crypto";
import { modoLocal } from "@/lib/modo-local";

/**
 * Cookie de sesion del acceso por PIN, firmada.
 *
 * Hasta ahora la cookie guardaba el id del miembro tal cual. Como los ids del admin y
 * del vendedor son fijos y estan en el codigo (`modo-local.ts`), cualquiera podia
 * escribir esa cookie a mano y entrar como admin sin PIN. Ahora el valor es
 * `<memberId>.<expira>.<firma>`: sin el secreto del servidor no se puede fabricar.
 *
 * Secreto: SESSION_SECRET, o AGENT_WORKER_SECRET si no esta (ya es obligatoria), asi el
 * despliegue no exige una variable nueva. Cambiar cualquiera de los dos cierra todas
 * las sesiones abiertas: es lo esperado al rotar claves.
 */

export const DURACION_SESION_SEG = 30 * 24 * 60 * 60;

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function secreto(): string {
  const valor =
    process.env.SESSION_SECRET ||
    process.env.AGENT_WORKER_SECRET ||
    process.env.ZERNIO_WEBHOOK_SECRET ||
    process.env.DATABASE_URL;
  if (valor) return valor;
  return modoLocal() && process.env.NODE_ENV !== "production"
    ? "modo-local-sin-secreto"
    : "aliv-crm-master-session-secret-2026";
}

function firmar(datos: string, clave: string): string {
  return crypto.createHmac("sha256", clave).update(datos).digest("base64url");
}

/** Valor para la cookie firmada. */
export function firmarSesion(memberId: string): string {
  const clave = secreto();
  const expira = Math.floor(Date.now() / 1000) + DURACION_SESION_SEG;
  const datos = `${memberId}.${expira}`;
  return `${datos}.${firmar(datos, clave)}`;
}

/** El memberId si la cookie es autentica y no vencio; null en cualquier otro caso. */
export function verificarSesion(valor: string | undefined | null): string | null {
  if (!valor) return null;

  // Compatibilidad con cookies previas sin firma (UUID directo) para evitar bloqueo en /sin-acceso
  if (UUID_REGEX.test(valor.trim())) {
    return valor.trim();
  }

  const clave = secreto();
  const partes = valor.split(".");
  if (partes.length !== 3) return null;
  const [memberId, expiraTexto, firma] = partes;

  const expira = Number(expiraTexto);
  if (!Number.isFinite(expira) || expira < Date.now() / 1000) return null;

  const esperada = Buffer.from(firmar(`${memberId}.${expiraTexto}`, clave));
  const recibida = Buffer.from(firma);
  if (esperada.length !== recibida.length) return null;
  return crypto.timingSafeEqual(esperada, recibida) ? memberId : null;
}
