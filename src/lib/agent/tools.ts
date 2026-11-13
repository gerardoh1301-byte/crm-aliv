import "server-only";
import type OpenAI from "openai";
import { db } from "@/db";
import {
  activities,
  contacts,
  conversations,
  crmSettings,
  deals,
  messages,
  pipelineStages,
  pipelines,
} from "@/db/schema";
import { and, desc, eq, sql } from "drizzle-orm";
import { assignContact } from "@/lib/contacts/assign";
import { displayName, findMemberByName } from "@/lib/team";
import { setDealStage } from "@/lib/deals/stage";
import { camposContacto, getConfig } from "@/lib/config";
import { validarCamposPersonalizados } from "@/lib/config/campos";
import { toolsDeModulos } from "@/lib/modules";
import { alertarEquipo } from "./alertas";
import { esMotivoDeBaja, MENSAJE_BAJA, TAG_NO_REACTIVAR } from "./baja";
import { agendarEventoCalendario } from "./scheduler";
import { pedidosOrdenes } from "../../../modules/pedidos/tabla";

/**
 * Tools del agente.
 *
 * Las del NUCLEO son genericas: sirven para cualquier negocio y actuan sobre el CRM
 * (etapa, ficha, actividades, resumen, derivacion, asignacion). Lo especifico de un
 * nicho (propiedades, visitas...) lo aportan los modulos activos (`servidor.tools`).
 *
 * Ajustes -> Agente lista todo esto y permite apagar cada una por canal.
 */

export const ENABLED_TOOLS_SETTINGS_KEY = "agent.enabled_tools";

export interface ToolContext {
  contactId: string;
  /** Solo WhatsApp. En Instagram y Messenger no hay telefono: el identificador es IGSID/PSID. */
  contactPhone: string | null;
  conversationId?: string | null;
  channel?: string;
}

export interface ToolResult {
  ok: boolean;
  data?: unknown;
  error?: string;
  /**
   * true = despues de este resultado el agente no sigue el loop: manda el mensaje de
   * derivacion y termina (derivar_asesor).
   */
  stop?: boolean;
  /** Con `stop`: texto a enviar en lugar del mensaje de derivacion (p. ej. la despedida de una baja). */
  mensajeFinal?: string;
}

export interface ToolAgente {
  definicion: OpenAI.Chat.Completions.ChatCompletionFunctionTool;
  /** Texto para Ajustes -> Agente IA. */
  descripcionUI: string;
  ejecutar: (args: Record<string, unknown>, ctx: ToolContext) => Promise<ToolResult>;
}

type Params = NonNullable<OpenAI.Chat.Completions.ChatCompletionFunctionTool["function"]["parameters"]>;

function definir(name: string, description: string, parameters: Params): OpenAI.Chat.Completions.ChatCompletionFunctionTool {
  return { type: "function", function: { name, description, parameters } };
}

