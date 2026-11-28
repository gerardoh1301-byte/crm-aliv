import "server-only";
import { db } from "@/db";
import { activities, contacts, conversations, crmSettings, messages, teamMembers } from "@/db/schema";
import { and, desc, eq, gte, like } from "drizzle-orm";
import { deliverMessage } from "@/lib/channels/deliver";
import { atiendeVendedorEn, esContactoNumeroPropio, vendedorDeCuenta } from "@/lib/channels/numeros";
import { enviarTextoInterno } from "@/lib/alerts/conversacion-supervisor";
import { SUPERVISOR_ADMINISTRADOR } from "@/lib/alerts/perfiles-supervisor";
import { esNumeroEntrenador } from "@/lib/alerts/supervisor-alerts";
import { contactoBloqueado } from "@/lib/contactos/bloqueo";
import { createChatCompletionWithFallback, getAgentModel, hasOpenRouterKey } from "@/lib/agent/openrouter";
import {
  CLAVE_BORRADOR_VENDEDORA,
  CLAVE_ULTIMO_AVISO_VENDEDORA,
  VIGENCIA_BORRADOR_MS,
  cuerpoParaAviso,
  refCliente,
  textoAvisoVendedora,
  type RespuestaVendedora,
} from "./reenvio-vendedora-reglas";

/** Ver reenvio-vendedora-reglas.ts. */

interface Destino {
  conversationId: string;
  contactId: string;
  nombre: string;
  ref: string;
}

async function leerAjuste<T>(clave: string): Promise<T | null> {
  const [row] = await db.select().from(crmSettings).where(eq(crmSettings.key, clave)).limit(1);
  if (!row) return null;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return null;
  }
}

async function guardarAjuste(clave: string, valor: unknown | null): Promise<void> {
  if (valor === null) {
    await db.delete(crmSettings).where(eq(crmSettings.key, clave));
    return;
  }
  const value = JSON.stringify(valor);
  await db.insert(crmSettings).values({ key: clave, value }).onConflictDoUpdate({ target: crmSettings.key, set: { value } });
}

/**
 * Llamado desde ingestMessage con cada mensaje entrante en vivo. Solo actúa si el chat es de
 * un número de vendedor (whatsapp.numeros_vendedor). Nunca lanza: el ingreso no se frena.
 */
export async function avisarMensajeVendedora(
  conv: { id: string; contactId: string | null; accountId: string | null; channel: string; aiEnabled?: boolean | null },
  msg: { body: string | null; type?: string | null }
): Promise<void> {
  try {
    if (conv.channel !== "whatsapp" || !conv.contactId) return;
    const vendedorId = await vendedorDeCuenta(conv.accountId);
    if (!vendedorId) return;

    const [c] = await db
      .select({ name: contacts.name, phone: contacts.phone, tags: contacts.tags })
      .from(contacts)
      .where(eq(contacts.id, conv.contactId))
      .limit(1);
    if (!c || esNumeroEntrenador(c.phone) || contactoBloqueado(c.tags)) return;
    // Avisos internos del 944 a la vendedora (ventana renovada, pendientes): no son clientes.
    if (await esContactoNumeroPropio(c.phone)) return;

    const [vendedora] = await db
      .select({ name: teamMembers.name })
      .from(teamMembers)
      .where(eq(teamMembers.id, vendedorId))
      .limit(1);
    const { resumenPedidoParaAviso } = await import("./comandos");
    const pedido = await resumenPedidoParaAviso(conv.contactId).catch(() => null);
    const botEncendido = !(await atiendeVendedorEn(conv));

    const texto = textoAvisoVendedora({
      nombre: c.name,
      telefono: c.phone,
      cuerpo: cuerpoParaAviso(msg.body, msg.type),
      pedido,
      botEncendido,
      vendedora: vendedora?.name?.split(" ")[0] ?? null,
      conversationId: conv.id,
    });
    const destino: Destino = {
      conversationId: conv.id,
      contactId: conv.contactId,
      nombre: c.name || "cliente",
      ref: refCliente(c.phone),
    };
    await guardarAjuste(CLAVE_ULTIMO_AVISO_VENDEDORA, destino);
    const res = await enviarTextoInterno(SUPERVISOR_ADMINISTRADOR, texto);
    if (!res.ok) console.warn("[reenvio-vendedora] aviso no enviado:", res.error);
  } catch (err) {
    console.warn("[reenvio-vendedora] error al avisar:", err);
  }
}

/** Chat del cliente en el número de la vendedora: por los 4 dígitos o el del último aviso. */
async function buscarDestino(ref: string | null): Promise<Destino | null> {
  if (!ref) return leerAjuste<Destino>(CLAVE_ULTIMO_AVISO_VENDEDORA);
  const filas = await db
    .select({
      conversationId: conversations.id,
      contactId: conversations.contactId,
      accountId: conversations.accountId,
      nombre: contacts.name,
    })
    .from(conversations)
    .innerJoin(contacts, eq(contacts.id, conversations.contactId))
    .where(
      and(
        eq(conversations.channel, "whatsapp"),
        like(contacts.phone, `%${ref}`),
        gte(conversations.lastInboundAt, new Date(Date.now() - 14 * 24 * 3600 * 1000))
      )
    )
    .orderBy(desc(conversations.lastInboundAt))
    .limit(10);
  for (const f of filas) {
    if (f.contactId && (await vendedorDeCuenta(f.accountId))) {
      return { conversationId: f.conversationId, contactId: f.contactId, nombre: f.nombre || "cliente", ref };
    }
  }
  return null;
}

