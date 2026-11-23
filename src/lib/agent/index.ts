import type OpenAI from "openai";
import { db } from "@/db";
import { activities, agentJobs, contacts, conversations, messages } from "@/db/schema";
import { and, desc, eq, gte, inArray, or, sql } from "drizzle-orm";
import { decidirReintento, esMensajeCortesia, MENSAJE_CORTESIA, VENTANA_FALLAS_MS } from "./reintento";
import { enqueueAgentJob } from "./queue";
import { corregirImagenSaliente } from "./etiqueta-imagen";
import { pausaPorHumano } from "./toques";
import { ultimoMensajeHumanoDesdeTelefono } from "./toques-servidor";
import { deliverMessage, getConversationRow } from "@/lib/channels/deliver";
import { isChannel, type Channel } from "@/lib/channels/types";
import { displayName, listMembers } from "@/lib/team";
import { alertarEquipo } from "./alertas";
import { esNumeroEntrenador, notificarSupervisoresCritico } from "@/lib/alerts/supervisor-alerts";
import { limpiarFormatoWhatsApp, removerMencionClaveSiYaEntregada, removerSaludoRepetido } from "./formato";
import { getConfig } from "@/lib/config";
import { getAgentConfig } from "./config";
import { renderContextoDetallado, renderSystemPrompt } from "./prompt";
import { exigirDatosEnvio, type RequisitosShalom } from "./datos-envio";
import { esSaludoAutomatico, productoDelAnuncio, renderOrigenAnuncio } from "./origen-anuncio";
import { asegurarPreguntaDeAvance, renderGuionVenta } from "./guion-venta";
import { detectarSenalesPrompt } from "./prompt-bloques";
import { MARCA_COD_PROVINCIA } from "@/lib/aliclik/cobertura-cod";
import { corregirFrasesSalud } from "./filtro-salud";
import { registrarPromesaSiAplica } from "./seguimiento";
import { executeTool, getEnabledToolDefinitions, type ToolContext } from "./tools";
import { getOpenRouterClient, getAgentModel, hasOpenRouterKey, createChatCompletionWithFallback } from "./openrouter";
import { autoDetectarYAgendarHorario } from "./scheduler";
import { pedidosOrdenes } from "../../../modules/pedidos/tabla";
import { construirOrdenVerificada, validarRespuestaBotContraOrden } from "./guardrail-orden";

const MAX_TOOL_ROUNDS = 6;
/** Herramientas que solo registran en el CRM: su resultado no cambia lo que se le dice al cliente. */
const HERRAMIENTAS_SOLO_REGISTRO = new Set([
  "asignar_etiqueta",
  "actualizar_contacto",
  "mover_etapa",
  "registrar_actividad",
  "resumen_lead",
  "avisar_asesor",
]);
const HISTORY_LIMIT = 14;
const REINTENTO_MS = 20_000;
const LIMITE_TOTAL_RESPUESTA_MS = 45_000; // A8: límite total de 45s por respuesta

