import "server-only";
import { db } from "@/db";
import { activities, contacts, deals, messages, pipelineStages } from "@/db/schema";
import { desc, eq } from "drizzle-orm";
import { cleanStr, esEtiquetaDeEtapa, TODAS_LAS_ETIQUETAS } from "@/lib/tags";
import { pedidosOrdenes } from "../../../modules/pedidos/tabla";
import { adelantoRegistrado, esPedidoDeProvincia } from "@/lib/pedidos/adelanto";

/**
 * Normaliza cualquier string de etiqueta al formato oficial del CRM
 * (conservando mayúsculas, minúsculas y tildes oficiales).
 */
export function normalizarNombreEtiqueta(nombre: string): string {
  const norm = cleanStr(nombre);

  // 1. Buscar en catálogo oficial
  const exacta = TODAS_LAS_ETIQUETAS.find((e) => cleanStr(e.nombre) === norm);
  if (exacta) return exacta.nombre;

  // 2. Variantes comunes de IA
  if (norm === "agendar entrega" || norm === "agendada" || norm === "agendado" || norm.includes("agendar")) {
    return "Agendar entrega";
  }
  if (norm === "pendiente de adelanto" || norm === "pendiente adelanto" || norm === "adelanto pendiente") {
    return "Pendiente de adelanto";
  }
  if (norm === "informativo" || norm === "informacion" || norm === "consulta") {
    return "Informativo";
  }
  if (norm === "compra exitosa" || norm === "entregado y cobrado" || norm === "cobrado") {
    return "Compra exitosa";
  }
  if (norm === "orden en camino" || norm === "en camino" || norm === "despachado") {
    return "Orden en camino";
  }
  if (norm === "cancelado" || norm === "rechazado" || norm === "cancelada") {
    return "Cancelado";
  }
  if (norm === "adelanto pagado" || norm === "adelanto verificado" || norm === "pago adelanto") {
    return "adelanto pagado";
  }
  if (norm === "pedido confirmado" || norm === "confirmado") {
    return "pedido confirmado";
  }
  if (norm === "esperando respuesta") {
    return "esperando respuesta";
  }
  if (norm === "en agencia shalom" || norm === "shalom") {
    return "en agencia shalom";
  }
  if (norm === "motorizado lima" || norm === "motorizado") {
    return "motorizado lima";
  }
  if (norm.includes("nac600")) {
    return "interes:nac600";
  }
  if (norm.includes("termix")) {
    return "interes:termix";
  }

  return nombre.trim();
}

/**
 * Aplica una etiqueta a un contacto de forma segura y consistente.
 */
export async function aplicarEtiquetaAContacto(params: {
  contactId: string;
  etiqueta: string;
  accion?: "establecer_estado" | "agregar" | "quitar";
  motivo?: string;
}): Promise<{ ok: boolean; tags: string[]; etiquetaNormalizada: string; error?: string }> {
  const { contactId, motivo } = params;
  const accion = params.accion ?? "establecer_estado";
  const etiquetaNorm = normalizarNombreEtiqueta(params.etiqueta);

  const [contacto] = await db
    .select({ id: contacts.id, tags: contacts.tags })
    .from(contacts)
    .where(eq(contacts.id, contactId))
    .limit(1);

  if (!contacto) {
    return { ok: false, tags: [], etiquetaNormalizada: etiquetaNorm, error: "Contacto no encontrado" };
  }

  const tagsActuales: string[] = contacto.tags ?? [];
  let nuevosTags: string[] = [...tagsActuales];

  if (accion === "quitar") {
    nuevosTags = tagsActuales.filter((t) => cleanStr(t) !== cleanStr(etiquetaNorm));
  } else if (accion === "agregar") {
    if (!tagsActuales.some((t) => cleanStr(t) === cleanStr(etiquetaNorm))) {
      nuevosTags = [...tagsActuales, etiquetaNorm];
    }
  } else {
    // "establecer_estado": si es una etiqueta de etapa/estado del funnel,
    // reemplaza cualquier estado anterior pero conserva tags de sistema (shopify, etc.) y secundarias.
    const esEstado = esEtiquetaDeEtapa(etiquetaNorm) || cleanStr(etiquetaNorm) === "cancelado";

    if (esEstado) {
      const sinEtapas = tagsActuales.filter((t) => !esEtiquetaDeEtapa(t) && cleanStr(t) !== "cancelado");
      nuevosTags = [...sinEtapas, etiquetaNorm];
    } else {
      if (!tagsActuales.some((t) => cleanStr(t) === cleanStr(etiquetaNorm))) {
        nuevosTags = [...tagsActuales, etiquetaNorm];
      }
    }
  }

  // Guardar si hubo cambios
  const cambio =
    nuevosTags.length !== tagsActuales.length ||
    nuevosTags.some((t, i) => t !== tagsActuales[i]);

  if (cambio) {
    await db
      .update(contacts)
      .set({ tags: nuevosTags, updatedAt: new Date() })
      .where(eq(contacts.id, contactId));

    await db.insert(activities).values({
      type: "note",
      description: `[IA] Etiqueta "${etiquetaNorm}" asignada${motivo ? `: ${motivo}` : ""}`,
      contactId,
    });
  }

  return { ok: true, tags: nuevosTags, etiquetaNormalizada: etiquetaNorm };
}

