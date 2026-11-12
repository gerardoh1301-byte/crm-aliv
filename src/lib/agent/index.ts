import type OpenAI from "openai";
import { db } from "@/db";
import { activities, contacts, conversations, messages } from "@/db/schema";
import { desc, eq } from "drizzle-orm";
import { deliverMessage, getConversationRow } from "@/lib/channels/deliver";
import { isChannel, type Channel } from "@/lib/channels/types";
import { displayName, listMembers } from "@/lib/team";
import { alertarEquipo } from "./alertas";
import { limpiarFormatoWhatsApp } from "./formato";
import { getConfig } from "@/lib/config";
import { getAgentConfig } from "./config";
import { renderContexto, renderSystemPrompt } from "./prompt";
import { esSaludoAutomatico, renderOrigenAnuncio } from "./origen-anuncio";
import { executeTool, getEnabledToolDefinitions, type ToolContext } from "./tools";
import { getOpenRouterClient, getAgentModel, hasOpenRouterKey, createChatCompletionWithFallback } from "./openrouter";
import { autoDetectarYAgendarHorario } from "./scheduler";

const MAX_TOOL_ROUNDS = 6;
const HISTORY_LIMIT = 30;
const REINTENTO_MS = 20_000;
const MENSAJE_CORTESIA = "Disculpa la demora 🙏 En unos minutos te respondo por aquí.";

export interface RunAgentResult {
  ok: boolean;
  reason?: string;
  reply?: string;
  toolCalls?: number;
}

/**
 * Ejecuta el agente para UNA conversacion:
 * 1. Carga el historial de ese hilo (no del contacto: WhatsApp e Instagram no se mezclan)
 * 2. Resuelve prompt, tools y modelo del canal; agrega CONTEXTO (cliente, pipeline,
 *    datos a averiguar) y EQUIPO (si puede asignar)
 * 3. Loop de tool_calls hasta finish_reason=stop (o hasta una tool con `stop`)
 * 4. Responde por `deliverMessage`, el unico camino de salida: el conector de la
 *    conversacion decide si eso es Zernio, Meta o el simulador.
 */
