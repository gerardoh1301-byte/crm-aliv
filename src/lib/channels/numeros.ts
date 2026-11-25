import "server-only";
import { db } from "@/db";
import { channelAccounts, conversations, contacts, crmSettings } from "@/db/schema";
import { and, desc, eq, inArray, isNull, or } from "drizzle-orm";
import {
  CLAVE_CUENTA_BOT,
  CLAVE_NUMEROS_VENDEDOR,
  elegirCuentaBot,
  esNumeroDeVendedor,
  vendedorDelNumero,
  type CuentaWhatsapp,
} from "./numeros-reglas";

/** Las cuentas cambian muy poco: 1 minuto de memoria evita una consulta por mensaje. */
const TTL_MS = 60_000;
let cache: { en: number; cuentas: CuentaWhatsapp[]; bot: CuentaWhatsapp | null; mapa: string | null } | null = null;

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
      status: channelAccounts.status,
      createdAt: channelAccounts.createdAt,
    })
    .from(channelAccounts)
    .where(eq(channelAccounts.platform, "whatsapp"))) as CuentaWhatsapp[];
  const ajustes = await db
    .select()
    .from(crmSettings)
    .where(inArray(crmSettings.key, [CLAVE_CUENTA_BOT, CLAVE_NUMEROS_VENDEDOR]));
  const valor = (k: string) => ajustes.find((a) => a.key === k)?.value ?? null;
  cache = {
    en: Date.now(),
    cuentas,
    bot: elegirCuentaBot(cuentas, valor(CLAVE_CUENTA_BOT)),
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
  return esNumeroDeVendedor(accountId, d.bot, d.cuentas);
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
