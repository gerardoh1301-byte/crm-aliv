import { db } from "@/db";
import { activities, contacts, deals } from "@/db/schema";
import { pedidosOrdenes } from "../../../modules/pedidos/tabla";
import { and, desc, eq, gte, inArray, isNull } from "drizzle-orm";
import { adelantoRegistrado, quienVerificoAdelanto, esPedidoDeProvincia } from "@/lib/pedidos/adelanto";

export interface AgendarParams {
  contactId: string;
  tipo?: "delivery" | "payment" | "call" | "follow_up";
  fecha?: string | Date;
  horario?: string;
  descripcion?: string;
  direccion?: string;
  monto?: number | string;
  dealId?: string | null;
}

/**
 * Obtiene los componentes de fecha/hora en la zona horaria oficial del negocio (America/Lima, UTC-5).
 * Esencial porque Render y servidores en la nube ejecutan en UTC.
 */
export function obtenerFechaLima(instante: Date = new Date()): {
  year: number;
  month: number; // 1 - 12
  day: number; // 1 - 31
  dayOfWeek: number; // 0 = domingo, 1 = lunes, ..., 6 = sábado
  hours: number;
  minutes: number;
} {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Lima",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    weekday: "short",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  });

  const parts = formatter.formatToParts(instante);
  let year = instante.getUTCFullYear();
  let month = instante.getUTCMonth() + 1;
  let day = instante.getUTCDate();
  let hours = instante.getUTCHours();
  let minutes = instante.getUTCMinutes();
  let dayOfWeek = 0;

  const weekdayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };

  for (const p of parts) {
    if (p.type === "year") year = parseInt(p.value, 10);
    else if (p.type === "month") month = parseInt(p.value, 10);
    else if (p.type === "day") day = parseInt(p.value, 10);
    else if (p.type === "hour") hours = parseInt(p.value, 10) % 24;
    else if (p.type === "minute") minutes = parseInt(p.value, 10);
    else if (p.type === "weekday") dayOfWeek = weekdayMap[p.value] ?? 0;
  }

  return { year, month, day, dayOfWeek, hours, minutes };
}

/**
 * Parsea el horario (ej. "de 8 a 4", "a las 10:00 a.m.", "de 2 a 5", "a las 3 de la tarde")
 * y retorna la hora de inicio (0-23) y minutos.
 *
 * Reglas de negocio Aliv:
 * - Ignora números de día (ej: "14 de noviembre", "el 14") para no confundirlos con la hora.
 * - Reconoce "de la tarde", "p. m.", "de la mañana", "a. m.".
 * - Heurística de reparto Aliv: Horas entre 1 y 7 sin am/pm son de la tarde (13:00 - 19:00).
 *   Horas entre 8 y 12 sin am/pm son de la mañana (08:00 - 12:00).
 */
