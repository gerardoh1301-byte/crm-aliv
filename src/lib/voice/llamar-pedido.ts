import "server-only";
import { db } from "@/db";
import { activities, contacts, crmSettings } from "@/db/schema";
import { eq } from "drizzle-orm";
import { pedidosOrdenes } from "../../../modules/pedidos/tabla";
import { esNumeroEntrenador } from "@/lib/alerts/supervisor-alerts";
import {
  construirVariablesLlamadaPedido,
  MARCA_LLAMADA_IA_INICIADA,
  normalizarTelefonoE164Peru,
  type DatosPedidoParaLlamada,
  type VariablesDinamicasLlamada,
} from "./llamar-pedido-reglas";

export interface ConfigVozIA {
  enabled: boolean;
  apiKey: string | null;
  agentId: string | null;
  agentPhoneNumberId: string | null;
  /** Endpoint configurable por si usa integración Twilio nativa o SIP trunk en ElevenLabs */
  endpointKind: "twilio" | "sip_trunk";
}

async function leerSetting(key: string): Promise<string | null> {
  try {
    const [row] = await db
      .select({ value: crmSettings.value })
      .from(crmSettings)
      .where(eq(crmSettings.key, key))
      .limit(1);
    return row?.value?.trim() || null;
  } catch {
    return null;
  }
}

export const DEFAULT_ELEVENLABS_AGENT_ID = "agent_5201m8c53p8rfe3aydbhvsyqtz8t";
export const DEFAULT_ELEVENLABS_PHONE_NUMBER_ID = "phnum_6201m8c57faefyg8n4rg89w7a8sd";

export async function obtenerConfigVozIA(): Promise<ConfigVozIA> {
  const apiKey = process.env.ELEVENLABS_API_KEY?.trim() || (await leerSetting("voice.elevenlabs_api_key"));
  const agentId =
    process.env.ELEVENLABS_AGENT_ID?.trim() ||
    (await leerSetting("voice.elevenlabs_agent_id")) ||
    DEFAULT_ELEVENLABS_AGENT_ID;
  const agentPhoneNumberId =
    process.env.ELEVENLABS_PHONE_NUMBER_ID?.trim() ||
    (await leerSetting("voice.elevenlabs_phone_number_id")) ||
    DEFAULT_ELEVENLABS_PHONE_NUMBER_ID;
  const rawEnabled = process.env.VOICE_AI_CALLS_ENABLED?.trim() || (await leerSetting("voice.enabled"));
  const kindRaw = process.env.ELEVENLABS_OUTBOUND_KIND?.trim() || (await leerSetting("voice.outbound_kind"));

  const enabled = rawEnabled
    ? rawEnabled.toLowerCase() !== "false" && rawEnabled.toLowerCase() !== "off"
    : Boolean(apiKey && agentId && agentPhoneNumberId);

  return {
    enabled,
    apiKey: apiKey || null,
    agentId: agentId || null,
    agentPhoneNumberId: agentPhoneNumberId || null,
    endpointKind: kindRaw === "sip_trunk" ? "sip_trunk" : "twilio",
  };
}

export interface ResultadoDisparoLlamada {
  ok: boolean;
  omitido?: boolean;
  motivo?: string;
  callId?: string;
  conversationId?: string;
  variables?: VariablesDinamicasLlamada;
}

/**
 * Dispara de inmediato la llamada de confirmación por ElevenLabs Conversational AI + Twilio
 * apenas ingresa el pedido en Shopify (o al solicitarse manualmente desde el CRM).
 */
export async function dispararLlamadaConfirmacionPedido(
  datos: DatosPedidoParaLlamada,
  opts: { forzar?: boolean } = {}
): Promise<ResultadoDisparoLlamada> {
  const toNumber = normalizarTelefonoE164Peru(datos.telefono);
  if (!toNumber) {
    return {
      ok: false,
      omitido: true,
      motivo: `Teléfono "${datos.telefono ?? ""}" no es un celular peruano válido (+519XXXXXXXX)`,
    };
  }

  if (!opts.forzar && esNumeroEntrenador(toNumber)) {
    return {
      ok: false,
      omitido: true,
      motivo: "Número de supervisor en lista blanca; no se dispara llamada automática",
    };
  }

  const config = await obtenerConfigVozIA();
  const variables = construirVariablesLlamadaPedido(datos);

  if (!config.enabled || !config.apiKey || !config.agentId || !config.agentPhoneNumberId) {
    return {
      ok: false,
      omitido: true,
      motivo: "Credenciales de ElevenLabs + Twilio aún no configuradas (ELEVENLABS_API_KEY, ELEVENLABS_AGENT_ID, ELEVENLABS_PHONE_NUMBER_ID)",
      variables,
    };
  }

  const url =
    config.endpointKind === "sip_trunk"
      ? "https://api.elevenlabs.io/v1/convai/sip-trunk/outbound-call"
      : "https://api.elevenlabs.io/v1/convai/twilio/outbound-call";

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "xi-api-key": config.apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        agent_id: config.agentId,
        agent_phone_number_id: config.agentPhoneNumberId,
        to_number: toNumber,
        conversation_initiation_client_data: {
          dynamic_variables: variables,
        },
      }),
      signal: AbortSignal.timeout(12_000),
    });

    const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (!res.ok) {
      const errDetail =
        typeof body?.detail === "string"
          ? body.detail
          : body?.detail
          ? JSON.stringify(body.detail)
          : `HTTP ${res.status}`;
      await db.insert(activities).values({
        type: "call",
        description: `📞 [IA Voz] Falló el inicio de llamada automática para ${datos.numeroOrden} (${toNumber}): ${errDetail.slice(0, 300)}`,
        contactId: datos.contactId,
      });
      return { ok: false, motivo: errDetail, variables };
    }

    const conversationId = typeof body?.conversation_id === "string" ? body.conversation_id : undefined;
    const callSid = typeof body?.callSid === "string" ? body.callSid : typeof body?.sip_call_id === "string" ? body.sip_call_id : undefined;

    // Registrar en el pedido y en el historial de actividades que la llamada IA ya salió
    const [pedidoActual] = await db
      .select({ notas: pedidosOrdenes.notas })
      .from(pedidosOrdenes)
      .where(eq(pedidosOrdenes.id, datos.pedidoId))
      .limit(1);

    const marca = `${MARCA_LLAMADA_IA_INICIADA} ${new Date().toISOString()} conv=${conversationId ?? "n/a"} tel=${toNumber} modo=${variables.modalidad}`;
    await Promise.all([
      db
        .update(pedidosOrdenes)
        .set({
          notas: [pedidoActual?.notas, marca].filter(Boolean).join("\n"),
          updatedAt: new Date(),
        })
        .where(eq(pedidosOrdenes.id, datos.pedidoId)),
      db.insert(activities).values({
        type: "call",
        description: `📞 [IA Voz] Llamada automática iniciada a ${toNumber} para confirmar pedido ${datos.numeroOrden} (${variables.modalidad === "COD_DOMICILIO" ? "Contraentrega Domicilio" : "Agencia Shalom"})${conversationId ? ` · ID: ${conversationId}` : ""}`,
        contactId: datos.contactId,
      }),
      db
        .update(contacts)
        .set({ updatedAt: new Date() })
        .where(eq(contacts.id, datos.contactId)),
    ]);

    return {
      ok: true,
      callId: callSid,
      conversationId,
      variables,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[voice-ai] error disparando llamada saliente:", msg);
    return { ok: false, motivo: msg, variables };
  }
}
