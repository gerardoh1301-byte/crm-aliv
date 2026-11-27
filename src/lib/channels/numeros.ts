import "server-only";
import { db } from "@/db";
import { channelAccounts, conversations, contacts, crmSettings } from "@/db/schema";
import { and, desc, eq, inArray, isNull, or } from "drizzle-orm";
import {
  CLAVE_CUENTA_BOT,
  CLAVE_CUENTA_PEDIDOS_WEB,
  CLAVE_CUENTAS_CON_BOT,
  CLAVE_NUMEROS_VENDEDOR,
  atiendeVendedor,
  elegirCuentaBot,
  elegirCuentaPedidosWeb,
  elegirCuentasConBot,
  esNumeroDeVendedor,
  esNumeroPropio,
  vendedorDelNumero,
  type CuentaWhatsapp,
} from "./numeros-reglas";

/** Las cuentas cambian muy poco: 1 minuto de memoria evita una consulta por mensaje. */
const TTL_MS = 60_000;
let cache: {
  en: number;
  cuentas: CuentaWhatsapp[];
  bot: CuentaWhatsapp | null;
  pedidosWeb: CuentaWhatsapp | null;
  /** Cuentas de vendedor donde por ahora atiende el bot (CLAVE_CUENTAS_CON_BOT). */
  conBot: string[];
  mapa: string | null;
} | null = null;

export function limpiarCacheNumeros(): void {
  cache = null;
}

async function leer(): Promise<NonNullable<typeof cache>> {
  if (cache && Date.now() - cache.en < TTL_MS) return cache;
  const cuentas = (await db
    .select({
      id: channelAccounts.id,
      provider: channelAccounts.provider,
      platform: channelAccounts.platform,
      zernioAccountId: channelAccounts.zernioAccountId,
      username: channelAccounts.username,
      status: channelAccounts.status,
      createdAt: channelAccounts.createdAt,
    })
    .from(channelAccounts)
    .where(eq(channelAccounts.platform, "whatsapp"))) as CuentaWhatsapp[];
  const ajustes = await db
    .select()
    .from(crmSettings)
    .where(inArray(crmSettings.key, [CLAVE_CUENTA_BOT, CLAVE_NUMEROS_VENDEDOR, CLAVE_CUENTA_PEDIDOS_WEB, CLAVE_CUENTAS_CON_BOT]));
  const valor = (k: string) => ajustes.find((a) => a.key === k)?.value ?? null;
  const bot = elegirCuentaBot(cuentas, valor(CLAVE_CUENTA_BOT));
  cache = {
    en: Date.now(),
    cuentas,
    bot,
    pedidosWeb: elegirCuentaPedidosWeb(cuentas, valor(CLAVE_CUENTA_PEDIDOS_WEB), bot),
    conBot: elegirCuentasConBot(cuentas, valor(CLAVE_CUENTAS_CON_BOT)),
    mapa: valor(CLAVE_NUMEROS_VENDEDOR),
  };
  return cache;
}

/** Cuenta de WhatsApp del bot (la que tiene las plantillas aprobadas). */
export async function cuentaBotWhatsapp(): Promise<CuentaWhatsapp | null> {
  return (await leer()).bot;
}

/** true si la cuenta es el número de un vendedor (cualquier WhatsApp que no sea el del bot). */
export async function esCuentaDeVendedor(accountId: string | null | undefined): Promise<boolean> {
  const d = await leer();
  if (accountId && d.conBot.includes(accountId)) return false;
  return esNumeroDeVendedor(accountId, d.bot, d.cuentas);
}

/** true si el teléfono del contacto es uno de nuestros propios números de WhatsApp. */
export async function esContactoNumeroPropio(telefono: string | null | undefined): Promise<boolean> {
  return esNumeroPropio(telefono, (await leer()).cuentas);
}

/** Cuenta por la que sale el primer mensaje de los pedidos de Shopify (null = la del bot). */
export async function cuentaPedidosWeb(): Promise<CuentaWhatsapp | null> {
  return (await leer()).pedidosWeb;
}

/** true si en esa conversación atiende una persona y no el bot (ver atiendeVendedor). */
export async function atiendeVendedorEn(conv: { accountId: string | null | undefined; aiEnabled?: boolean | null }): Promise<boolean> {
  const d = await leer();
  if (conv.accountId && d.conBot.includes(conv.accountId)) return false;
  return atiendeVendedor(conv, d.bot, d.cuentas, d.pedidosWeb);
}

/**
 * Chat del contacto en la cuenta de pedidos web, con el bot encendido. Si no existe, crea el
 * hilo provisorio `zernio:<cuenta>:+51…` (el del bot es `zernio:+51…` y la clave es única).
 */
