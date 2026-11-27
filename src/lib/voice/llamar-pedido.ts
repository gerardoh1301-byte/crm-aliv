import "server-only";
import { db } from "@/db";
import { activities, contacts, crmSettings } from "@/db/schema";
import { eq } from "drizzle-orm";
import { pedidosOrdenes } from "../../../modules/pedidos/tabla";
import { esNumeroEntrenador } from "@/lib/alerts/supervisor-alerts";
import { contactoBloqueado } from "@/lib/contactos/bloqueo";
import {
  construirVariablesLlamadaPedido,
  dentroHorarioLlamadaIA,
  MARCA_LLAMADA_IA_INICIADA,
  MARCA_LLAMADA_IA_PENDIENTE_HORARIO,
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
  /** Si están presentes, saca la llamada por Twilio API con Verified Caller ID peruano (+51...) */
  twilioAccountSid: string | null;
  twilioAuthToken: string | null;
  twilioCallerId: string | null;
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

  const twilioAccountSid = process.env.TWILIO_ACCOUNT_SID?.trim() || (await leerSetting("voice.twilio_account_sid"));
  const twilioAuthToken = process.env.TWILIO_AUTH_TOKEN?.trim() || (await leerSetting("voice.twilio_auth_token"));
  const twilioCallerId = process.env.TWILIO_CALLER_ID?.trim() || (await leerSetting("voice.twilio_caller_id"));

  const enabled = rawEnabled
    ? rawEnabled.toLowerCase() !== "false" && rawEnabled.toLowerCase() !== "off"
    : Boolean(apiKey && agentId && (agentPhoneNumberId || (twilioAccountSid && twilioAuthToken && twilioCallerId)));

  return {
    enabled,
    apiKey: apiKey || null,
    agentId: agentId || null,
    agentPhoneNumberId: agentPhoneNumberId || null,
    endpointKind: kindRaw === "sip_trunk" ? "sip_trunk" : "twilio",
    twilioAccountSid: twilioAccountSid || null,
    twilioAuthToken: twilioAuthToken || null,
    twilioCallerId: twilioCallerId || null,
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

  // Bloqueado por spam: nunca se le llama, ni siquiera forzando desde el CRM.
  const [ctBloqueo] = await db
    .select({ tags: contacts.tags })
    .from(contacts)
    .where(eq(contacts.id, datos.contactId))
    .limit(1);
  if (contactoBloqueado(ctBloqueo?.tags)) {
    return { ok: false, omitido: true, motivo: "Contacto bloqueado por spam (etiqueta bloqueado_spam)" };
  }

  if (!opts.forzar && esNumeroEntrenador(toNumber)) {
    return {
      ok: false,
      omitido: true,
      motivo: "Número de supervisor en lista blanca; no se dispara llamada automática",
    };
  }

  // Horario comercial de llamadas automáticas: 7:00 a. m. a 10:00 p. m. (hora Perú).
  // Si el pedido entra fuera de ese rango (ej. madrugada), se marca para atenderlo a las 7:00 a. m.
  if (!opts.forzar && !dentroHorarioLlamadaIA()) {
    const [pedidoActual] = await db
      .select({ notas: pedidosOrdenes.notas })
      .from(pedidosOrdenes)
      .where(eq(pedidosOrdenes.id, datos.pedidoId))
      .limit(1);
    const notasActuales = pedidoActual?.notas ?? "";
    if (!notasActuales.includes(MARCA_LLAMADA_IA_PENDIENTE_HORARIO)) {
      const marcaPendiente = `${MARCA_LLAMADA_IA_PENDIENTE_HORARIO} ${new Date().toISOString()} En cola para llamar a primera hora (07:00 Lima)`;
      await Promise.all([
        db
          .update(pedidosOrdenes)
          .set({
            notas: [notasActuales, marcaPendiente].filter(Boolean).join("\n"),
            updatedAt: new Date(),
          })
          .where(eq(pedidosOrdenes.id, datos.pedidoId)),
        db.insert(activities).values({
          type: "note",
          description: `⏰ [IA Voz] Pedido ${datos.numeroOrden} ingresó fuera de horario comercial (7am-10pm). Programado automáticamente para llamada de Sofía a las 7:00 a. m.`,
          contactId: datos.contactId,
        }),
      ]);
    }
    return {
      ok: false,
      omitido: true,
      motivo: "Fuera de horario comercial (7:00 a. m. - 10:00 p. m. Lima); encolado para primera hora",
    };
  }

  const config = await obtenerConfigVozIA();
  const variables = construirVariablesLlamadaPedido(datos);

  if (!config.enabled || !config.apiKey || !config.agentId) {
    return {
      ok: false,
      omitido: true,
      motivo: "Credenciales de ElevenLabs + Twilio aún no configuradas (ELEVENLABS_API_KEY, ELEVENLABS_AGENT_ID)",
      variables,
    };
  }

  const usarCallerIdPeruano = Boolean(
    config.twilioAccountSid && config.twilioAuthToken && config.twilioCallerId
  );

  try {
    let conversationId: string | undefined;
    let callSid: string | undefined;

    if (usarCallerIdPeruano) {
      // MODO 1 (Preferido para Perú): Registrar la sesión en ElevenLabs para obtener el TwiML
      // y lanzar la llamada directo por Twilio API mostrando el Verified Caller ID peruano (+51 944 392 731).
      const regRes = await fetch("https://api.elevenlabs.io/v1/convai/twilio/register-call", {
        method: "POST",
        headers: {
          "xi-api-key": config.apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          agent_id: config.agentId,
          from_number: config.twilioCallerId,
          to_number: toNumber,
          direction: "outbound",
          conversation_initiation_client_data: {
            dynamic_variables: variables,
          },
        }),
        signal: AbortSignal.timeout(12_000),
      });

      const twiml = await regRes.text();
      if (!regRes.ok || !twiml.includes("<Response")) {
        throw new Error(`ElevenLabs register-call falló (HTTP ${regRes.status}): ${twiml.slice(0, 250)}`);
      }

      const authHeader = Buffer.from(`${config.twilioAccountSid}:${config.twilioAuthToken}`).toString("base64");
      const form = new URLSearchParams();
      form.set("To", toNumber);
      form.set("From", config.twilioCallerId!);
      form.set("Twiml", twiml);

      const twilioRes = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${config.twilioAccountSid}/Calls.json`,
        {
          method: "POST",
          headers: {
            Authorization: `Basic ${authHeader}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: form.toString(),
          signal: AbortSignal.timeout(12_000),
        }
      );

      const twilioBody = (await twilioRes.json().catch(() => null)) as Record<string, unknown> | null;
      if (!twilioRes.ok) {
        const errDetail =
          typeof twilioBody?.message === "string" ? twilioBody.message : `Twilio HTTP ${twilioRes.status}`;
        await db.insert(activities).values({
          type: "call",
          description: `📞 [IA Voz] Falló Twilio con Caller ID ${config.twilioCallerId} para ${datos.numeroOrden} (${toNumber}): ${errDetail.slice(0, 300)}`,
          contactId: datos.contactId,
        });
        return { ok: false, motivo: errDetail, variables };
      }

      callSid = typeof twilioBody?.sid === "string" ? twilioBody.sid : undefined;
      const mConv = twiml.match(/conversation_id["']\s+value=["']([^"']+)["']/i);
      conversationId = mConv?.[1];
    } else {
      // MODO 2 (Respaldo): Llamada directa por número importado en ElevenLabs
      if (!config.agentPhoneNumberId) {
        return { ok: false, omitido: true, motivo: "Falta ELEVENLABS_PHONE_NUMBER_ID", variables };
      }
      const url =
        config.endpointKind === "sip_trunk"
          ? "https://api.elevenlabs.io/v1/convai/sip-trunk/outbound-call"
          : "https://api.elevenlabs.io/v1/convai/twilio/outbound-call";

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

      conversationId = typeof body?.conversation_id === "string" ? body.conversation_id : undefined;
      callSid =
        typeof body?.callSid === "string"
          ? body.callSid
          : typeof body?.sip_call_id === "string"
          ? body.sip_call_id
          : undefined;
    }

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