export interface RunAgentResult {
  ok: boolean;
  reason?: string;
  reply?: string;
  toolCalls?: number;
  copilot?: boolean;
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
// Candado de memoria para evitar carreras y dobles respuestas en la misma conversación
const activeConversationLocks = new Set<string>();

export async function runAgentForConversation(
  conversationId: string,
  opts: { reintento?: boolean } = {}
): Promise<RunAgentResult> {
  if (activeConversationLocks.has(conversationId)) {
    console.log(`[agent] Conversación ${conversationId} ya tiene un turno en ejecución en memoria. Omitiendo ejecución concurrente.`);
    return { ok: false, reason: "conversation_already_running" };
  }
  activeConversationLocks.add(conversationId);

  try {
    return await executeAgentTurn(conversationId, opts);
  } finally {
    activeConversationLocks.delete(conversationId);
  }
}

async function executeAgentTurn(
  conversationId: string,
  opts: { reintento?: boolean } = {}
): Promise<RunAgentResult> {
  const conversation = await getConversationRow(conversationId);
  if (!conversation) return { ok: false, reason: "conversation_not_found" };
  if (!conversation.contactId) return { ok: false, reason: "conversation_without_contact" };

  const [contact] = await db.select().from(contacts).where(eq(contacts.id, conversation.contactId)).limit(1);
  if (!contact) return { ok: false, reason: "contact_not_found" };

  // Ordenes por WhatsApp del supervisor de pagos (pagos, flete, clave...). Va antes de
  // los interruptores del bot: funcionan aunque el bot este apagado en ese chat. Si el
  // mensaje no es una orden, sigue al bot como chat de prueba.
  if (conversation.channel === "whatsapp") {
    // «ok» / «👍» de un supervisor solo renueva su ventana de 24 h: se confirma sin IA.
    if (esNumeroEntrenador(contact.phone)) {
      const { manejarRenovacionVentana } = await import("@/lib/alerts/ventana-supervisor-servidor");
      if (await manejarRenovacionVentana(conversation.id)) return { ok: true, reason: "renovacion_ventana" };
    }
    const { esSupervisorPagos, manejarComandoSupervisor } = await import("@/lib/supervisor/comandos");
    if (esSupervisorPagos(contact.phone) && (await manejarComandoSupervisor(conversation.id, contact.phone))) {
      return { ok: true, reason: "comando_supervisor" };
    }
  }

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

  // E6: si una persona del equipo está escribiendo desde el teléfono, el bot no contesta
  // encima. Deja un reintento para cuando termine la pausa: si para entonces nadie le
  // respondió al cliente, contesta el bot (si alguien respondió, el historial lo frena).
  if (!esNumeroEntrenador(contact.phone)) {
    const pausa = pausaPorHumano(await ultimoMensajeHumanoDesdeTelefono(conversation.id), new Date());
    if (pausa.pausado) {
      const [ultimoCliente] = await db
        .select({ id: messages.id })
        .from(messages)
        .where(and(eq(messages.conversationId, conversation.id), eq(messages.direction, "in")))
        .orderBy(desc(messages.createdAt))
        .limit(1);
      if (ultimoCliente) await enqueueAgentJob(contact.id, ultimoCliente.id, conversation.id, pausa.reanudarEnMs);
      return { ok: true, reason: "humano_atendiendo" };
    }
  }

  const tools = await getEnabledToolDefinitions(config.enabledTools);
  const puedeAsignar = tools.some((t) => t.type === "function" && t.function.name === "asignar_asesor");

  const [contextoDetallado, equipo, pedidoRecienteRows] = await Promise.all([
    renderContextoDetallado(contact.id),
    puedeAsignar ? renderTeamBlock(contact.ownerId) : Promise.resolve(""),
    db
      .select({
        numeroOrden: pedidosOrdenes.numeroOrden,
        total: pedidosOrdenes.total,
        items: pedidosOrdenes.items,
        claveRecojo: pedidosOrdenes.claveRecojo,
        notas: pedidosOrdenes.notas,
        createdAt: pedidosOrdenes.createdAt,
      })
      .from(pedidosOrdenes)
      .where(eq(pedidosOrdenes.contactId, contact.id))
      .orderBy(desc(pedidosOrdenes.createdAt))
      .limit(1),
  ]);
  const contexto = contextoDetallado.texto;
  const requisitosShalom = contextoDetallado.requisitosShalom;
  // Si en este turno el bot guardó datos o registró el pedido, se vuelve a evaluar qué falta
  // (si no, le pediría el DNI que el cliente acaba de dar).
  const executedToolsRef: string[] = [];
  const requisitosVigentes = async (): Promise<RequisitosShalom> => {
    if (!requisitosShalom.aplica) {
      if (!executedToolsRef.includes("crear_pedido_chat")) return requisitosShalom;
    } else if (!executedToolsRef.some((t) => t === "actualizar_contacto" || t === "crear_pedido_chat")) {
      return requisitosShalom;
    }
    try {
      return (await renderContextoDetallado(contact.id)).requisitosShalom;
    } catch {
      return requisitosShalom;
    }
  };
  const ordenActiva = construirOrdenVerificada(pedidoRecienteRows[0]);
  const deadlineMs = Date.now() + LIMITE_TOTAL_RESPUESTA_MS;

  const rawFields = (contact.customFields as Record<string, unknown> | null) ?? {};
  const chatTieneClavePrevia = Array.isArray(collapsed) && collapsed.some((m) =>
    m.role === "assistant" &&
    (/(?:clave(?:\s+secreta)?(?:\s+de\s+recojo|\s+de\s+retiro)?\s*(?:es|:)\s*\d+)|(?:c[oó]digo\s+de\s+recojo\s*(?:es|:)\s*\d+)|(?:clave\s*:\s*\*\d+\*)|(?:clave\s+de\s+recojo\s+en\s+agencia\s+shalom)/i.test(m.content) ||
      /pago\s+del\s+saldo\s+de\s+S\/.*confirmado/i.test(m.content))
  );
  const claveYaEntregada = Boolean(
    ordenActiva?.claveRecojo ||
    rawFields.clave_recojo ||
    rawFields.clave_retiro ||
    rawFields.codigo_secreto ||
    chatTieneClavePrevia
  );

  // Si ya hubo mensajes salientes (del bot o de un asesor) en la conversación, está prohibido volver a saludar
  const [mensajePrevioSaliente] = await db
    .select({ id: messages.id })
    .from(messages)
    .where(and(eq(messages.conversationId, conversation.id), eq(messages.direction, "out")))
    .limit(1);
  const yaRespondio = Boolean(mensajePrevioSaliente) || collapsed.some((m) => m.role === "assistant");

  // Guion por etapa + ejemplos del banco + prueba A/B del primer mensaje (va al final del prompt).
  const pedidoReciente = pedidoRecienteRows[0];
  const tienePedidoReciente = Boolean(
    pedidoReciente?.createdAt && Date.now() - new Date(pedidoReciente.createdAt).getTime() < 30 * 86_400_000
  );
  const guion = renderGuionVenta({
    conversationId: conversation.id,
    historial: collapsed,
    tienePedido: tienePedidoReciente,
    productoAnuncio: productoDelAnuncio(conversation.metadata),
    contraEntregaProvincia: contexto.includes(MARCA_COD_PROVINCIA),
  });

  // Seguimiento con hora: si el cliente promete volver ("en 20 min te paso los datos"),
  // queda un recordatorio que el barrido envía una sola vez si no vuelve.
  if (!tienePedidoReciente) {
    const ultimoUsuario = [...collapsed].reverse().find((m) => m.role === "user");
    const textoUltimo = typeof ultimoUsuario?.content === "string" ? ultimoUsuario.content : "";
    if (!esNumeroEntrenador(contact.phone)) await registrarPromesaSiAplica(contact.id, conversation.id, textoUltimo).catch((err) =>
      console.warn("[agent] no se pudo registrar el seguimiento:", err instanceof Error ? err.message : err)
    );
  }

  // Ahorro de tokens: solo las secciones del prompt que este chat necesita (prompt-bloques.ts).
  // PROMPT_COMPLETO=on en Render vuelve a enviar el prompt entero (marcha atrás sin desplegar).
  const senalesPrompt = process.env.PROMPT_COMPLETO === "on" ? undefined : detectarSenalesPrompt({
    historial: collapsed,
    camposContacto: rawFields,
    etiquetas: contact.tags,
    productoAnuncio: productoDelAnuncio(conversation.metadata),
    tienePedidoReciente,
    textoPedido: pedidoReciente ? `${pedidoReciente.notas ?? ""} ${JSON.stringify(pedidoReciente.items ?? "")}` : null,
    etapa: guion.etapa,
  });

  const llmMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    {
      role: "system",
      content:
        renderSystemPrompt(config.systemPrompt, { channel: conversation.provider === "simulador" ? "simulador" : channel, senales: senalesPrompt }) +
        contexto +
        renderOrigenAnuncio(conversation.metadata, yaRespondio, guion.variante === "B") +
        (yaRespondio
          ? "\n\n# ESTADO DEL CHAT: CONVERSACIÓN EN CURSO (PROHIBIDO SALUDAR DE NUEVO Y PROHIBIDO REPETIR TABLA DE PRECIOS)\nYa has saludado al cliente en mensajes anteriores de este chat. ESTÁ ESTRICTAMENTE PROHIBIDO volver a decir '¡Hola', 'Hola [nombre]' o saludar de nuevo. Si ya enviaste los precios en un turno anterior, NO vuelvas a pegar la lista de precios (• 1 frasco... • 2 frascos...). Responde DIRECTAMENTE a lo que dijo o preguntó el cliente en 2 a 3 líneas cortas y naturales, como un vendedor humano por WhatsApp."
          : "") +
        equipo +
        guion.bloque,
    },
    ...collapsed,
  ];
  const ctx: ToolContext = {
    contactId: contact.id,
    contactPhone: contact.phone,
    conversationId: conversation.id,
    channel,
  };