export function parsearHoraInicio(horarioTexto: string): { hora: number; minutos: number } {
  const raw = (horarioTexto || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

  // 1. Eliminar expresiones de fecha que contengan números para no confundir el día con la hora
  // Ej: "14 de noviembre", "14 nov", "el 14", "14/11", "2026-11-14"
  const sinFechas = raw
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, " ")
    .replace(/\b\d{1,2}\s*(?:de|\/)?\s*(?:noviembre|nov|diciembre|dic|enero|ene|febrero|feb|marzo|mar|abril|abr|mayo|may|junio|jun|julio|jul|agosto|ago|setiembre|set|septiembre|sep|octubre|oct)\b/g, " ")
    .replace(/\b\d{1,2}\s*(?:de|\/)\s*\d{1,2}\b/g, " ")
    .replace(/\bel\s+\d{1,2}\b/g, " ")
    .replace(/\b(?:lunes|martes|miercoles|jueves|viernes|sabado|domingo)\s+\d{1,2}\b/g, " ");

  // 2. Frases sin hora numérica
  const tieneTarde = /tarde|pm|p\.m\.|noche/.test(sinFechas);
  const tieneManana = /manana|am|a\.m\.|temprano/.test(sinFechas);

  if (/en la tarde|por la tarde/.test(sinFechas) && !sinFechas.match(/\d/)) {
    return { hora: 15, minutos: 0 }; // 3:00 PM
  }
  if (/en la noche|por la noche/.test(sinFechas) && !sinFechas.match(/\d/)) {
    return { hora: 19, minutos: 0 }; // 7:00 PM
  }
  if (/en la manana|por la manana/.test(sinFechas) && !sinFechas.match(/\d/)) {
    return { hora: 9, minutos: 0 }; // 9:00 AM
  }
  if (/al mediodia|a mediodia/.test(sinFechas) && !sinFechas.match(/\d/)) {
    return { hora: 12, minutos: 0 };
  }

  // 3. Rangos de hora: "de 8 a 4", "8 a 16", "de 2 a 5", "entre 2 y 5"
  const matchRango = sinFechas.match(/\b(?:de|entre|desde)?\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?\s*(?:a|hasta|-|y)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?\b/);
  if (matchRango) {
    let h = parseInt(matchRango[1], 10);
    const m = matchRango[2] ? parseInt(matchRango[2], 10) : 0;
    const indicador = (matchRango[3] || matchRango[6] || "").toLowerCase();
    const esPm = /pm|p\.m\./.test(indicador) || tieneTarde;
    const esAm = /am|a\.m\./.test(indicador) || tieneManana;

    if (esPm && h < 12) h += 12;
    else if (esAm && h === 12) h = 0;
    else if (!esAm && !esPm) {
      // Heurística de entrega: 1..7 -> tarde (13..19), 8..12 -> mañana
      if (h >= 1 && h <= 7) h += 12;
    }
    return { hora: Math.min(23, Math.max(0, h)), minutos: m };
  }

  // 4. Hora específica: "a las 10:00 a.m.", "a las 3 de la tarde", "10am", "15:30"
  const matchEspecifico = sinFechas.match(/\b(?:a\s+las\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.|de la tarde|de la manana|de la noche)?\b/);
  if (matchEspecifico) {
    let h = parseInt(matchEspecifico[1], 10);
    const m = matchEspecifico[2] ? parseInt(matchEspecifico[2], 10) : 0;
    const ind = (matchEspecifico[3] || "").toLowerCase();
    const esPm = /pm|p\.m\.|tarde|noche/.test(ind) || tieneTarde;
    const esAm = /am|a\.m\.|manana/.test(ind) || tieneManana;

    if (esPm && h < 12) h += 12;
    else if (esAm && h === 12) h = 0;
    else if (!esAm && !esPm) {
      if (h >= 1 && h <= 7) h += 12;
    }
    return { hora: Math.min(23, Math.max(0, h)), minutos: m };
  }

  return { hora: 9, minutos: 0 };
}

/**
 * Calcula la fecha correspondiente a un día de la semana o texto relativo garantizando
 * la zona horaria America/Lima (UTC-5), sin desfases causados por el reloj UTC del servidor.
 */
