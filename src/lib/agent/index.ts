import type OpenAI from "openai";
import { db } from "@/db";
import { activities, contacts, conversations, messages, notifications } from "@/db/schema";
import { desc, eq } from "drizzle-orm";
import { deliverMessage, getConversationRow } from "@/lib/channels/deliver";
import { isChannel, type Channel } from "@/lib/channels/types";
import { displayName, listMembers } from "@/lib/team";
import { getConfig } from "@/lib/config";
import { getAgentConfig } from "./config";
import { renderContexto, renderSystemPrompt } from "./prompt";
import { esSaludoAutomatico, renderOrigenAnuncio } from "./origen-anuncio";
import { executeTool, getEnabledToolDefinitions, type ToolContext } from "./tools";
import { getOpenRouterClient, getAgentModel, hasOpenRouterKey, createChatCompletionWithFallback } from "./openrouter";

const MAX_TOOL_ROUNDS = 6;
const HISTORY_LIMIT = 30;

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
export async function runAgentForConversation(conversationId: string): Promise<RunAgentResult> {
  const conversation = await getConversationRow(conversationId);
  if (!conversation) return { ok: false, reason: "conversation_not_found" };
  if (!conversation.contactId) return { ok: false, reason: "conversation_without_contact" };

  const [contact] = await db.select().from(contacts).where(eq(contacts.id, conversation.contactId)).limit(1);
  if (!contact) return { ok: false, reason: "contact_not_found" };

  // El contacto es el kill-switch global; la conversacion pausa solo este hilo.
  if (!contact.aiEnabled) return { ok: false, reason: "ai_disabled" };
  if (contact.needsHuman) return { ok: false, reason: "needs_human" };
  if (!conversation.aiEnabled) return { ok: false, reason: "ai_disabled_conversation" };
  if (conversation.needsHuman) return { ok: false, reason: "needs_human_conversation" };

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

        for (const tc of assistantMsg.tool_calls) {
          if (tc.type !== "function") continue;
          toolCalls++;

          let args: unknown = {};
          try {
            args = JSON.parse(tc.function.arguments);
          } catch {
            // si no parsea, la tool recibe {} y responde su propio error
          }

          const result = await executeTool(tc.function.name, args, ctx);
          if (result.ok && result.stop) detenido = true;

          llmMessages.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify(result) });
        }

        if (detenido) {
          const mensaje = getConfig().agente.mensajeDerivacion;
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

      const reply = assistantMsg.content?.trim() ?? "";
      if (!reply) return { ok: false, reason: "empty_reply", toolCalls };

      const entrega = await deliverMessage(conversation.id, { text: reply }, "agent");
      if (!entrega.ok) {
        return { ok: false, reason: `send_failed: ${entrega.error ?? "unknown"}`, toolCalls };
      }

      await db.update(contacts).set({ updatedAt: new Date() }).where(eq(contacts.id, contact.id));
      return { ok: true, reply, toolCalls };
    }

    return { ok: false, reason: "max_tool_rounds_exceeded", toolCalls };
  } catch (err: unknown) {
    const errorObj = err as { message?: string };
    const errMessage = errorObj?.message || String(err);
    console.error(`[agent] Error crítico en turno del bot para conversación ${conversation.id}:`, errMessage);

    // 1. Activar bandera needsHuman para que el chat NO quede abandonado en silencio
    await db
      .update(conversations)
      .set({
        needsHuman: true,
        needsHumanReason: `Error de IA (${errMessage.slice(0, 100)}). Requiere atención humana inmediata.`,
        needsHumanAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(conversations.id, conversation.id));

    // 2. Registrar nota de actividad visible en la ficha del contacto
    await db.insert(activities).values({
      type: "note",
      description: `[ALERTA BOT] El bot falló por saturación de IA (${errMessage.slice(0, 140)}). El chat quedó marcado con atención humana para que un asesor responda.`,
      contactId: contact.id,
    });

    // 3. Crear notificación interna para la campanita del equipo
    try {
      const miembros = await listMembers({ onlyActive: true });
      const primerAdmin = miembros.find((m) => m.role === "admin") || miembros[0];
      if (primerAdmin) {
        await db.insert(notifications).values({
          memberId: primerAdmin.id,
          kind: "system",
          title: `Alerta: Chat sin respuesta (${contact.name})`,
          body: `El bot no pudo responder a ${contact.name} (${contact.phone || "sin teléfono"}) por error de IA. Requiere respuesta manual.`,
          url: `/conversations/${conversation.id}`,
          contactId: contact.id,
        });
      }
    } catch (notifErr) {
      console.warn("[agent] No se pudo crear notificación interna:", notifErr);
    }

    return { ok: false, reason: `llm_failure: ${errMessage}`, toolCalls };
  }
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
