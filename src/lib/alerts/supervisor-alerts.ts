import "server-only";
import { db } from "@/db";
import { contacts, conversations } from "@/db/schema";
import { eq } from "drizzle-orm";
import { deliverMessage } from "@/lib/channels/deliver";
import { conversacionInternaDe } from "@/lib/alerts/conversacion-supervisor";

import {
  SUPERVISORES,
  SUPERVISORES_DIGITOS,
  SUPERVISOR_ADMINISTRADOR,
  destinatariosAviso,
  type TipoSituacionCritica,
} from "@/lib/alerts/perfiles-supervisor";

export {
  SUPERVISORES,
  SUPERVISORES_DIGITOS,
  SUPERVISOR_ADMINISTRADOR,
  CATEGORIA_AVISO,
  destinatariosAviso,
} from "@/lib/alerts/perfiles-supervisor";
export type { TipoSituacionCritica, PerfilSupervisor, CategoriaAviso } from "@/lib/alerts/perfiles-supervisor";

/** Números de los supervisores en los formatos de uso común (lista blanca). */
export const SUPERVISORES_PHONES = SUPERVISORES.flatMap((s) => [`+51${s.digitos}`, s.digitos]);

/** Gerardo (Administrador): recibe los avisos de pago y da las órdenes por WhatsApp. */
export const SUPERVISOR_PAGOS = SUPERVISOR_ADMINISTRADOR;

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

/**
 * Los avisos internos salen SIEMPRE como texto libre, nunca como plantilla: Gerardo y el
 * equipo conversan con el CRM todo el día, así que la ventana de 24 h está abierta y una
 * plantilla solo generaría un cobro de Meta (decisión de Gerardo, 23/11/2026). Si la
 * ventana de un supervisor estuviera cerrada, el aviso no sale y queda el error en el log.
 */
export function mensajeAvisoInterno(texto: string): { text: string } {
  return { text: texto };
}

export interface AlertaSupervisorInput {
  tipo: TipoSituacionCritica;
  titulo: string;
  detalle: string;
  clienteNombre?: string | null;
  clienteTelefono?: string | null;
  contactId?: string | null;
  conversationId?: string | null;
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
  cambio_agencia_con_guia: "🔀 Cliente pide otra agencia y la guía ya salió",
  shalom_cambio_destino: "🔀 Shalom registró un cambio de destino · registra la guía nueva",
  aliclik_entregado: "🚚 AliClik entregó un pedido contra entrega · valida la liquidación",
  postulante_nuevo: "🧑‍💼 Bot Reclutador · postulante para Asesor(a) de confirmaciones",
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
 * Envía una alerta inmediata por WhatsApp a los supervisores cuyo perfil recibe
 * la categoría de este aviso (ver `perfiles-supervisor.ts`).
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
  const destinos = destinatariosAviso(input.tipo).map((d) => `+51${d}`);
  for (const supRaw of destinos) {
    try {
      const supConvId = await conversacionInternaDe(supRaw.slice(-9));
      {
        const supConv = supConvId ? { id: supConvId } : null;
        if (supConv) {
          const res = await deliverMessage(supConv.id, mensajeAvisoInterno(mensajeAlerta), "agent");
          if (!res.ok && res.error === "fuera_de_ventana_24h") {
            console.warn(`[notificarSupervisoresCritico] ${supRaw} sin ventana de 24 h: aviso no enviado (sin plantilla, para no generar cobro).`);
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