export function calcularFechaProxima(texto: string, baseDate: Date = new Date()): { year: number; month: number; day: number } {
  const t = (texto || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const hoy = obtenerFechaLima(baseDate);

  const pad = (n: number) => String(n).padStart(2, "0");
  const formatear = (y: number, m: number, d: number) => ({ year: y, month: m, day: d });

  // Función auxiliar para sumar días en calendario civil
  const sumarDias = (dias: number) => {
    // Usar Date puro en UTC con los componentes de Lima para aritmética de días exacta
    const civil = new Date(Date.UTC(hoy.year, hoy.month - 1, hoy.day + dias, 12, 0, 0));
    return formatear(civil.getUTCFullYear(), civil.getUTCMonth() + 1, civil.getUTCDate());
  };

  if (t.includes("pasado manana")) {
    return sumarDias(2);
  }
  if (t.includes("manana")) {
    return sumarDias(1);
  }
  if (t.includes("hoy")) {
    return formatear(hoy.year, hoy.month, hoy.day);
  }

  // Días de la semana en español (0 = domingo, 1 = lunes, ..., 6 = sábado)
  const diasMap: Record<string, number> = {
    domingo: 0,
    lunes: 1,
    martes: 2,
    miercoles: 3,
    jueves: 4,
    viernes: 5,
    sabado: 6,
  };

  for (const [diaNombre, diaNum] of Object.entries(diasMap)) {
    if (t.includes(diaNombre)) {
      let diff = diaNum - hoy.dayOfWeek;
      // Si el día ya pasó esta semana o es hoy, tomar el próximo
      if (diff <= 0) {
        diff += 7;
      }
      return sumarDias(diff);
    }
  }

  // Verificar fecha explícita ej. "el 15", "14 de noviembre" o "15/11"
  const matchDiaDirecto = t.match(/\bel\s+(\d{1,2})\b/);
  const matchFechaMes = t.match(/\b(\d{1,2})\s*(?:de|\/)\s*(?:noviembre|nov|diciembre|dic|enero|ene|febrero|feb|marzo|mar|abril|abr|mayo|may|junio|jun|julio|jul|agosto|ago|setiembre|set|septiembre|sep|octubre|oct|\d{1,2})\b/);
  const matchFinal = matchDiaDirecto || matchFechaMes;
  if (matchFinal) {
    const diaMes = parseInt(matchFinal[1], 10);
    if (diaMes >= 1 && diaMes <= 31) {
      let mes = hoy.month;
      let anio = hoy.year;
      if (diaMes < hoy.day) {
        // Pasa al siguiente mes
        mes += 1;
        if (mes > 12) {
          mes = 1;
          anio += 1;
        }
      }
      return formatear(anio, mes, diaMes);
    }
  }

  // Por defecto, mañana
  return sumarDias(1);
}

/**
 * Construye un objeto Date estándar con el offset de Lima (-05:00) a partir de año, mes, día, hora y minutos.
 */
export function construirFechaLima(year: number, month: number, day: number, hours: number, minutes: number): Date {
  const pad = (n: number) => String(n).padStart(2, "0");
  const isoString = `${year}-${pad(month)}-${pad(day)}T${pad(hours)}:${pad(minutes)}:00-05:00`;
  return new Date(isoString);
}

/**
 * Registra eventos en el Calendario oficial del CRM.
 *
 * K1 · Doble agendamiento para Entregas:
 *      1. Evento de Entrega en la fecha y hora pactadas.
 *      2. Evento de Cobro / Confirmación el día anterior.
 *
 * K4 · Reprogramación limpia:
 *      Marca automáticamente como completadas/reprogramadas las entregas o cobros anteriores del mismo contacto.
 *
 * K5 · Descripción fidedigna:
 *      Construye el detalle basándose en datos reales de la orden y estado verificado del adelanto,
 *      sin copiar textos no verificados del LLM.
 */
export async function agendarEventoCalendario(params: AgendarParams) {
  const { contactId, tipo = "delivery", horario = "", direccion = "", monto } = params;

  // 1. Resolver Deal asociado
  let dealId = params.dealId ?? null;
  if (!dealId) {
    const [deal] = await db
      .select({ id: deals.id })
      .from(deals)
      .where(eq(deals.contactId, contactId))
      .orderBy(desc(deals.updatedAt))
      .limit(1);
    if (deal) dealId = deal.id;
  }

  // 2. Obtener datos reales del pedido más reciente
  let pedidoReal: {
    numeroOrden: string | null;
    total: string | null;
    direccionEnvio: string | null;
    ciudad: string | null;
    distrito: string | null;
    items: unknown;
    notas: string | null;
  } | null = null;

  try {
    const [ped] = await db
      .select({
        numeroOrden: pedidosOrdenes.numeroOrden,
        total: pedidosOrdenes.total,
        direccionEnvio: pedidosOrdenes.direccionEnvio,
        ciudad: pedidosOrdenes.ciudad,
        distrito: pedidosOrdenes.distrito,
        items: pedidosOrdenes.items,
        notas: pedidosOrdenes.notas,
      })
      .from(pedidosOrdenes)
      .where(eq(pedidosOrdenes.contactId, contactId))
      .orderBy(desc(pedidosOrdenes.createdAt))
      .limit(1);
    if (ped) pedidoReal = ped;
  } catch {
    // ignorar
  }

  // 3. K4: Marcar entregas o cobros pendientes anteriores como REPROGRAMADOS
  try {
    const pendientesAnteriores = await db
      .select({ id: activities.id, description: activities.description })
      .from(activities)
      .where(
        and(
          eq(activities.contactId, contactId),
          inArray(activities.type, ["delivery", "payment"]),
          isNull(activities.completedAt)
        )
      );

    for (const act of pendientesAnteriores) {
      await db
        .update(activities)
        .set({
          completedAt: new Date(),
          description: `${act.description} [REPROGRAMADO]`,
        })
        .where(eq(activities.id, act.id));
    }
  } catch (err) {
    console.warn("[scheduler] Error limpiando actividades anteriores:", err);
  }

  // 4. Calcular fecha y hora exactas en hora de Perú (America/Lima)
  const timeInfo = parsearHoraInicio(horario);
  let fechaComponentes: { year: number; month: number; day: number };

  if (params.fecha instanceof Date) {
    const fLima = obtenerFechaLima(params.fecha);
    fechaComponentes = { year: fLima.year, month: fLima.month, day: fLima.day };
  } else if (typeof params.fecha === "string" && /^\d{4}-\d{2}-\d{2}$/.test(params.fecha.trim())) {
    const [y, m, d] = params.fecha.trim().split("-").map((x) => parseInt(x, 10));
    fechaComponentes = { year: y, month: m, day: d };
  } else if (typeof params.fecha === "string" && params.fecha.trim()) {
    fechaComponentes = calcularFechaProxima(params.fecha);
  } else {
    fechaComponentes = calcularFechaProxima(horario);
  }

  const scheduledAtEntrega = construirFechaLima(
    fechaComponentes.year,
    fechaComponentes.month,
    fechaComponentes.day,
    timeInfo.hora,
    timeInfo.minutos
  );

  // 5. K5: Construir descripciones seguras y precisas basadas en la orden real
  const itemsTxt = pedidoReal?.items && Array.isArray(pedidoReal.items)
    ? (pedidoReal.items as Array<{ cantidad: number; titulo: string }>).map((i) => `${i.cantidad}x ${i.titulo}`).join(", ")
    : "Productos Aliv";

  const numOrden = pedidoReal?.numeroOrden ? `#${pedidoReal.numeroOrden}` : "S/N";
  const totalMonto = monto ? String(monto) : (pedidoReal?.total ? String(pedidoReal.total) : "");
  const direccionDestino = direccion || pedidoReal?.direccionEnvio || "";

  // Verificar estado del adelanto para provincias
  const esProv = pedidoReal ? esPedidoDeProvincia(pedidoReal) : false;
  const adelantoPagado = pedidoReal ? adelantoRegistrado(pedidoReal.notas) : false;
  const quienVerifico = pedidoReal ? quienVerificoAdelanto(pedidoReal.notas) : null;

  let estadoAdelantoTxt = "";
  if (esProv) {
    if (adelantoPagado) {
      estadoAdelantoTxt = quienVerifico ? `Adelanto S/20 VERIFICADO por ${quienVerifico}` : "Adelanto S/20 VERIFICADO";
    } else {
      estadoAdelantoTxt = "Adelanto S/20 PENDIENTE de verificación";
    }
  }

  // 6. Insertar evento principal
  const partesEntrega: string[] = [];
  if (tipo === "delivery") partesEntrega.push("🚚 [ENTREGA]");
  else if (tipo === "payment") partesEntrega.push("💰 [COBRO]");
  else if (tipo === "call") partesEntrega.push("📞 [LLAMADA]");
  else partesEntrega.push("📅 [AGENDADO]");

  partesEntrega.push(`Pedido ${numOrden}: ${itemsTxt}`);
  if (horario) partesEntrega.push(`Horario: ${horario}`);
  if (direccionDestino) partesEntrega.push(`Destino: ${direccionDestino}`);
  if (totalMonto) partesEntrega.push(`Monto: S/ ${totalMonto}`);
  if (estadoAdelantoTxt) partesEntrega.push(estadoAdelantoTxt);

  const descEntregaFinal = partesEntrega.join(" · ");

  const [eventoPrincipal] = await db
    .insert(activities)
    .values({
      type: tipo,
      description: descEntregaFinal,
      contactId,
      dealId,
      scheduledAt: scheduledAtEntrega,
    })
    .returning();

  // 7. K1: Si es una Entrega, agendar automáticamente el Cobro / Confirmación del día anterior
  let eventoCobro = null;
  if (tipo === "delivery") {
    // Calcular 1 día antes a las 11:00 AM (o mismo día si la entrega es hoy)
    const fechaCivilEntrega = new Date(Date.UTC(fechaComponentes.year, fechaComponentes.month - 1, fechaComponentes.day));
    const fechaHoyCivil = obtenerFechaLima();
    const esMismoDia = fechaComponentes.day === fechaHoyCivil.day && fechaComponentes.month === fechaHoyCivil.month && fechaComponentes.year === fechaHoyCivil.year;

    let fechaCobroComponentes: { year: number; month: number; day: number };
    let horaCobro = 11;

    if (esMismoDia) {
      // Si la entrega es hoy, la confirmación/cobro es prioritaria ahora
      fechaCobroComponentes = { year: fechaHoyCivil.year, month: fechaHoyCivil.month, day: fechaHoyCivil.day };
      horaCobro = Math.max(8, timeInfo.hora - 2);
    } else {
      const diaAnterior = new Date(Date.UTC(fechaComponentes.year, fechaComponentes.month - 1, fechaComponentes.day - 1, 12, 0, 0));
      fechaCobroComponentes = {
        year: diaAnterior.getUTCFullYear(),
        month: diaAnterior.getUTCMonth() + 1,
        day: diaAnterior.getUTCDate(),
      };
      // Si la entrega es temprano (8 o 9 am), coordinar la tarde anterior a las 16:00
      if (timeInfo.hora <= 10) horaCobro = 16;
    }

    const scheduledAtCobro = construirFechaLima(
      fechaCobroComponentes.year,
      fechaCobroComponentes.month,
      fechaCobroComponentes.day,
      horaCobro,
      0
    );

    const partesCobro: string[] = [];
    if (esProv) {
      partesCobro.push("💰 [COBRO PREVIO PROVINCIA]");
      partesCobro.push(`Verificar adelanto S/20 y confirmar despacho - Pedido ${numOrden}: ${itemsTxt}`);
      partesCobro.push(`Agencia/Destino: ${direccionDestino}`);
      partesCobro.push(estadoAdelantoTxt || "Verificar abono Yape antes de enviar por Shalom");
    } else {
      partesCobro.push("💰 [CONFIRMACIÓN Y COBRO]");
      partesCobro.push(`Confirmar ruta y cobro contraentrega - Pedido ${numOrden}: ${itemsTxt}`);
      if (totalMonto) partesCobro.push(`Total a cobrar al entregar: S/ ${totalMonto}`);
      if (direccionDestino) partesCobro.push(`Destino: ${direccionDestino}`);
    }

    const descCobroFinal = partesCobro.join(" · ");

    const [cobroRow] = await db
      .insert(activities)
      .values({
        type: "payment",
        description: descCobroFinal,
        contactId,
        dealId,
        scheduledAt: scheduledAtCobro,
      })
      .returning();

    eventoCobro = cobroRow;
  }

  // Asegurar que el contacto tenga la etiqueta "Agendar entrega" en el CRM
  try {
    const { aplicarEtiquetaAContacto } = await import("./etiquetado");
    await aplicarEtiquetaAContacto({
      contactId,
      etiqueta: "Agendar entrega",
      accion: "establecer_estado",
      motivo: "Entrega registrada en el Calendario oficial",
    });
  } catch (err) {
    console.warn("[scheduler] Error asignando etiqueta Agendar entrega:", err);
  }

  return {
    principal: eventoPrincipal,
    cobroPrevio: eventoCobro,
  };
}

/**
 * K6 · Detector automático:
 * - Evalúa exclusivamente el mensaje del cliente (mensajeUsuario) para evitar falsos positivos con textos del bot.
 * - Exige día y horario coordinados.
 * - Cancela solo si ya hubo una entrega o cobro en los últimos 15 min (no ante cualquier nota del bot).
 */
export async function autoDetectarYAgendarHorario(params: {
  contactId: string;
  mensajeUsuario?: string;
  respuestaBot?: string;
  conversationId?: string;
}) {
  const { contactId, mensajeUsuario = "" } = params;
  if (!mensajeUsuario.trim()) return null;

  const msg = mensajeUsuario.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

  // 1. Exigir día y hora presentes en el mensaje del cliente
  const tieneDia = /\b(lunes|martes|miercoles|jueves|viernes|sabado|domingo|manana|hoy|el\s+\d{1,2})\b/.test(msg);
  const tieneHora = /\b(?:de\s+\d{1,2}\s*(?:am|pm)?\s*(?:a|hasta|-)\s*\d{1,2}|\d{1,2}\s*(?:am|pm)|a\s+las\s+\d{1,2}|en la manana|en la tarde|en la noche)\b/.test(msg);

  // Si no tiene ambos (o una frase compuesta clara como "mañana a las 10"), no auto-agendar
  if (!tieneDia && !tieneHora) return null;
  if (tieneDia && !tieneHora && !/^(si|claro|confirmo|dale|perfecto)?\s*(el\s+)?(lunes|martes|miercoles|jueves|viernes|sabado|domingo|manana|hoy)$/.test(msg.trim())) {
    // Si solo dice "el sábado" sin hora, esperar a que el bot le pregunte el horario
    return null;
  }

  // 2. K6: Evitar duplicados revisando únicamente actividades de entrega o cobro recientes (15 min)
  const hace15Min = new Date(Date.now() - 15 * 60 * 1000);
  const [existente] = await db
    .select({ id: activities.id })
    .from(activities)
    .where(
      and(
        eq(activities.contactId, contactId),
        inArray(activities.type, ["delivery", "payment"]),
        gte(activities.createdAt, hace15Min)
      )
    )
    .limit(1);

  if (existente) return null;

  // 3. Extraer el texto del horario del mensaje del cliente
  let horarioExtraido = "";
  const matchRango = msg.match(/\b(?:de\s+\d{1,2}\s*(?:am|pm)?\s*(?:a|hasta|-)\s*\d{1,2}\s*(?:am|pm)?|\d{1,2}\s*(?:am|pm)|a\s+las\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?|en la manana|en la tarde|en la noche)\b/);
  if (matchRango) horarioExtraido = matchRango[0].trim();

  let fechaTexto = "";
  const matchDia = msg.match(/\b(lunes|martes|miercoles|jueves|viernes|sabado|domingo|manana|hoy|el\s+\d{1,2})\b/);
  if (matchDia) fechaTexto = matchDia[0].trim();

  return await agendarEventoCalendario({
    contactId,
    tipo: "delivery",
    fecha: fechaTexto || "manana",
    horario: horarioExtraido || msg,
  });
}