  const origenUso = conversation.provider === "simulador" ? "agente_simulador" : "agente";
  let toolCalls = 0;
  const executedTools: string[] = [];
  let pedidoTextoExplicito = false;

  try {
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const remainingBudget = deadlineMs - Date.now();
      if (remainingBudget <= 1500) {
        throw new Error("Timeout de IA: se alcanzó el límite total de 45s para la respuesta");
      }
      const completion = await createChatCompletionWithFallback(
        {
          model: config.model,
          messages: llmMessages,
          tools: tools.length > 0 ? tools : undefined,
          tool_choice: tools.length > 0 ? "auto" : undefined,
          max_completion_tokens: 1024,
        },
        { totalTimeoutMs: remainingBudget, origen: origenUso }
      );

      const choice = completion.choices[0];
      const assistantMsg = choice.message;
      // Ahorro de tokens: si el modelo ya escribió la respuesta y solo pidió herramientas de
      // registro (etiqueta, datos, etapa, nota, resumen, aviso), se ejecutan y se usa ese texto
      // sin otra vuelta al modelo, que reenviaría el prompt entero solo para repetir lo mismo.
      const textoJuntoAHerramientas = (assistantMsg.content ?? "").trim();
      const soloRegistro =
        Boolean(textoJuntoAHerramientas) &&
        Boolean(assistantMsg.tool_calls?.length) &&
        (assistantMsg.tool_calls ?? []).every(
          (tc) => tc.type === "function" && HERRAMIENTAS_SOLO_REGISTRO.has(tc.function.name)
        );

      if (choice.finish_reason === "tool_calls" && assistantMsg.tool_calls?.length) {
        llmMessages.push(assistantMsg);
        let detenido = false;
        let algunaFallo = false;
        let mensajeFinal: string | undefined;

        for (const tc of assistantMsg.tool_calls) {
          if (tc.type !== "function") continue;
          toolCalls++;
          executedTools.push(tc.function.name);
          executedToolsRef.push(tc.function.name);

          let args: unknown = {};
          try {
            args = JSON.parse(tc.function.arguments);
          } catch {
            // si no parsea, la tool recibe {} y responde su propio error
          }

          const result = await executeTool(tc.function.name, args, ctx);
          if (!result.ok) algunaFallo = true;
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
        // Si alguna herramienta falló, el modelo debe verlo antes de responder.
        if (!soloRegistro || algunaFallo) continue;
      }

      let reply = limpiarFormatoWhatsApp(assistantMsg.content?.trim() ?? "");
      if (yaRespondio && reply) {
        reply = removerSaludoRepetido(reply);
      }
      if (claveYaEntregada && reply) {
        reply = removerMencionClaveSiYaEntregada(reply);
      }
      if (reply) reply = await aplicarFiltroSalud(reply, contact.id);
      if (reply) reply = await aplicarDatosEnvio(reply, await requisitosVigentes(), contact.id);
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

      // C2: Validar determinísticamente que el bot nunca escriba una clave ni un monto/cantidad que contradiga la orden
      const checkOrden = validarRespuestaBotContraOrden(reply, ordenActiva);
      if (checkOrden.bloqueado) {
        console.warn(`[guardrail-orden] Bloqueado en conv ${conversation.id}: ${checkOrden.motivo} - ${checkOrden.detalle}`);
        reply = checkOrden.textoSeguro;
        await Promise.all([
          db.update(contacts).set({ needsHuman: true, updatedAt: new Date() }).where(eq(contacts.id, contact.id)),
          db.update(conversations).set({ needsHuman: true, updatedAt: new Date() }).where(eq(conversations.id, conversation.id)),
          db.insert(activities).values({
            type: "note",
            description: `[GUARDRAIL C2] Respuesta del bot intervenida (${checkOrden.motivo}): ${checkOrden.detalle}. Se derivó el chat a un asesor humano.`,
            contactId: contact.id,
          }),
        ]);
        await alertarEquipo({
          contactId: contact.id,
          conversationId: conversation.id,
          titulo: `⚠️ Guardrail C2 (${contact.name})`,
          cuerpo: `${checkOrden.detalle ?? "El bot intentó enviar clave o monto inválido"}. Se derivó a asesor humano.`,
        });
        await notificarSupervisoresCritico({
          tipo: "guardrail_bloqueo",
          titulo: "Respuesta bloqueada",
          detalle: `${checkOrden.detalle ?? "El bot intentó enviar una clave o un monto inválido"} El cliente recibió el mensaje de derivación; respóndele a mano.`,
          clienteNombre: contact.name,
          clienteTelefono: contact.phone,
          contactId: contact.id,
          conversationId: conversation.id,
        }).catch((err) => console.warn("[agent] aviso a supervisores falló:", err));
      }

      reply = conPreguntaDeAvance(reply, guion, executedTools, checkOrden.bloqueado);

      const convMeta = (conversation.metadata as Record<string, unknown> | null) ?? {};
      if (convMeta.copilotMode === true) {
        // En modo asistido: NO despachar directo a WhatsApp. Guardar sugerencia para aprobación humana.
        const updatedMeta = {
          ...convMeta,
          suggestedReply: {
            text: reply,
            createdAt: new Date().toISOString(),
          },
        };
        await db
          .update(conversations)
          .set({ metadata: updatedMeta, updatedAt: new Date() })
          .where(eq(conversations.id, conversation.id));
        await db.update(contacts).set({ updatedAt: new Date() }).where(eq(contacts.id, contact.id));
        return { ok: true, reply, toolCalls, copilot: true };
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
          mensajeUsuario: typeof lastUser === "string" ? lastUser : "",
          respuestaBot: reply,
          conversationId: conversation.id,
        }).catch((err) => console.warn("[scheduler] Error en auto-detección:", err));
      }

