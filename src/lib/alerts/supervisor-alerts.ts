import "server-only";
import { db } from "@/db";
import { contacts, conversations } from "@/db/schema";
import { eq } from "drizzle-orm";
import { deliverMessage } from "@/lib/channels/deliver";

/**
 * Números autorizados como Supervisores y Entrenadores del sistema:
 * - Gerardo Huaynalaya / Aliv Perú (+51951365418)
 * - Supervisor Aliado / Lourdes (+51945226853)
 */
export const SUPERVISORES_PHONES = [
  "+51951365418",
  "+51945226853",
  "951365418",
  "945226853",
];

/** Últimos 9 dígitos de cada supervisor (para consultas SQL y comparaciones). */
export const SUPERVISORES_DIGITOS = ["951365418", "945226853"] as const;
/** Gerardo: recibe los avisos de pago (envío Shalom confirmado). */
export const SUPERVISOR_PAGOS = "951365418";

export function normalizarTelefono(phone: string | null | undefined): string {
  if (!phone) return "";
  return phone.replace(/\D/g, "");
}

/**
 * Verifica si un número de teléfono corresponde a uno de los Supervisores / Entrenadores oficiales.
 */
export function esNumeroEntrenador(phone: string | null | undefined): boolean {
  if (!phone) return false;
  const digits = normalizarTelefono(phone);
  // Revisa terminaciones de 9 dígitos para Perú
  return SUPERVISORES_DIGITOS.some((d) => digits.endsWith(d));
}

export type TipoSituacionCritica =
  | "comprobante_pago"
  | "reclamo_medico"
  | "pide_humano_llamada"
  | "shalom_24h_retraso"
  | "shalom_preguia_pago_almacen"
  | "pedido_chat"
  | "pedido_shopify"
  | "guardrail_bloqueo"
  | "bot_sin_respuesta"
  | "shalom_envio_confirmado";

export interface AlertaSupervisorInput {
  tipo: TipoSituacionCritica;
  titulo: string;
  detalle: string;
  clienteNombre?: string | null;
  clienteTelefono?: string | null;
  contactId?: string | null;
  conversationId?: string | null;
  /** Restringe el aviso a estos supervisores (9 dígitos). Por defecto, a todos. */
  soloA?: readonly string[];
}

const TITULOS_ALERTA: Record<TipoSituacionCritica, string> = {
  comprobante_pago: "💳 Comprobante / Pago Recibido",
  reclamo_medico: "⚠️ Reclamo / Inconformidad o Molestia",
  pide_humano_llamada: "📞 Solicitud de Asesor Humano / Llamada",
  shalom_24h_retraso: "📦 Paquete >24h en Agencia Shalom sin retirar",
  shalom_preguia_pago_almacen: "📦 Preguía Shalom + AliClik lista · Verificar y Pagar Almacén",
  pedido_chat: "🛒 Pedido nuevo registrado por el bot",
  pedido_shopify: "🛍️ Pedido nuevo de la web (Shopify)",
  guardrail_bloqueo: "🛑 Respuesta del bot bloqueada (clave o monto)",
  bot_sin_respuesta: "🔇 El bot no pudo responder",
  shalom_envio_confirmado: "✅ Envío confirmado en Shalom · ya puedes pagarlo",
};

/** Tipos que pueden repetirse en ráfaga (p. ej. Gemini caído): un aviso por chat cada 30 min. */
const TIPOS_CON_PAUSA = new Set<TipoSituacionCritica>(["guardrail_bloqueo", "bot_sin_respuesta"]);
const PAUSA_MS = 30 * 60 * 1000;
const ultimoAviso = new Map<string, number>();

/** Decide si un aviso repetido debe omitirse (exportado para pruebas). */
export function avisoEnPausa(
  tipo: TipoSituacionCritica,
  clave: string | null | undefined,
  ahora = Date.now()
): boolean {
  if (!TIPOS_CON_PAUSA.has(tipo) || !clave) return false;
  const k = `${tipo}:${clave}`;
  const prev = ultimoAviso.get(k);
  if (prev && ahora - prev < PAUSA_MS) return true;
  ultimoAviso.set(k, ahora);
  return false;
}

/**
 * Envía una alerta inmediata a los 2 números de supervisión (951365418 y 945226853)
 * ante situaciones críticas operativas del CRM.
 */
export async function notificarSupervisoresCritico(input: AlertaSupervisorInput): Promise<{
  notificados: number;
  errores: string[];
}> {
  // Nunca avisar sobre los propios supervisores (sus chats son pruebas).
  if (esNumeroEntrenador(input.clienteTelefono)) return { notificados: 0, errores: [] };
  if (avisoEnPausa(input.tipo, input.conversationId ?? input.contactId)) return { notificados: 0, errores: [] };
  const encTitle = TITULOS_ALERTA[input.tipo] ?? input.titulo;
  const clienteStr = input.clienteNombre ? `${input.clienteNombre} (${input.clienteTelefono ?? "sin número"})` : input.clienteTelefono ?? "Cliente";
  
  const mensajeAlerta = `🚨 *ALERTA CRM - ${encTitle}*\n` +
    `👤 *Cliente:* ${clienteStr}\n` +
    `📝 *Detalle:* ${input.detalle}\n` +
    (input.conversationId ? `🔗 *Chat CRM:* https://crm-aliv.onrender.com/conversations/${input.conversationId}\n` : "") +
    `⏰ *Fecha:* ${new Date().toLocaleTimeString("es-PE", { timeZone: "America/Lima" })} (Hora Perú)`;

  let notificados = 0;
  const errores: string[] = [];

  // Buscar si existen conversaciones activas con los supervisores para enviarles el mensaje por WhatsApp
  const destinos = SUPERVISORES_DIGITOS.filter((d) => !input.soloA || input.soloA.includes(d)).map((d) => `+51${d}`);
  for (const supRaw of destinos) {
    try {
      const [supContact] = await db
        .select({ id: contacts.id })
        .from(contacts)
        .where(eq(contacts.phone, supRaw))
        .limit(1);

      if (supContact) {
        const [supConv] = await db
          .select({ id: conversations.id })
          .from(conversations)
          .where(eq(conversations.contactId, supContact.id))
          .limit(1);

        if (supConv) {
          const detallePlantilla = input.detalle.replace(/\s+/g, " ").trim().slice(0, 220);
          let res = await deliverMessage(
            supConv.id,
            {
              text: mensajeAlerta,
              template: {
                name: "aliv_alerta_supervisor",
                language: "es",
                params: [encTitle, clienteStr, detallePlantilla],
                previewText: mensajeAlerta,
              },
            },
            "agent"
          );

          // Fallback resiliente: si la plantilla no está aprobada aún en Meta, enviar como texto plano directo
          if (!res.ok) {
            console.warn(`[notificarSupervisoresCritico] Plantilla falló (${res.error}), reintentando como texto plano para supervisor ${supRaw}...`);
            res = await deliverMessage(
              supConv.id,
              { text: mensajeAlerta },
              "agent"
            );
          }

          if (res.ok) {
            notificados++;
            continue;
          } else {
            errores.push(`${supRaw}: ${res.error}`);
          }
        }
      }
    } catch (err) {
      console.warn(`[notificarSupervisoresCritico] Error al alertar a ${supRaw}:`, err);
      errores.push(String(err));
    }
  }

  return { notificados, errores };
}