export async function runAgentForConversation(
  conversationId: string,
  opts: { reintento?: boolean } = {}
): Promise<RunAgentResult> {
  const conversation = await getConversationRow(conversationId);
  if (!conversation) return { ok: false, reason: "conversation_not_found" };
  if (!conversation.contactId) return { ok: false, reason: "conversation_without_contact" };

  const [contact] = await db.select().from(contacts).where(eq(contacts.id, conversation.contactId)).limit(1);
  if (!contact) return { ok: false, reason: "contact_not_found" };

  // El contacto es el kill-switch global; la conversacion pausa solo este hilo.
  // "Avisar sin apagar": needsHuman sirve como insignia y filtro de bandeja para asesores,
  // pero NO silencia al bot. Solo aiEnabled = false detiene la atención automática.
  if (!contact.aiEnabled) return { ok: false, reason: "ai_disabled" };
  if (!conversation.aiEnabled) return { ok: false, reason: "ai_disabled_conversation" };

  const channel: Channel = isChannel(conversation.channel) ? conversation.channel : "whatsapp";

  const config = await getAgentConfig(channel);
  if (!config.enabled) return { ok: false, reason: `agent_disabled_for_${channel}` };

  const collapsed = await loadHistory(conversationId);
  if (collapsed === "empty") return { ok: false, reason: "no_history" };
  if (collapsed === "no_user") return { ok: false, reason: "no_user_messages" };
  if (collapsed === "already_replied") return { ok: false, reason: "last_message_is_assistant" };

  const tools = await getEnabledToolDefinitions(config.enabledTools);
  const puedeAsignar = tools.some((t) => t.type === "function" && t.function.name === "asignar_asesor");

  const [contexto, equipo] = await Promise.all([
    renderContexto(contact.id),
    puedeAsignar ? renderTeamBlock(contact.ownerId) : Promise.resolve(""),
  ]);

  const llmMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    {
      role: "system",
      content:
        renderSystemPrompt(config.systemPrompt, { channel: conversation.provider === "simulador" ? "simulador" : channel }) +
        contexto +
        renderOrigenAnuncio(conversation.metadata, collapsed.some((m) => m.role === "assistant")) +
        equipo,
    },
    ...collapsed,
  ];
  const ctx: ToolContext = {
    contactId: contact.id,
    contactPhone: contact.phone,
    conversationId: conversation.id,
    channel,
  };

  let toolCalls = 0;
  const executedTools: string[] = [];
  let pedidoTextoExplicito = false;

  try {
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const completion = await createChatCompletionWithFallback({
        model: config.model,
        messages: llmMessages,
        tools: tools.length > 0 ? tools : undefined,
        tool_choice: tools.length > 0 ? "auto" : undefined,
        max_completion_tokens: 1024,
      });

      const choice = completion.choices[0];
      const assistantMsg = choice.message;

      if (choice.finish_reason === "tool_calls" && assistantMsg.tool_calls?.length) {
        llmMessages.push(assistantMsg);
        let detenido = false;
        let mensajeFinal: string | undefined;

        for (const tc of assistantMsg.tool_calls) {
          if (tc.type !== "function") continue;
          toolCalls++;
          executedTools.push(tc.function.name);

          let args: unknown = {};
          try {
            args = JSON.parse(tc.function.arguments);
          } catch {
            // si no parsea, la tool recibe {} y responde su propio error
          }

          const result = await executeTool(tc.function.name, args, ctx);
          if (result.ok && result.stop) {
            detenido = true;
            mensajeFinal ??= result.mensajeFinal;
          }

          llmMessages.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify(result) });
        }

        if (detenido) {
          const mensaje = mensajeFinal ?? getConfig().agente.mensajeDerivacion;
          const entrega = await deliverMessage(conversation.id, { text: mensaje }, "agent");
          return {
            ok: entrega.ok,
            reply: mensaje,
            reason: entrega.ok ? "handoff" : `send_failed: ${entrega.error ?? "unknown"}`,
            toolCalls,
          };
        }
        continue;
      }

      const reply = limpiarFormatoWhatsApp(assistantMsg.content?.trim() ?? "");
      if (!reply) {
        // A1: a veces el modelo cierra el turno sin texto. Se le pide una vez que responda
        // (las herramientas ya ejecutadas quedan en el historial, no se repiten).
        if (!pedidoTextoExplicito) {
          pedidoTextoExplicito = true;
          llmMessages.push({ role: "system", content: PEDIDO_RESPUESTA_TEXTO });
          continue;
        }
        return avisarSinRespuesta(conversation.id, contact, "Respuesta vacía del modelo", "empty_reply", toolCalls);
      }

      const entrega = await deliverMessage(conversation.id, { text: reply }, "agent");
      if (!entrega.ok) {
        return { ok: false, reason: `send_failed: ${entrega.error ?? "unknown"}`, toolCalls };
      }

      await db.update(contacts).set({ updatedAt: new Date() }).where(eq(contacts.id, contact.id));

      // Auto-detección defensiva: si el cliente o el bot acordaron fecha/horario y el LLM no llamó la tool, agendar en Calendario
      if (!executedTools.includes("agendar_entrega")) {
        const lastUser = Array.isArray(collapsed) ? collapsed[collapsed.length - 1]?.content : "";
        autoDetectarYAgendarHorario({
          contactId: contact.id,
          mensajeUsuario: lastUser,
          respuestaBot: reply,
          conversationId: conversation.id,
        }).catch((err) => console.warn("[scheduler] Error en auto-detección:", err));
      }

      return { ok: true, reply, toolCalls };
    }

    // A1: se agotaron las rondas de herramientas. Ultimo intento sin herramientas para que
    // el cliente reciba texto; si tampoco, cortesia y aviso al equipo.
    llmMessages.push({ role: "system", content: PEDIDO_RESPUESTA_TEXTO });
    const final = await createChatCompletionWithFallback({
      model: config.model,
      messages: llmMessages,
      max_completion_tokens: 1024,
    });
    const textoFinal = limpiarFormatoWhatsApp(final.choices[0]?.message?.content?.trim() ?? "");
    if (textoFinal) {
      const entrega = await deliverMessage(conversation.id, { text: textoFinal }, "agent");
      if (entrega.ok) {
        await db.update(contacts).set({ updatedAt: new Date() }).where(eq(contacts.id, contact.id));

        if (!executedTools.includes("agendar_entrega")) {
          const lastUser = Array.isArray(collapsed) ? collapsed[collapsed.length - 1]?.content : "";
          autoDetectarYAgendarHorario({
            contactId: contact.id,
            mensajeUsuario: lastUser,
            respuestaBot: textoFinal,
            conversationId: conversation.id,
          }).catch((err) => console.warn("[scheduler] Error en auto-detección:", err));
        }

        return { ok: true, reply: textoFinal, toolCalls };
      }
    }
    return avisarSinRespuesta(conversation.id, contact, "El bot no llegó a una respuesta (demasiadas acciones seguidas)", "max_tool_rounds_exceeded", toolCalls);
  } catch (err: unknown) {
    const errorObj = err as { status?: number; code?: string | number; message?: string };
    const status = errorObj?.status;
    const rawMsg = errorObj?.message || String(err);
    console.error(`[agent] Error en turno del bot para conversación ${conversation.id}:`, rawMsg);

    // Clasificar el error real para no confundir con "saturación" (N3)
    let categoriaError = "Error inesperado de IA";
    if (/timeout|timed out/i.test(rawMsg)) {
      categoriaError = "Límite de tiempo agotado (Timeout de IA)";
    } else if (status === 429) {
      categoriaError = "Límite de cuota de IA alcanzado (429 Rate Limit)";
    } else if (status === 404) {
      categoriaError = "Modelo de IA no encontrado (404 Not Found)";
    } else if (status === 503 || status === 500) {
      categoriaError = `Servidor de IA no disponible (${status} Service Unavailable)`;
    } else if (status === 401) {
      categoriaError = "Error de autenticación de IA (401 Unauthorized)";
    }

    // R9a: reintento unico. Solo si el turno no ejecuto ninguna herramienta todavia
    // (repetirlo no puede duplicar pedidos ni operaciones) y el error es transitorio.
    const transitorio = status === undefined || status === 429 || status === 500 || status === 503 || /timeout|timed out/i.test(rawMsg);
    if (opts.reintento !== false && toolCalls === 0 && transitorio) {
      console.warn(`[agent] Reintentando turno de ${conversation.id} en ${REINTENTO_MS / 1000}s tras: ${categoriaError}`);
      await new Promise((r) => setTimeout(r, REINTENTO_MS));
      // Si el segundo intento tambien falla, el mismo envia el mensaje de cortesia y avisa.
      return runAgentForConversation(conversationId, { reintento: false });
    }

    // R9b: si tampoco hubo suerte, cortesia + nota + aviso.
    await avisarSinRespuesta(conversation.id, contact, categoriaError, `llm_failure: ${rawMsg}`, toolCalls, rawMsg);
    return { ok: false, reason: `llm_failure: ${rawMsg}`, toolCalls };
  }
}