      // Auto-clasificación y análisis de conversación para colocar o actualizar etiquetas
      const { autoClasificarYEtiquetarConversacion } = await import("./etiquetado");
      const lastUserParaEtiqueta = Array.isArray(collapsed) ? collapsed[collapsed.length - 1]?.content : "";
      autoClasificarYEtiquetarConversacion({
        contactId: contact.id,
        conversationId: conversation.id,
        mensajeUsuario: typeof lastUserParaEtiqueta === "string" ? lastUserParaEtiqueta : "",
        respuestaBot: reply,
        toolsEjecutadas: executedTools,
      }).catch((err) => console.warn("[etiquetado] Error en auto-clasificación:", err));

      return { ok: true, reply, toolCalls };
    }

    // A1: se agotaron las rondas de herramientas. Ultimo intento sin herramientas para que
    // el cliente reciba texto; si tampoco, cortesia y aviso al equipo.
    llmMessages.push({ role: "system", content: PEDIDO_RESPUESTA_TEXTO });
    const final = await createChatCompletionWithFallback({
      model: config.model,
      messages: llmMessages,
      max_completion_tokens: 1024,
    }, { origen: origenUso });
    let textoFinal = limpiarFormatoWhatsApp(final.choices[0]?.message?.content?.trim() ?? "");
    if (yaRespondio && textoFinal) {
      textoFinal = removerSaludoRepetido(textoFinal);
    }
    if (claveYaEntregada && textoFinal) {
      textoFinal = removerMencionClaveSiYaEntregada(textoFinal);
    }
    if (textoFinal) textoFinal = await aplicarFiltroSalud(textoFinal, contact.id);
    if (textoFinal) textoFinal = await aplicarDatosEnvio(textoFinal, await requisitosVigentes(), contact.id);
    if (textoFinal) {
      const checkFinal = validarRespuestaBotContraOrden(textoFinal, ordenActiva);
      if (checkFinal.bloqueado) {
        textoFinal = checkFinal.textoSeguro;
        await Promise.all([
          db.update(contacts).set({ needsHuman: true, updatedAt: new Date() }).where(eq(contacts.id, contact.id)),
          db.update(conversations).set({ needsHuman: true, updatedAt: new Date() }).where(eq(conversations.id, conversation.id)),
        ]);
      }
      textoFinal = conPreguntaDeAvance(textoFinal, guion, executedTools, checkFinal.bloqueado);
      const convMetaFinal = (conversation.metadata as Record<string, unknown> | null) ?? {};
      if (convMetaFinal.copilotMode === true) {
        const updatedMeta = {
          ...convMetaFinal,
          suggestedReply: {
            text: textoFinal,
            createdAt: new Date().toISOString(),
          },
        };
        await db
          .update(conversations)
          .set({ metadata: updatedMeta, updatedAt: new Date() })
          .where(eq(conversations.id, conversation.id));
        await db.update(contacts).set({ updatedAt: new Date() }).where(eq(contacts.id, contact.id));
        return { ok: true, reply: textoFinal, copilot: true };
      }

      const entrega = await deliverMessage(conversation.id, { text: textoFinal }, "agent");
      if (entrega.ok) {
        await db.update(contacts).set({ updatedAt: new Date() }).where(eq(contacts.id, contact.id));

        if (!executedTools.includes("agendar_entrega")) {
          const lastUser = Array.isArray(collapsed) ? collapsed[collapsed.length - 1]?.content : "";
          autoDetectarYAgendarHorario({
            contactId: contact.id,
            mensajeUsuario: typeof lastUser === "string" ? lastUser : "",
            respuestaBot: textoFinal,
            conversationId: conversation.id,
          }).catch((err) => console.warn("[scheduler] Error en auto-detección:", err));
        }

        // Auto-clasificación y análisis de conversación para colocar o actualizar etiquetas
        const { autoClasificarYEtiquetarConversacion } = await import("./etiquetado");
        const lastUserParaEtiquetaFinal = Array.isArray(collapsed) ? collapsed[collapsed.length - 1]?.content : "";
        autoClasificarYEtiquetarConversacion({
          contactId: contact.id,
          conversationId: conversation.id,
          mensajeUsuario: typeof lastUserParaEtiquetaFinal === "string" ? lastUserParaEtiquetaFinal : "",
          respuestaBot: textoFinal,
          toolsEjecutadas: executedTools,
        }).catch((err) => console.warn("[etiquetado] Error en auto-clasificación:", err));

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
    // 413: un respaldo rechazó el prompt por tamaño; al reintentar vuelve a probar Gemini.
    const transitorio =
      status === undefined || status === 413 || status === 429 || status === 500 || status === 503 || /timeout|timed out|too large/i.test(rawMsg);
    if (opts.reintento !== false && toolCalls === 0 && transitorio) {
      console.warn(`[agent] Reintentando turno de ${conversation.id} en ${REINTENTO_MS / 1000}s tras: ${categoriaError}`);
      await new Promise((r) => setTimeout(r, REINTENTO_MS));
      // Si el segundo intento tambien falla, el mismo envia el mensaje de cortesia y avisa.
      return executeAgentTurn(conversationId, { reintento: false });
    }

    // R9b: si tampoco hubo suerte, cortesia + nota + aviso.
    await avisarSinRespuesta(conversation.id, contact, categoriaError, `llm_failure: ${rawMsg}`, toolCalls, rawMsg);
    return { ok: false, reason: `llm_failure: ${rawMsg}`, toolCalls };
  }
}

