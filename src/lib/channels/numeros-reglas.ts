/**
 * Varios números de WhatsApp (24/11/2026): el 944392731 es el del bot y la tienda; cada
 * vendedor puede tener su propio número conectado por Zernio (el primero, 977126462).
 *
 * Reglas:
 *  - En el número de un vendedor el bot NO contesta y el chat se asigna a ese vendedor.
 *  - Lo automático (plantillas, confirmaciones, abandonos, rescate, avisos al supervisor)
 *    sale siempre por el número del bot: el del vendedor no tiene plantillas aprobadas.
 *
 * Aquí solo va la lógica pura, sin base, para poder probarla.
 */

export interface CuentaWhatsapp {
  id: string;
  provider: string;
  platform: string;
  zernioAccountId: string | null;
  status: string;
  createdAt: Date | string;
}

/** crm_settings: id de la cuenta del bot (channel_accounts.id o el accountId de Zernio). */
export const CLAVE_CUENTA_BOT = "whatsapp.cuenta_bot";
/** crm_settings: JSON { "<channel_accounts.id o accountId de Zernio>": "<team_members.id>" }. */
export const CLAVE_NUMEROS_VENDEDOR = "whatsapp.numeros_vendedor";

function coincide(c: CuentaWhatsapp, ref: string): boolean {
  return c.id === ref || c.zernioAccountId === ref;
}

/**
 * La cuenta del bot: la configurada si sigue activa; si no, la cuenta de WhatsApp por Zernio
 * activa más antigua (lo mismo que hacía el CRM con un solo número).
 */
export function elegirCuentaBot(cuentas: CuentaWhatsapp[], configurada: string | null): CuentaWhatsapp | null {
  const activas = cuentas
    .filter((c) => c.platform === "whatsapp" && c.status === "active")
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  const ref = configurada?.trim();
  if (ref) {
    const elegida = activas.find((c) => coincide(c, ref));
    if (elegida) return elegida;
  }
  return activas.find((c) => c.provider === "zernio" && c.zernioAccountId) ?? activas[0] ?? null;
}

/**
 * true si la conversación entra por un número de WhatsApp que no es el del bot.
 * Sin cuenta (hilos históricos) o sin cuenta del bot conocida, se trata como del bot.
 */
export function esNumeroDeVendedor(
  accountId: string | null | undefined,
  cuentaBot: CuentaWhatsapp | null,
  cuentas: CuentaWhatsapp[]
): boolean {
  if (!accountId || !cuentaBot) return false;
  if (accountId === cuentaBot.id) return false;
  const cuenta = cuentas.find((c) => c.id === accountId);
  return cuenta?.platform === "whatsapp";
}

/** Vendedor dueño de un número (o null si no se configuró). */
export function vendedorDelNumero(
  cuenta: CuentaWhatsapp | null | undefined,
  mapaJson: string | null
): string | null {
  if (!cuenta || !mapaJson) return null;
  let mapa: unknown;
  try {
    mapa = JSON.parse(mapaJson);
  } catch {
    return null;
  }
  if (!mapa || typeof mapa !== "object") return null;
  const m = mapa as Record<string, unknown>;
  const valor = m[cuenta.id] ?? (cuenta.zernioAccountId ? m[cuenta.zernioAccountId] : undefined);
  return typeof valor === "string" && valor.trim() ? valor.trim() : null;
}
