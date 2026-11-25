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
  /** Teléfono que muestra Zernio («+51 977 126 462»). */
  username?: string | null;
  status: string;
  createdAt: Date | string;
}

/** crm_settings: id de la cuenta del bot (channel_accounts.id o el accountId de Zernio). */
export const CLAVE_CUENTA_BOT = "whatsapp.cuenta_bot";
/**
 * crm_settings: JSON { "<número, channel_accounts.id o accountId de Zernio>": "<team_members.id>" }.
 * El número sirve para dejarlo listo antes de conectar (ej. { "977126462": "<id de Stephano>" }).
 */
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
  const digitos = (v: string) => v.replace(/\D/g, "").slice(-9);
  const tel = cuenta.username ? digitos(cuenta.username) : "";
  const porNumero = tel.length === 9 ? Object.entries(m).find(([k]) => digitos(k) === tel)?.[1] : undefined;
  const valor = m[cuenta.id] ?? (cuenta.zernioAccountId ? m[cuenta.zernioAccountId] : undefined) ?? porNumero;
  return typeof valor === "string" && valor.trim() ? valor.trim() : null;
}

/**
 * crm_settings: cuenta (channel_accounts.id o accountId de Zernio) por la que sale el primer
 * mensaje de los pedidos nuevos de Shopify (25/11: el 977126462). En los chats que el CRM abre
 * ahí para un pedido atiende el bot; el resto de chats de ese número sigue siendo del vendedor.
 */
export const CLAVE_CUENTA_PEDIDOS_WEB = "whatsapp.cuenta_pedidos_web";

/** Cuenta de los pedidos web: la configurada si está activa y no es la del bot. */
export function elegirCuentaPedidosWeb(
  cuentas: CuentaWhatsapp[],
  configurada: string | null,
  cuentaBot: CuentaWhatsapp | null
): CuentaWhatsapp | null {
  const ref = configurada?.trim();
  if (!ref) return null;
  const c = cuentas.find((x) => x.platform === "whatsapp" && x.status === "active" && coincide(x, ref));
  return c && c.id !== cuentaBot?.id ? c : null;
}

/**
 * true si en esa conversación atiende una persona (número de vendedor) y no el bot. Excepción:
 * los chats con el bot encendido en la cuenta de pedidos web (los abre el CRM para un pedido).
 */
export function atiendeVendedor(
  conv: { accountId: string | null | undefined; aiEnabled?: boolean | null },
  cuentaBot: CuentaWhatsapp | null,
  cuentas: CuentaWhatsapp[],
  cuentaPedidosWeb: CuentaWhatsapp | null
): boolean {
  if (!esNumeroDeVendedor(conv.accountId, cuentaBot, cuentas)) return false;
  return !(cuentaPedidosWeb && conv.accountId === cuentaPedidosWeb.id && conv.aiEnabled);
}