/**
 * V2 (auditoría 21/11): si la respuesta no tiene pregunta y el chat está en venta, se agrega
 * la pregunta de avance de la etapa. No aplica si en este turno se registró el pedido, se
 * derivó a un asesor o una guarda reemplazó la respuesta.
 */
const HERRAMIENTAS_SIN_PREGUNTA = ["crear_pedido_chat", "confirmar_pedido", "derivar_asesor", "avisar_asesor", "solicitar_soporte_pedido"];
function conPreguntaDeAvance(
  texto: string,
  guion: { etapa: Parameters<typeof asegurarPreguntaDeAvance>[1]["etapa"]; producto: "nac600" | "termix" | null; ultimoCliente: string },
  herramientas: string[],
  intervenida: boolean
): string {
  if (intervenida || herramientas.some((h) => HERRAMIENTAS_SIN_PREGUNTA.includes(h))) return texto;
  return asegurarPreguntaDeAvance(texto, guion);
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
  // E3: antes de avisar al equipo, el bot reintenta solo (3 y 10 min). La cortesía sale
  // una vez, en la primera falla.
  // Si la IA cayó a mitad de un turno que ya ejecutó herramientas, no se repite el turno
  // (podría duplicar acciones): se avisa como antes.
  const fallasPrevias = await contarFallasRecientes(conversationId);
  const decision =
    reason.startsWith("llm_failure") && toolCalls > 0 ? ({ accion: "avisar_equipo" } as const) : decidirReintento(fallasPrevias);
  if (decision.accion === "reintentar") {
    try {
      if (decision.cortesia) await deliverMessage(conversationId, { text: MENSAJE_CORTESIA }, "agent");
      const [ultimoCliente] = await db
        .select({ id: messages.id })
        .from(messages)
        .where(and(eq(messages.conversationId, conversationId), eq(messages.direction, "in")))
        .orderBy(desc(messages.createdAt))
        .limit(1);
      if (ultimoCliente) {
        await enqueueAgentJob(contact.id, ultimoCliente.id, conversationId, decision.enMs);
        await db.insert(activities).values({
          type: "note",
          description: `[BOT REINTENTA] No pudo responder (${categoria}); vuelve a intentar en ${Math.round(decision.enMs / 60_000)} min.`,
          contactId: contact.id,
        });
        return { ok: false, reason, toolCalls };
      }
    } catch (err) {
      console.warn("[agent] No se pudo programar el reintento:", err);
    }
  }

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
  await notificarSupervisoresCritico({
    tipo: "bot_sin_respuesta",
    titulo: "Bot sin respuesta",
    detalle: `Motivo: ${categoria}. El cliente está esperando: respóndele a mano.`,
    clienteNombre: contact.name,
    clienteTelefono: contact.phone,
    contactId: contact.id,
    conversationId,
  }).catch((err) => console.warn("[agent] aviso a supervisores falló:", err));

  return { ok: false, reason, toolCalls };
}