const PEDIDO_RESPUESTA_TEXTO =
  "Tu turno anterior terminó sin texto. Escribe ahora tu respuesta al último mensaje del cliente, en texto, siguiendo tus reglas.";


/**
 * El cliente no puede quedar en silencio: mensaje fijo de cortesia (sin repetirlo),
 * nota en la ficha, insignia "requiere humano" y push al equipo.
 */
async function avisarSinRespuesta(
  conversationId: string,
  contact: { id: string; name: string; phone: string | null },
  categoria: string,
  reason: string,
  toolCalls: number,
  detalle?: string
): Promise<RunAgentResult> {
  try {
    const [ultimo] = await db
      .select({ body: messages.body, direction: messages.direction })
      .from(messages)
      .where(eq(messages.conversationId, conversationId))
      .orderBy(desc(messages.createdAt))
      .limit(1);
    if (!(ultimo?.direction === "out" && ultimo.body === MENSAJE_CORTESIA)) {
      await deliverMessage(conversationId, { text: MENSAJE_CORTESIA }, "agent");
    }
  } catch (deliverErr) {
    console.warn("[agent] No se pudo enviar mensaje de cortesia:", deliverErr);
  }

  try {
    await db.insert(activities).values({
      type: "note",
      description: `[ALERTA BOT] El bot no pudo responder: ${categoria}.${detalle ? ` Detalle: ${detalle.slice(0, 120)}.` : ""} Se envió mensaje de cortesía y se avisó al equipo.`,
      contactId: contact.id,
    });
    await db
      .update(conversations)
      .set({
        needsHuman: true,
        needsHumanReason: `El bot no pudo responder: ${categoria}`,
        needsHumanAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(conversations.id, conversationId));
  } catch (dbErr) {
    console.warn("[agent] No se pudo registrar la alerta:", dbErr);
  }

  await alertarEquipo({
    contactId: contact.id,
    conversationId,
    titulo: `Chat sin respuesta: ${contact.name}`,
    cuerpo: `El bot no pudo responder a ${contact.name} (${contact.phone || "sin teléfono"}): ${categoria}. Responde a mano.`,
  });

  return { ok: false, reason, toolCalls };
}

/**
 * Compatibilidad: resuelve la conversacion mas reciente del contacto y delega. Lo usan
 * los jobs viejos que solo traen contacto.
 */
export async function runAgentForContact(contactId: string): Promise<RunAgentResult> {
  const [conv] = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(eq(conversations.contactId, contactId))
    .orderBy(desc(conversations.lastMessageAt))
    .limit(1);
  if (!conv) return { ok: false, reason: "no_conversation" };
  return runAgentForConversation(conv.id);
}

type CollapsedHistory = Array<{ role: "user" | "assistant"; content: string }> | "empty" | "no_user" | "already_replied";

/** Seccion EQUIPO: a quien puede asignar y quien tiene hoy el contacto. */
async function renderTeamBlock(currentOwnerId: string | null): Promise<string> {
  const members = await listMembers({ onlyActive: true });
  if (members.length === 0) return "";
  const etiqueta = getConfig().roles.etiquetaAsesor;
  const lines = members.map((m) => `- ${displayName(m)}${m.role === "admin" ? " (admin)" : ""}`);
  const actual = currentOwnerId ? members.find((m) => m.id === currentOwnerId) : null;
  return (
    `\n\n# EQUIPO\n${etiqueta}es a los que podes asignar este contacto con asignar_asesor:\n` +
    lines.join("\n") +
    (actual ? `\nEste contacto ya esta asignado a ${displayName(actual)}.` : "\nEste contacto todavia no tiene asignacion.")
  );
}

async function loadHistory(conversationId: string): Promise<CollapsedHistory> {
  const rows = await db
    .select({ direction: messages.direction, origin: messages.origin, body: messages.body })
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(desc(messages.createdAt))
    .limit(HISTORY_LIMIT);

  if (rows.length === 0) return "empty";

  const collapsed: Array<{ role: "user" | "assistant"; content: string }> = [];
  for (const m of rows.reverse()) {
    // El saludo automatico de WhatsApp Business no cuenta como respuesta: si lo
    // dejaramos, el primer "Quiero mas informacion" del anuncio quedaria sin contestar.
    if (esSaludoAutomatico(m.direction, m.origin, m.body)) continue;
    const role: "user" | "assistant" = m.direction === "in" ? "user" : "assistant";
    const text = m.body?.trim();
    if (!text) continue;
    const last = collapsed[collapsed.length - 1];
    if (last && last.role === role) last.content = `${last.content}\n${text}`;
    else collapsed.push({ role, content: text });
  }

  while (collapsed.length > 0 && collapsed[0].role === "assistant") collapsed.shift();
  if (collapsed.length === 0) return "no_user";
  if (collapsed[collapsed.length - 1].role !== "user") return "already_replied";
  return collapsed;
}

export const agentConfig = {
  hasApiKey: hasOpenRouterKey(),
  model: getAgentModel(),
  maxToolRounds: MAX_TOOL_ROUNDS,
  historyLimit: HISTORY_LIMIT,
};
