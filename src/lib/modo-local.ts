/**
 * MODO LOCAL: el CRM corriendo en tu maquina sin cuentas de nada.
 */

/** Id fijo del administrador de Aliv Store. */
export const ID_MIEMBRO_LOCAL = "00000000-0000-4000-8000-000000000001";
export const EMAIL_MIEMBRO_LOCAL = "admin@alivstore.shop";
export const NOMBRE_MIEMBRO_LOCAL = "Administrador Aliv";

/** Id fijo del vendedor / asesor de ventas de Aliv Store. */
export const ID_VENDEDOR_LOCAL = "00000000-0000-4000-8000-000000000002";
export const EMAIL_VENDEDOR_LOCAL = "vendedor@alivstore.shop";
export const NOMBRE_VENDEDOR_LOCAL = "Vendedor Aliv";

/** Cookie de sesion para acceso local de equipo */
export const COOKIE_SESION_LOCAL = "aliv_session_member_id";

/** Carpeta (relativa a la raiz del repo) donde vive la base embebida. */
export const CARPETA_BASE_LOCAL = ".local/db";

export function modoLocal(): boolean {
  return process.env.MODO_LOCAL === "true";
}