function normalizar(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

// ============================================================
// Tools genericas del nucleo
// ============================================================

async function moverEtapa(args: { etapa?: string; motivo?: string }, ctx: ToolContext): Promise<ToolResult> {
  const q = normalizar(String(args.etapa ?? ""));
  if (!q) return { ok: false, error: "etapa vacia" };

  const [pipeline] = await db.select().from(pipelines).where(eq(pipelines.isDefault, true)).limit(1);
  if (!pipeline) return { ok: false, error: "No hay pipeline configurado" };

  const stages = await db
    .select()
    .from(pipelineStages)
    .where(eq(pipelineStages.pipelineId, pipeline.id))
    .orderBy(pipelineStages.order);

  const stage =
    stages.find((s) => s.key === q || normalizar(s.name) === q) ??
    stages.find((s) => normalizar(s.name).includes(q) || (s.key ?? "").includes(q));
  if (!stage) {
    return {
      ok: false,
      error: `Etapa desconocida "${args.etapa}". Disponibles: ${stages.map((s) => s.key ?? s.name).join(", ")}`,
    };
  }

  // Etapas que solo mueve una persona: despacho y entrega siempre; "Pedido confirmado"
  // mientras haya un pedido con el adelanto sin verificar (una captura no es un pago).
  if (stage.key === "en_reparto" || stage.key === "entregado") {
    return { ok: false, error: `La etapa "${stage.name}" la mueve una persona del equipo. Usa avisar_asesor si hace falta.` };
  }
  if (stage.key === "pedido_confirmado") {
    // Solo si ya existe un pedido confirmado (Lima registrado en el chat, pedido web
    // confirmado o adelanto verificado por una persona). Sin pedido, o con el adelanto
    // pendiente, el bot no puede dar la operacion por confirmada.
    const pedidosDelContacto = await db
      .select({ numeroOrden: pedidosOrdenes.numeroOrden, estado: pedidosOrdenes.estado })
      .from(pedidosOrdenes)
      .where(eq(pedidosOrdenes.contactId, ctx.contactId));
    const pendiente = pedidosDelContacto.find((p) => p.estado === "por_confirmar_cod");
    const confirmado = pedidosDelContacto.some((p) => p.estado === "confirmado");
    if (pendiente || !confirmado) {
      return {
        ok: false,
        error: pendiente
          ? `El pedido ${pendiente.numeroOrden} tiene el adelanto sin verificar. Solo una persona lo confirma con el boton "Adelanto confirmado". No muevas la etapa: usa avisar_asesor y dile al cliente que el equipo valida su pago.`
          : `No hay un pedido registrado. Si el cliente ya dio todos sus datos, primero usa crear_pedido_chat; la etapa "Pedido confirmado" la pone el sistema o una persona.`,
      };
    }
  }

  // Operacion abierta del contacto en este pipeline (la mas reciente).
  const [abierta] = await db
    .select({ id: deals.id, stageId: deals.stageId })
    .from(deals)
    .innerJoin(pipelineStages, eq(deals.stageId, pipelineStages.id))
    .where(
      and(
        eq(deals.contactId, ctx.contactId),
        eq(pipelineStages.pipelineId, pipeline.id),
        eq(pipelineStages.isWon, false),
        eq(pipelineStages.isLost, false)
      )
    )
    .orderBy(desc(deals.updatedAt))
    .limit(1);

  if (abierta) {
    if (abierta.stageId === stage.id) {
      return { ok: true, data: { etapa: stage.name, sin_cambio: true, message: `Ya estaba en ${stage.name}.` } };
    }
    // El bot no retrocede una operacion que ya tiene pedido (en simulaciones movia un pedido
    // de Lima recien registrado a "Por confirmar COD", o uno de provincia a "Intencion de
    // compra", y el pedido desaparecia de la vista del equipo). Cancelar va hacia adelante.
    const actual = stages.find((s) => s.id === abierta.stageId);
    const conPedido = stages.find((s) => s.key === "por_confirmar_cod");
    if (actual && conPedido && actual.order >= conPedido.order && stage.order < actual.order) {
      return {
        ok: true,
        data: { etapa: actual.name, sin_cambio: true, message: `La operacion ya esta en "${actual.name}"; no se retrocede.` },
      };
    }
    const r = await setDealStage({ dealId: abierta.id, stageId: stage.id });
    if (!r.ok) return { ok: false, error: r.error ?? "No se pudo mover la etapa" };
    await db.insert(activities).values({
      type: "note",
      description: `Agente IA movio la operacion a "${stage.name}"${args.motivo ? `: ${args.motivo}` : ""}`,
      contactId: ctx.contactId,
    });
    return { ok: true, data: { etapa: stage.name, operacion: abierta.id, creada: false } };
  }

  const [contact] = await db.select({ name: contacts.name }).from(contacts).where(eq(contacts.id, ctx.contactId)).limit(1);
  const [nueva] = await db
    .insert(deals)
    .values({ title: contact?.name ?? "Operacion", stageId: stage.id, contactId: ctx.contactId })
    .returning({ id: deals.id });
  await setDealStage({ dealId: nueva.id, stageId: stage.id, justCreated: true });
  await db.insert(activities).values({
    type: "note",
    description: `Agente IA creo la operacion en "${stage.name}"${args.motivo ? `: ${args.motivo}` : ""}`,
    contactId: ctx.contactId,
  });
  return { ok: true, data: { etapa: stage.name, operacion: nueva.id, creada: true } };
}

async function actualizarContacto(
  args: { nombre?: string; email?: string; telefono?: string; notas?: string; campos?: Record<string, unknown> },
  ctx: ToolContext
): Promise<ToolResult> {
  const [actual] = await db.select().from(contacts).where(eq(contacts.id, ctx.contactId)).limit(1);
  if (!actual) return { ok: false, error: "contacto no encontrado" };

  const set: Partial<typeof contacts.$inferInsert> = { updatedAt: new Date() };
  const cambios: string[] = [];

  if (typeof args.nombre === "string" && args.nombre.trim()) {
    set.name = args.nombre.trim().slice(0, 120);
    cambios.push("nombre");
  }
  if (typeof args.email === "string" && args.email.includes("@")) {
    set.email = args.email.trim().toLowerCase();
    cambios.push("email");
  }
  if (typeof args.telefono === "string" && args.telefono.trim()) {
    set.phone = args.telefono.trim();
    cambios.push("telefono");
  }
  if (typeof args.notas === "string" && args.notas.trim()) {
    const nota = `[IA] ${args.notas.trim()}`;
    set.notes = actual.notes ? `${actual.notes}\n${nota}` : nota;
    cambios.push("notas");
  }
  if (args.campos && typeof args.campos === "object") {
    const v = validarCamposPersonalizados(camposContacto(), args.campos, { parcial: true });
    if (!v.ok) return { ok: false, error: v.error };
    set.customFields = { ...((actual.customFields as Record<string, unknown> | null) ?? {}), ...v.valores };
    cambios.push(...Object.keys(v.valores));
  }

  if (cambios.length === 0) return { ok: false, error: "nada para actualizar" };
  await db.update(contacts).set(set).where(eq(contacts.id, ctx.contactId));
  return { ok: true, data: { actualizado: cambios } };
}

const TIPOS_ACTIVIDAD: Record<string, string> = {
  nota: "note",
  tarea: "follow_up",
  seguimiento: "follow_up",
  llamada: "call",
  reunion: "meeting",
  email: "email",
  entrega: "delivery",
  envio: "delivery",
  despacho: "delivery",
  cobro: "payment",
  pago: "payment",
};

async function agendarEntrega(
  args: {
    tipo?: string;
    fecha?: string;
    horario?: string;
    descripcion?: string;
    direccion?: string;
    monto?: number | string;
  },
  ctx: ToolContext
): Promise<ToolResult> {
  const tipoRaw = String(args.tipo ?? "entrega").toLowerCase();
  const tipo = (TIPOS_ACTIVIDAD[tipoRaw] ?? (tipoRaw === "cobro" ? "payment" : "delivery")) as "delivery" | "payment";

  const resultado = await agendarEventoCalendario({
    contactId: ctx.contactId,
    tipo,
    fecha: args.fecha,
    horario: args.horario,
    descripcion: args.descripcion,
    direccion: args.direccion,
    monto: args.monto,
  });

  return {
    ok: true,
    data: {
      agendado: true,
      actividadId: resultado.principal.id,
      cobroPrevioId: resultado.cobroPrevio?.id ?? null,
      tipo,
      fecha: resultado.principal.scheduledAt?.toISOString() ?? null,
      horario: args.horario,
      descripcion: resultado.principal.description,
      message: resultado.cobroPrevio
        ? "Entrega y Cobro/Confirmación previa agendados con éxito en el Calendario oficial."
        : "Actividad colocada con éxito en el Calendario oficial del CRM.",
    },
  };
}

async function registrarActividad(
  args: { tipo?: string; descripcion?: string; fecha?: string },
  ctx: ToolContext
): Promise<ToolResult> {
  const descripcion = String(args.descripcion ?? "").trim();
  if (!descripcion) return { ok: false, error: "descripcion vacia" };
  const tipo = TIPOS_ACTIVIDAD[normalizar(String(args.tipo ?? "nota"))] ?? "note";
  let scheduledAt: Date | null = null;
  if (args.fecha) {
    const d = new Date(String(args.fecha));
    if (!Number.isNaN(d.getTime())) scheduledAt = d;
  }
  const [row] = await db
    .insert(activities)
    .values({ type: tipo, description: `[IA] ${descripcion}`, contactId: ctx.contactId, scheduledAt })
    .returning({ id: activities.id });
  return { ok: true, data: { actividad: row.id, tipo, programada: scheduledAt?.toISOString() ?? null } };
}

async function resumenLead(
  args: { resumen?: string; campos?: Record<string, unknown> },
  ctx: ToolContext
): Promise<ToolResult> {
  const resumen = String(args.resumen ?? "").trim();
  if (!resumen) return { ok: false, error: "resumen vacio" };

  const set: Partial<typeof contacts.$inferInsert> = {
    aiSummary: resumen.slice(0, 2000),
    aiSummaryAt: new Date(),
    updatedAt: new Date(),
  };
  if (args.campos && typeof args.campos === "object") {
    const v = validarCamposPersonalizados(camposContacto(), args.campos, { parcial: true });
    if (!v.ok) return { ok: false, error: v.error };
    const [actual] = await db.select({ cf: contacts.customFields }).from(contacts).where(eq(contacts.id, ctx.contactId)).limit(1);
    set.customFields = { ...((actual?.cf as Record<string, unknown> | null) ?? {}), ...v.valores };
  }
  await db.update(contacts).set(set).where(eq(contacts.id, ctx.contactId));
  await db.insert(activities).values({
    type: "note",
    description: `Resumen del agente IA: ${resumen.slice(0, 500)}`,
    contactId: ctx.contactId,
  });
  return { ok: true, data: { guardado: true } };
}

async function derivarAsesor(args: { motivo?: string; apagarAgente?: boolean }, ctx: ToolContext): Promise<ToolResult> {
  const motivo = String(args.motivo ?? "derivado por el agente").slice(0, 300);
  const now = new Date();

  // "Avisar sin apagar": marca alerta para el equipo humano pero NO apaga aiEnabled
  // a menos que sea una baja ("no me escriban más").
  // A2: se revisa el motivo que escribio el modelo y tambien el ultimo mensaje del cliente.
  let ultimoCliente = "";
  if (ctx.conversationId) {
    const [m] = await db
      .select({ body: messages.body })
      .from(messages)
      .where(and(eq(messages.conversationId, ctx.conversationId), eq(messages.direction, "in")))
      .orderBy(desc(messages.createdAt))
      .limit(1);
    ultimoCliente = m?.body ?? "";
  }
  const esBaja = esMotivoDeBaja(motivo) || esMotivoDeBaja(ultimoCliente);
  const apagar = Boolean(args.apagarAgente) || esBaja;

  if (esBaja) {
    // Que ningun proceso automatico (reactivacion por inactividad) le vuelva a escribir.
    await db
      .update(contacts)
      .set({ tags: sql`array_append(array_remove(${contacts.tags}, ${TAG_NO_REACTIVAR}), ${TAG_NO_REACTIVAR})`, updatedAt: now })
      .where(eq(contacts.id, ctx.contactId));
  }

  if (ctx.conversationId) {
    await db
      .update(conversations)
      .set({
        ...(apagar ? { aiEnabled: false } : {}),
        needsHuman: true,
        needsHumanReason: motivo,
        needsHumanAt: now,
        updatedAt: now,
      })
      .where(eq(conversations.id, ctx.conversationId));
  } else {
    await db
      .update(contacts)
      .set({
        ...(apagar ? { aiEnabled: false } : {}),
        needsHuman: true,
        needsHumanReason: motivo,
        needsHumanAt: now,
        updatedAt: now,
      })
      .where(eq(contacts.id, ctx.contactId));
  }

  await db.insert(activities).values({
    type: "note",
    description: `Agente IA notificó a asesor. Motivo: ${motivo}${apagar ? " (Agente pausado)" : " (Agente sigue activo)"}`,
    contactId: ctx.contactId,
  });

  // Aviso inmediato al celular (push), a cualquier hora, sin esperar el barrido de alertas.
  const [c] = await db
    .select({ name: contacts.name, phone: contacts.phone })
    .from(contacts)
    .where(eq(contacts.id, ctx.contactId))
    .limit(1);
  await alertarEquipo({
    contactId: ctx.contactId,
    conversationId: ctx.conversationId,
    titulo: `Requiere humano: ${c?.name ?? "cliente"}`,
    cuerpo: `${motivo}${esBaja ? " (pidió no ser contactado: bot pausado y etiqueta no-reactivar)" : apagar ? " (bot pausado)" : " (el bot sigue activo)"}`,
  });

  return {
    ok: true,
    stop: apagar,
    ...(esBaja ? { mensajeFinal: MENSAJE_BAJA } : {}),
    data: {
      derivado: true,
      motivo,
      message: apagar
        ? "Agente pausado en esta conversacion por baja o solicitud expresa."
        : "Asesor alertado en el CRM. El agente sigue activo respondiendo dudas simples sin confirmar pagos.",
    },
  };
}

async function avisarAsesor(args: { motivo?: string }, ctx: ToolContext): Promise<ToolResult> {
  return derivarAsesor({ motivo: args.motivo ?? "aviso a asesor", apagarAgente: false }, ctx);
}

async function asignarAsesor(args: { asesor?: string; motivo?: string }, ctx: ToolContext): Promise<ToolResult> {
  const found = await findMemberByName(String(args.asesor ?? ""));

  if (found.status === "ambiguous") {
    return {
      ok: false,
      error:
        `Hay varias personas que coinciden con "${args.asesor}": ` +
        found.candidates.map(displayName).join(", ") +
        ". Especifica cual.",
    };
  }
  if (found.status === "not_found") {
    return {
      ok: false,
      error: `No existe "${args.asesor}". Disponibles: ` + (found.available.map(displayName).join(", ") || "ninguno"),
    };
  }

  const result = await assignContact({
    contactId: ctx.contactId,
    ownerId: found.member.id,
    by: { type: "agent" },
    reason: args.motivo,
  });
  if (!result.ok) return { ok: false, error: result.error };

  return {
    ok: true,
    data: {
      asignado_a: displayName(found.member),
      ya_estaba_asignado: result.unchanged ?? false,
      message: result.unchanged
        ? `El contacto ya estaba asignado a ${displayName(found.member)}.`
        : `Contacto asignado a ${displayName(found.member)}. Se le envio un aviso.`,
    },
  };
}

async function enviarImagenReferencia(
  args: { clave?: string; motivo?: string },
  ctx: ToolContext
): Promise<ToolResult> {
  const { buscarImagenReferencia } = await import("./imagenes-referencia");
  const { deliverMessage } = await import("@/lib/channels/deliver");

  if (!args.clave) {
    return {
      ok: false,
      error:
        "Debes especificar la clave de la imagen (ej: 'nac600_frasco', 'nac600_beneficios', 'termix_tobillera', 'yape_adelanto').",
    };
  }

  const img = buscarImagenReferencia(args.clave);
  if (!img) {
    return {
      ok: false,
      error: `Imagen no encontrada para clave '${args.clave}'. Claves válidas: termix_tobillera, termix_promocion, termix_foto_real, termix_contenido_caja, termix_caracteristicas, termix_comparativa, nac600_frasco, nac600_beneficios, yape_adelanto.`,
    };
  }

  if (!ctx.conversationId) {
    return { ok: false, error: "No hay una conversación activa asociada para enviar la imagen." };
  }

  const caption = args.motivo?.trim() || `¡Aquí te comparto: ${img.titulo}! ✨`;

  const res = await deliverMessage(
    ctx.conversationId,
    {
      text: caption,
      attachments: [
        {
          type: "image",
          url: img.url,
          name: img.titulo,
        },
      ],
    },
    "agent"
  );

  if (!res.ok) {
    return { ok: false, error: res.error ?? "No se pudo enviar la imagen por el canal." };
  }

  return {
    ok: true,
    data: {
      enviada: true,
      imagen: img.id,
      titulo: img.titulo,
      url: img.url,
    },
  };
}

function toolsGenericas(): ToolAgente[] {
  const campos = camposContacto();
  const etiquetaAsesor = getConfig().roles.etiquetaAsesor.toLowerCase();
  const descripcionCampos =
    campos.length > 0
      ? "Claves disponibles: " +
        campos
          .map((c) => `${c.clave} (${c.tipo}${c.opciones ? ": " + c.opciones.join("|") : ""})`)
          .join("; ")
      : "No hay campos personalizados configurados.";

  return [
    {
      definicion: definir(
        "mover_etapa",
        "Mueve la operacion del contacto a una etapa del pipeline (o la crea en esa etapa si no tiene una abierta). " +
          "Usar cuando el cliente avanza o retrocede en el proceso; las etapas disponibles estan en la seccion PIPELINE del contexto.",
        {
          type: "object",
          properties: {
            etapa: { type: "string", description: "Clave o nombre de la etapa, como figura en PIPELINE." },
            motivo: { type: "string", description: "Por que se mueve, en pocas palabras." },
          },
          required: ["etapa"],
          additionalProperties: false,
        }
      ),
      descripcionUI: "Mueve (o crea) la operacion del contacto en el pipeline. Que etapa usar en cada momento lo decide el prompt.",
      ejecutar: (a, ctx) => moverEtapa(a as { etapa?: string; motivo?: string }, ctx),
    },
    {
      definicion: definir(
        "actualizar_contacto",
        "Guarda en la ficha del contacto los datos que vas averiguando: nombre, email, telefono, notas y los campos personalizados del negocio. " +
          descripcionCampos,
        {
          type: "object",
          properties: {
            nombre: { type: "string" },
            email: { type: "string" },
            telefono: { type: "string" },
            notas: { type: "string", description: "Observacion breve para el equipo." },
            campos: {
              type: "object",
              description: "Pares clave: valor de los campos personalizados. " + descripcionCampos,
              additionalProperties: true,
            },
          },
          additionalProperties: false,
        }
      ),
      descripcionUI: "Actualiza la ficha del contacto (datos basicos y campos personalizados de config/cliente.ts).",
      ejecutar: (a, ctx) => actualizarContacto(a as Parameters<typeof actualizarContacto>[0], ctx),
    },
    {
      definicion: definir(
        "registrar_actividad",
        "Anota una actividad en la ficha para el equipo: una nota, o una tarea/seguimiento con fecha (por ejemplo 'llamar el lunes').",
        {
          type: "object",
          properties: {
            tipo: { type: "string", enum: ["nota", "tarea", "llamada", "reunion", "email", "entrega", "cobro"] },
            descripcion: { type: "string" },
            fecha: { type: "string", description: "ISO 8601 si es una tarea con fecha (opcional)." },
          },
          required: ["descripcion"],
          additionalProperties: false,
        }
      ),
      descripcionUI: "Registra notas y tareas con fecha en la ficha del contacto.",
      ejecutar: (a, ctx) => registrarActividad(a as Parameters<typeof registrarActividad>[0], ctx),
    },
    {
      definicion: definir(
        "agendar_entrega",
        "Agenda una entrega de pedido, despacho o cobro con fecha y horario en el Calendario oficial del CRM. " +
          "OBLIGATORIO usarla cuando el cliente indique o confirme el día u horario para recibir su pedido (ej. 'Sábado de 8 a 4', 'el viernes en la mañana', 'mañana a las 3pm').",
        {
          type: "object",
          properties: {
            tipo: {
              type: "string",
              enum: ["entrega", "cobro", "llamada", "seguimiento"],
              description: "Tipo de evento: 'entrega' (despacho/entrega a domicilio), 'cobro' (pago programado), 'llamada' o 'seguimiento'.",
            },
            fecha: {
              type: "string",
              description: "Fecha en formato YYYY-MM-DD (ej: '2026-11-14'). Calcula el día exacto usando la fecha de hoy {{fecha}}.",
            },
            horario: {
              type: "string",
              description: "Franja u horario indicado por el cliente (ej: 'Sábado de 8:00 a 16:00', 'de 8 a 4', 'en la mañana').",
            },
            descripcion: {
              type: "string",
              description: "Detalle completo del pedido y entrega (ej: 'Entrega pedido #1081: 2 frascos NAC600 (S/189) a José Navarro').",
            },
            direccion: {
              type: "string",
              description: "Dirección de destino completa o agencia donde se entregará.",
            },
            monto: {
              type: "number",
              description: "Monto total a cobrar en soles si es pago al recibir (contraentrega).",
            },
          },
          required: ["tipo", "fecha", "descripcion"],
          additionalProperties: false,
        }
      ),
      descripcionUI: "Agenda entregas, envíos y cobros con fecha y horario directamente en el Calendario del CRM.",
      ejecutar: (a, ctx) => agendarEntrega(a as Parameters<typeof agendarEntrega>[0], ctx),
    },
    {
      definicion: definir(
        "resumen_lead",
        "Deja en la ficha un resumen de 2 a 4 frases de lo que busca el cliente, su situacion y los proximos pasos. " +
          "Usar cuando la conversacion llego a un punto util o el cliente se despidio. Puede incluir campos personalizados.",
        {
          type: "object",
          properties: {
            resumen: { type: "string" },
            campos: { type: "object", description: "Campos personalizados confirmados. " + descripcionCampos, additionalProperties: true },
          },
          required: ["resumen"],
          additionalProperties: false,
        }
      ),
      descripcionUI: "Escribe el resumen del lead en la ficha (visible en contactos y en el chat).",
      ejecutar: (a, ctx) => resumenLead(a as Parameters<typeof resumenLead>[0], ctx),
    },
    {
      definicion: definir(
        "derivar_asesor",
        "Pasa la conversación al equipo humano marcando una alerta en el CRM. " +
          "Usar ante consultas de salud delicadas, reclamos o cuando el cliente solicita un asesor humano. " +
          "El bot sigue activo respondiendo dudas simples mientras el asesor toma el chat.",
        {
          type: "object",
          properties: { motivo: { type: "string", description: "Razón detallada de la derivación o alerta." } },
          required: ["motivo"],
          additionalProperties: false,
        }
      ),
      descripcionUI: "Permite al agente alertar a un asesor en el CRM sin apagar al bot (avisa sin apagar).",
      ejecutar: (a, ctx) => derivarAsesor(a as { motivo?: string }, ctx),
    },
    {
      definicion: definir(
        "avisar_asesor",
        "Avisa inmediatamente al equipo humano en el CRM marcando la conversación como 'requiere humano'. " +
          "El bot SIGUE ACTIVO en el chat. Usar ante capturas de pago enviadas, pedido con datos completos, " +
          "o cambios solicitados por el cliente.",
        {
          type: "object",
          properties: { motivo: { type: "string", description: "Motivo del aviso (ej. 'Captura de pago recibida para validar despacho')" } },
          required: ["motivo"],
          additionalProperties: false,
        }
      ),
      descripcionUI: "Alerta al equipo humano en el CRM de inmediato mientras el bot sigue atendiendo (avisar sin apagar).",
      ejecutar: (a, ctx) => avisarAsesor(a as { motivo?: string }, ctx),
    },
    {
      definicion: definir(
        "asignar_asesor",
        `Asigna este contacto a un ${etiquetaAsesor} del equipo, que recibe un aviso. NO pausa al agente. ` +
          "Las personas disponibles estan en la seccion EQUIPO del contexto; usa el nombre tal cual aparece.",
        {
          type: "object",
          properties: {
            asesor: { type: "string", description: "Nombre (o email) como figura en EQUIPO." },
            motivo: { type: "string" },
          },
          required: ["asesor"],
          additionalProperties: false,
        }
      ),
      descripcionUI: `Permite al agente asignar el contacto a un ${etiquetaAsesor} por nombre. Dispara la automatizacion de aviso.`,
      ejecutar: (a, ctx) => asignarAsesor(a as { asesor?: string; motivo?: string }, ctx),
    },
    {
      definicion: definir(
        "enviar_imagen_referencia",
        "Envía una imagen o infografía de referencia oficial al cliente por WhatsApp hospedada en Google Drive CDN (sin recargar el servidor del CRM). " +
          "Claves válidas: 'termix_tobillera' (foto en pie), 'termix_promocion' (banner precios), 'termix_foto_real' (en mano encendida), 'termix_contenido_caja' (unboxing), 'termix_caracteristicas' (grafeno/masaje), 'termix_comparativa' (vs comunes), 'nac600_frasco', 'nac600_beneficios', 'yape_adelanto'.",
        {
          type: "object",
          properties: {
            clave: {
              type: "string",
              description: "Identificador de la imagen: 'termix_tobillera', 'termix_promocion', 'termix_foto_real', 'termix_contenido_caja', 'termix_caracteristicas', 'termix_comparativa', 'nac600_frasco', 'nac600_beneficios' o 'yape_adelanto'.",
            },
            motivo: {
              type: "string",
              description: "Pie de foto (caption) breve y cordial para acompañar la imagen en WhatsApp (opcional).",
            },
          },
          required: ["clave"],
          additionalProperties: false,
        }
      ),
      descripcionUI: "Permite al agente enviar fotos oficiales de productos, infografías de beneficios y datos de pago directamente por WhatsApp desde Google Drive CDN.",
      ejecutar: (a, ctx) => enviarImagenReferencia(a as { clave?: string; motivo?: string }, ctx),
    },
  ];
}

// ============================================================
// Registro
// ============================================================

/** Todas las tools disponibles en esta instancia: nucleo + nicho + modulos activos. */
export function listarTools(): ToolAgente[] {
  return [...toolsGenericas(), ...toolsDeModulos()];
}

export function nombresDeTools(): string[] {
  return listarTools().map((t) => t.definicion.function.name);
}

export function descripcionesUI(): Array<{ name: string; description: string }> {
  return listarTools().map((t) => ({ name: t.definicion.function.name, description: t.descripcionUI }));
}

export function esNombreDeTool(name: string): boolean {
  return nombresDeTools().includes(name);
}

export async function executeTool(name: string, args: unknown, ctx: ToolContext): Promise<ToolResult> {
  const tool = listarTools().find((t) => t.definicion.function.name === name);
  if (!tool) return { ok: false, error: `Tool desconocida: ${name}` };
  const argumentos = args && typeof args === "object" && !Array.isArray(args) ? (args as Record<string, unknown>) : {};
  try {
    return await tool.ejecutar(argumentos, ctx);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Error ejecutando tool" };
  }
}

/**
 * Tools habilitadas globalmente (`crm_settings`). Sin fila = todas. Los nombres que ya
 * no existen (modulo apagado, tool renombrada) se descartan.
 */
export async function getEnabledToolNames(): Promise<string[]> {
  const todas = nombresDeTools();
  try {
    const [row] = await db.select().from(crmSettings).where(eq(crmSettings.key, ENABLED_TOOLS_SETTINGS_KEY)).limit(1);
    if (!row) return todas;
    const parsed: unknown = JSON.parse(row.value);
    if (!Array.isArray(parsed)) return todas;
    const set = new Set(todas);
    return parsed.filter((n): n is string => typeof n === "string" && set.has(n));
  } catch (err) {
    console.error("[tools] error leyendo enabled_tools, usando default", err);
    return todas;
  }
}

/** Definiciones para el LLM, filtradas a las habilitadas. */
export async function getEnabledToolDefinitions(names?: string[]): Promise<OpenAI.Chat.Completions.ChatCompletionTool[]> {
  const enabled = new Set(names ?? (await getEnabledToolNames()));
  return listarTools()
    .filter((t) => enabled.has(t.definicion.function.name))
    .map((t) => t.definicion);
}