/** Turnos del bot de este chat que no lograron responder en los últimos 30 min. */
async function contarFallasRecientes(conversationId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(agentJobs)
    .where(
      and(
        eq(agentJobs.conversationId, conversationId),
        eq(agentJobs.status, "failed"),
        gte(agentJobs.updatedAt, new Date(Date.now() - VENTANA_FALLAS_MS)),
        or(
          sql`${agentJobs.error} like 'llm_failure%'`,
          inArray(agentJobs.error, ["empty_reply", "max_tool_rounds_exceeded"])
        )
      )
    );
  return row?.n ?? 0;
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

  const orderedRows = [...rows].reverse();
  const hayRespuestaPrevia = orderedRows.some(
    (m) =>
      m.direction === "out" &&
      !esSaludoAutomatico(m.direction, m.origin, m.body) &&
      !esMensajeCortesia(m.direction, m.body) &&
      Boolean(m.body?.trim())
  );

  const collapsed: Array<{ role: "user" | "assistant"; content: string }> = [];
  for (const m of orderedRows) {
    // El saludo automatico de WhatsApp Business no cuenta como respuesta: si lo
    // dejaramos, el primer "Quiero mas informacion" del anuncio quedaria sin contestar.
    if (esSaludoAutomatico(m.direction, m.origin, m.body)) continue;
    // «Disculpa la demora» no es una respuesta: el reintento tiene que contestar la pregunta.
    if (esMensajeCortesia(m.direction, m.body)) continue;
    const role: "user" | "assistant" = m.direction === "in" ? "user" : "assistant";
    // E7: fotos viejas del equipo guardadas como «enviada por el cliente».
    const text = corregirImagenSaliente(m.direction, m.body)?.trim();
    if (!text) continue;
    // Evitar bucle infinito cuando llegan reacciones, stickers o eventos "[Unsupported message]"
    // si ya hubo atención previa en el chat.
    if (role === "user" && hayRespuestaPrevia && /^\[(?:Unsupported message|sticker)\]$/i.test(text)) {
      continue;
    }
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

/**
 * Venta a provincia por Shalom sin DNI o sin agencia oficial: la respuesta tiene que
 * pedirlos (caso #1153: el bot se despidió tras el adelanto sin pedir ninguno).
 */
async function aplicarDatosEnvio(texto: string, req: RequisitosShalom, contactId: string): Promise<string> {
  const r = exigirDatosEnvio(texto, req);
  if (!r.agregado && !r.promesaQuitada) return texto;
  const que = [req.faltaDni ? "DNI" : null, req.faltaAgencia ? "agencia Shalom oficial" : null].filter(Boolean).join(" y ");
  await db
    .insert(activities)
    .values({
      type: "note",
      description:
        `[DATOS ENVIO] ${r.agregado ? `El bot pidió ${que} (faltan para emitir la guía${req.numeroOrden ? ` de ${req.numeroOrden}` : ""}).` : ""}` +
        `${r.promesaQuitada ? " Se quitó una promesa de clave/despacho: aún no hay guía." : ""}`.trim(),
      contactId,
    })
    .catch((err) => console.warn("[datos-envio] no se pudo guardar la nota:", err instanceof Error ? err.message : err));
  return r.texto;
}

/**
 * Reglas 2 y 3 sin depender del modelo: quita promesas de salud y "estándares/certificaciones"
 * antes de enviar, y deja una nota en el contacto para que el equipo vea qué se corrigió.
 */
async function aplicarFiltroSalud(texto: string, contactId: string): Promise<string> {
  const r = corregirFrasesSalud(texto);
  if (!r.corregido) return texto;
  console.warn(`[filtro-salud] corregido en contacto ${contactId}: ${r.frasesQuitadas.join(" | ").slice(0, 300)}`);
  await db
    .insert(activities)
    .values({
      type: "note",
      description: `[FILTRO SALUD] Se corrigió la respuesta del bot antes de enviarla. Frase quitada: "${r.frasesQuitadas.join(" / ").slice(0, 400)}"`,
      contactId,
    })
    .catch((err) => console.warn("[filtro-salud] no se pudo guardar la nota:", err instanceof Error ? err.message : err));
  return r.texto;
}