export async function conversacionPedidoWeb(contactId: string): Promise<string | null> {
  const cuenta = await cuentaPedidosWeb();
  if (!cuenta) return null;
  const [existente] = await db
    .select({ id: conversations.id, aiEnabled: conversations.aiEnabled })
    .from(conversations)
    .where(and(eq(conversations.contactId, contactId), eq(conversations.channel, "whatsapp"), eq(conversations.accountId, cuenta.id)))
    .orderBy(desc(conversations.lastMessageAt))
    .limit(1);
  if (existente) {
    // Si ya tenía chat con el vendedor, el bot lo atiende para este pedido.
    if (!existente.aiEnabled) {
      await db.update(conversations).set({ aiEnabled: true, updatedAt: new Date() }).where(eq(conversations.id, existente.id));
    }
    return existente.id;
  }
  const [contacto] = await db
    .select({ phone: contacts.phone, name: contacts.name, tenantId: contacts.tenantId })
    .from(contacts)
    .where(eq(contacts.id, contactId))
    .limit(1);
  if (!contacto?.phone || !contacto.tenantId) return null;
  const externalId = `zernio:${cuenta.id}:${contacto.phone}`;
  const [creada] = await db
    .insert(conversations)
    .values({
      tenantId: contacto.tenantId,
      accountId: cuenta.id,
      contactId,
      channel: "whatsapp",
      provider: cuenta.provider,
      externalId,
      participantId: contacto.phone,
      participantName: contacto.name,
      status: "active",
      aiEnabled: true,
    })
    .onConflictDoNothing()
    .returning({ id: conversations.id });
  if (creada) return creada.id;
  const [previo] = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(and(eq(conversations.provider, cuenta.provider), eq(conversations.externalId, externalId)))
    .limit(1);
  return previo?.id ?? null;
}

/** team_members.id del vendedor dueño de ese número, si se configuró. */
export async function vendedorDeCuenta(accountId: string | null | undefined): Promise<string | null> {
  if (!accountId) return null;
  const d = await leer();
  return vendedorDelNumero(d.cuentas.find((c) => c.id === accountId), d.mapa);
}

/**
 * Conversación del contacto en el número del bot. Si solo tiene chat con un vendedor, crea
 * el hilo provisorio en el número del bot (`zernio:+51…`), igual que las automatizaciones
 * cuando el cliente nunca escribió. Devuelve null si no hay teléfono o cuenta del bot.
 */
export async function conversacionEnNumeroBot(conv: {
  id: string;
  contactId: string | null;
  tenantId: string | null;
  participantId: string | null;
  participantName: string | null;
}): Promise<string | null> {
  const bot = await cuentaBotWhatsapp();
  if (!bot || !conv.contactId) return null;

  const [existente] = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(
      and(
        eq(conversations.contactId, conv.contactId),
        eq(conversations.channel, "whatsapp"),
        or(eq(conversations.accountId, bot.id), isNull(conversations.accountId))
      )
    )
    .orderBy(desc(conversations.lastMessageAt))
    .limit(1);
  if (existente) return existente.id;

  const [contacto] = await db
    .select({ phone: contacts.phone, name: contacts.name, tenantId: contacts.tenantId })
    .from(contacts)
    .where(eq(contacts.id, conv.contactId))
    .limit(1);
  const telefono = contacto?.phone ?? conv.participantId;
  const tenantId = conv.tenantId ?? contacto?.tenantId ?? null;
  if (!telefono || !tenantId) return null;

  const [creada] = await db
    .insert(conversations)
    .values({
      tenantId,
      accountId: bot.id,
      contactId: conv.contactId,
      channel: "whatsapp",
      provider: bot.provider,
      externalId: `zernio:${telefono}`,
      participantId: telefono,
      participantName: contacto?.name ?? conv.participantName,
      status: "active",
    })
    .onConflictDoNothing()
    .returning({ id: conversations.id });
  if (creada) return creada.id;

  // Ya existía el provisorio con ese teléfono (carrera o hilo de otra cuenta): reusarlo.
  const [previo] = await db
    .select({ id: conversations.id, accountId: conversations.accountId })
    .from(conversations)
    .where(and(eq(conversations.provider, bot.provider), eq(conversations.externalId, `zernio:${telefono}`)))
    .limit(1);
  return previo && (previo.accountId === bot.id || !previo.accountId) ? previo.id : null;
}

/**
 * Cuentas de WhatsApp que puede ver un miembro en la bandeja (26/11: Rossana veía también el
 * historial del 944 de sus clientes; en su perfil solo debe aparecer el 977126462).
 *
 * - admin: undefined (ve todo).
 * - vendedor con número propio en `whatsapp.numeros_vendedor`: solo esas cuentas.
 * - vendedor sin número propio (atiende en el número del bot): undefined, como antes.
 */
export async function cuentasVisiblesPara(member: { id: string; role: string }): Promise<string[] | undefined> {
  if (member.role === "admin") return undefined;
  const d = await leer();
  const propias = d.cuentas.filter((c) => vendedorDelNumero(c, d.mapa) === member.id).map((c) => c.id);
  return propias.length > 0 ? propias : undefined;
}


export { cuentaPermitida } from "./numeros-reglas";