async function ultimosMensajes(conversationId: string): Promise<string[]> {
  const filas = await db
    .select({ body: messages.body, direction: messages.direction })
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(desc(messages.createdAt))
    .limit(14);
  return filas
    .reverse()
    .filter((m) => m.body?.trim())
    .map((m) => `${m.direction === "in" ? "Cliente" : "Aliv"}: ${m.body!.trim().slice(0, 400)}`);
}

async function redactar(instruccion: string, d: Destino): Promise<string | null> {
  if (!hasOpenRouterKey()) return null;
  const chat = await ultimosMensajes(d.conversationId);
  const prompt = `Eres la asesora de ventas de Aliv Perú (suplementos NAC600 y Termix; pago contra entrega en Lima, o adelanto de S/20 y agencia Shalom en provincia). Escribe UN mensaje de WhatsApp para ${d.nombre} siguiendo la instrucción de Gerardo, el dueño.

INSTRUCCIÓN DE GERARDO: ${instruccion}

CHAT RECIENTE (del más antiguo al más reciente):
${chat.join("\n") || "(sin mensajes)"}

REGLAS: español peruano, cálido y breve (máximo 3 frases), tutea, como mucho un emoji. Di solo lo que pide la instrucción: no inventes precios, fechas, montos, claves ni promesas que no estén en la instrucción o en el chat. No firmes como bot. Responde SOLO el texto del mensaje.`;
  try {
    const r = await createChatCompletionWithFallback(
      { model: getAgentModel(), messages: [{ role: "user", content: prompt }], temperature: 0.4 },
      { origen: "supervisor_ordenes", timeout: 12_000, totalTimeoutMs: 25_000 }
    );
    const t = r.choices[0]?.message?.content?.trim().replace(/^["“«]|["”»]$/g, "").trim();
    return t || null;
  } catch (err) {
    console.warn("[reenvio-vendedora] no se pudo redactar:", err instanceof Error ? err.message : err);
    return null;
  }
}

async function enviarAlCliente(d: Destino, texto: string): Promise<string> {
  // "human": sale por el número de la vendedora (lo automático se desviaría al 944).
  const res = await deliverMessage(d.conversationId, { text: texto }, "human");
  if (!res.ok) {
    const motivo =
      res.error === "fuera_de_ventana_24h" ? "pasaron más de 24 h desde su último mensaje" : res.error ?? "error";
    return `❌ No se pudo enviar a ${d.nombre} (ref ${d.ref}): ${motivo}.`;
  }
  await db.insert(activities).values({
    id: crypto.randomUUID(),
    type: "note",
    description: `↩️ Gerardo respondió por WhatsApp desde el número de la vendedora: «${texto}»`,
    contactId: d.contactId,
  });
  return `✅ Enviado a ${d.nombre} (ref ${d.ref}) desde el 977:\n«${texto}»`;
}

interface Borrador extends Destino {
  texto: string;
  creado: number;
}

/** Atiende «r …» del Administrador y devuelve la respuesta para su chat. */
export async function atenderRespuestaVendedora(r: RespuestaVendedora): Promise<string> {
  if (r.tipo === "confirmar" || r.tipo === "descartar") {
    const b = await leerAjuste<Borrador>(CLAVE_BORRADOR_VENDEDORA);
    await guardarAjuste(CLAVE_BORRADOR_VENDEDORA, null);
    if (!b || Date.now() - b.creado > VIGENCIA_BORRADOR_MS) {
      return "No hay ningún borrador pendiente (vencen a los 30 min).";
    }
    if (r.tipo === "descartar") return `🗑️ Borrador para ${b.nombre} descartado. No se envió nada.`;
    return enviarAlCliente(b, b.texto);
  }

  const d = await buscarDestino(r.ref);
  if (!d) {
    return r.ref
      ? `No encontré un chat del 977 con un número que termine en ${r.ref} (últimos 14 días).`
      : "No hay un aviso reciente del 977. Escribe *r <4 últimos dígitos> <mensaje>*.";
  }
  if (r.literal) return enviarAlCliente(d, r.texto);

  const texto = await redactar(r.texto, d);
  if (!texto) return `❌ No pude redactar el mensaje (IA no disponible). Mándalo exacto: *r ${d.ref} "tu texto"*`;
  const borrador: Borrador = { ...d, texto, creado: Date.now() };
  await guardarAjuste(CLAVE_BORRADOR_VENDEDORA, borrador);
  return `✍️ Borrador para ${d.nombre} (ref ${d.ref}):\n«${texto}»\n\nResponde *r ok* para enviarlo desde el 977 o *r no* para descartarlo.`;
}