/**
 * Analizador automático de conversación:
 * Revisa el contexto, los mensajes recientes y el pedido para garantizar que
 * la etiqueta del contacto refleje siempre el estado fidedigno de la conversación.
 */
export async function autoClasificarYEtiquetarConversacion(params: {
  contactId: string;
  conversationId?: string;
  mensajeUsuario?: string;
  respuestaBot?: string;
  toolsEjecutadas?: string[];
}): Promise<{ analizado: boolean; etiquetaAsignada?: string; tags?: string[] }> {
  const { contactId, toolsEjecutadas = [] } = params;

  const [contacto] = await db
    .select({
      id: contacts.id,
      tags: contacts.tags,
      customFields: contacts.customFields,
    })
    .from(contacts)
    .where(eq(contacts.id, contactId))
    .limit(1);

  if (!contacto) return { analizado: false };

  const tagsActuales: string[] = contacto.tags ?? [];
  if (tagsActuales.includes("no-reactivar")) {
    return { analizado: false };
  }

  const userMsg = (params.mensajeUsuario || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
  const botMsg = (params.respuestaBot || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();

  // 1. Obtener pedido más reciente
  const [pedido] = await db
    .select({
      id: pedidosOrdenes.id,
      estado: pedidosOrdenes.estado,
      ciudad: pedidosOrdenes.ciudad,
      distrito: pedidosOrdenes.distrito,
      direccionEnvio: pedidosOrdenes.direccionEnvio,
      notas: pedidosOrdenes.notas,
      total: pedidosOrdenes.total,
    })
    .from(pedidosOrdenes)
    .where(eq(pedidosOrdenes.contactId, contactId))
    .orderBy(desc(pedidosOrdenes.createdAt))
    .limit(1);

  let etiquetaObjetivo: string | null = null;
  let motivo = "";

  // SEÑAL A: Cancelación explícita
  const esCancelacion =
    /\b(cancela|cancelar|ya no deseo|no deseo|no quiero|no voy a comprar|anula|anular|no me interesa|no gracias)\b/.test(userMsg);
  if (esCancelacion) {
    etiquetaObjetivo = "Cancelado";
    motivo = "Cliente indicó cancelación o rechazo";
  }

  // SEÑAL B: Agendar entrega
  // Si la tool agendar_entrega fue ejecutada, o se coordinó horario/fecha explícita
  if (!etiquetaObjetivo) {
    const tieneAgendarTool = toolsEjecutadas.includes("agendar_entrega");
    const botConfirmoAgendado =
      /ya quedo agendad|coordinada tu entrega|agendada tu entrega|te entregamos el|entrega programada/.test(botMsg);
    const clienteDioHorario =
      /\b(lunes|martes|miercoles|jueves|viernes|sabado|domingo|manana|hoy)\b/.test(userMsg) &&
      /\b(en la manana|en la tarde|de \d|a las \d|\d{1,2}\s*(?:am|pm))\b/.test(userMsg);

    if (tieneAgendarTool || botConfirmoAgendado || (clienteDioHorario && pedido)) {
      etiquetaObjetivo = "Agendar entrega";
      motivo = "Fecha u horario de entrega coordinado en la conversación";
    }
  }

  // SEÑAL C: Adelanto pagado / Comprobante
  if (!etiquetaObjetivo) {
    const pagoAvisado =
      /\b(ya yapee|ya pague|hice el yape|hice el pago|te envie el yape|ahi esta la captura|aqui esta el comprobante|ya deposite|ya transferi|listo el adelanto)\b/.test(
        userMsg
      );
    if (pagoAvisado) {
      etiquetaObjetivo = "adelanto pagado";
      motivo = "Cliente indicó pago de adelanto / comprobante";
    }
  }

  // SEÑAL D: Pedido confirmado / Pendiente de adelanto
  if (!etiquetaObjetivo && pedido) {
    const esProv = esPedidoDeProvincia(pedido);
    const adelantoPagado = adelantoRegistrado(pedido.notas);

    if (esProv && !adelantoPagado) {
      // Si ya tiene "Agendar entrega" previa, protegerla
      const yaTieneAgendar = tagsActuales.some((t) => cleanStr(t) === "agendar entrega");
      if (!yaTieneAgendar) {
        etiquetaObjetivo = "Pendiente de adelanto";
        motivo = "Pedido en provincia con adelanto S/20 pendiente";
      }
    } else if (!esProv && pedido.estado === "confirmado") {
      etiquetaObjetivo = "Agendar entrega";
      motivo = "Pedido en Lima listo para coordinar entrega";
    }
  }

  // SEÑAL E: Informativo
  // Si no hay pedido y el cliente solo está consultando precio, catálogo o dudas
  if (!etiquetaObjetivo && !pedido) {
    const yaTieneEstadoAvanzado = tagsActuales.some((t) => {
      const c = cleanStr(t);
      return c === "compra exitosa" || c === "orden en camino" || c === "agendar entrega";
    });

    if (!yaTieneEstadoAvanzado) {
      etiquetaObjetivo = "Informativo";
      motivo = "Consulta de producto o información general";
    }
  }

  // Tags secundarias de interés por producto
  const tagsInteresAAgregar: string[] = [];
  const todoTexto = `${userMsg} ${botMsg}`;
  if (/\b(nac600|nac|capsulas|cisteina|glutation|antioxidante)\b/.test(todoTexto)) {
    if (!tagsActuales.includes("interes:nac600")) {
      tagsInteresAAgregar.push("interes:nac600");
    }
  }
  if (/\b(termix|tobillera|masaje|calor|grafeno)\b/.test(todoTexto)) {
    if (!tagsActuales.includes("interes:termix")) {
      tagsInteresAAgregar.push("interes:termix");
    }
  }

  // Aplicar cambios si hay etiqueta objetivo
  let resultadoTags = tagsActuales;
  if (etiquetaObjetivo) {
    const res = await aplicarEtiquetaAContacto({
      contactId,
      etiqueta: etiquetaObjetivo,
      accion: "establecer_estado",
      motivo,
    });
    resultadoTags = res.tags;
  }

  // Agregar tags de interés si corresponden
  for (const ti of tagsInteresAAgregar) {
    const res = await aplicarEtiquetaAContacto({
      contactId,
      etiqueta: ti,
      accion: "agregar",
      motivo: "Interés detectado en la conversación",
    });
    resultadoTags = res.tags;
  }

  return {
    analizado: true,
    etiquetaAsignada: etiquetaObjetivo ?? undefined,
    tags: resultadoTags,
  };
}
