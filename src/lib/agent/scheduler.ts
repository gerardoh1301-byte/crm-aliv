import { db } from "@/db";
import { activities, contacts, deals } from "@/db/schema";
import { pedidosOrdenes } from "../../../modules/pedidos/tabla";
import { and, desc, eq, gte } from "drizzle-orm";

interface AgendarParams {
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
 * Calcula la fecha correspondiente a un día de la semana o texto relativo (hora de Perú).
 */
export function calcularFechaProxima(texto: string, baseDate: Date = new Date()): Date {
  const t = texto.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const res = new Date(baseDate);

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

  if (t.includes("pasado manana")) {
    res.setDate(res.getDate() + 2);
    return res;
  }
  if (t.includes("manana")) {
    res.setDate(res.getDate() + 1);
    return res;
  }
  if (t.includes("hoy")) {
    return res;
  }

  // Verificar si menciona un día de la semana
  for (const [diaNombre, diaNum] of Object.entries(diasMap)) {
    if (t.includes(diaNombre)) {
      const hoyNum = res.getDay();
      let diff = diaNum - hoyNum;
      // Si el día ya pasó esta semana o es hoy, tomar el próximo
      if (diff <= 0) {
        diff += 7;
      }
      res.setDate(res.getDate() + diff);
      return res;
    }
  }

  // Verificar fecha explícita ej. "el 15", "14 de noviembre" o "15/11"
  const matchDiaDirecto = t.match(/\bel\s+(\d{1,2})\b/);
  const matchFechaMes = t.match(/\b(\d{1,2})\s*(?:de|\/)\s*(?:[a-z]+|\d{1,2})\b/);
  const matchFinal = matchDiaDirecto || matchFechaMes;
  if (matchFinal) {
    const diaMes = parseInt(matchFinal[1], 10);
    if (diaMes >= 1 && diaMes <= 31) {
      res.setDate(diaMes);
      if (res < baseDate) {
        res.setMonth(res.getMonth() + 1);
      }
      return res;
    }
  }

  return res;
}

/**
 * Parsea el horario (ej. "de 8 a 4", "8am a 4pm", "a las 3pm", "14:00")
 * y retorna la hora de inicio (0-23) y minutos.
 */
export function parsearHoraInicio(horarioTexto: string): { hora: number; minutos: number } {
  const hText = horarioTexto.toLowerCase();

  if (hText.includes("tarde") && !hText.match(/\d/)) {
    return { hora: 15, minutos: 0 };
  }
  if (hText.includes("noche") && !hText.match(/\d/)) {
    return { hora: 19, minutos: 0 };
  }
  if (hText.includes("mañana") && !hText.match(/\d/)) {
    return { hora: 9, minutos: 0 };
  }

  let hora = 9; // 9:00 AM por defecto
  let minutos = 0;

  const matchRango = hText.match(/\b(\d{1,2})(?::(\d{2}))?\s*(?:a|hasta|-)\s*(\d{1,2})/i);
  if (matchRango) {
    hora = parseInt(matchRango[1], 10);
    if (matchRango[2]) minutos = parseInt(matchRango[2], 10);
    return { hora, minutos };
  }

  const matchSimple = hText.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i);
  if (matchSimple) {
    hora = parseInt(matchSimple[1], 10);
    if (matchSimple[2]) minutos = parseInt(matchSimple[2], 10);
    const esPm = /pm/i.test(matchSimple[3] || "");
    if (esPm && hora < 12) hora += 12;
    if (!esPm && hora === 12 && /am/i.test(matchSimple[3] || "")) hora = 0;
  }

  return { hora, minutos };
}

/**
 * Registra una actividad agendada (Entrega, Cobro, Llamada) en el Calendario oficial.
 */
export async function agendarEventoCalendario(params: AgendarParams) {
  const { contactId, tipo = "delivery", horario = "", direccion = "", monto } = params;

  let scheduledAt: Date;
  if (params.fecha instanceof Date) {
    scheduledAt = params.fecha;
  } else if (typeof params.fecha === "string" && /^\d{4}-\d{2}-\d{2}$/.test(params.fecha)) {
    const { hora, minutos } = parsearHoraInicio(horario);
    scheduledAt = new Date(`${params.fecha}T${String(hora).padStart(2, "0")}:${String(minutos).padStart(2, "0")}:00-05:00`);
  } else if (typeof params.fecha === "string") {
    const base = calcularFechaProxima(params.fecha);
    const { hora, minutos } = parsearHoraInicio(horario);
    base.setHours(hora, minutos, 0, 0);
    scheduledAt = base;
  } else {
    const base = calcularFechaProxima(horario);
    const { hora, minutos } = parsearHoraInicio(horario);
    base.setHours(hora, minutos, 0, 0);
    scheduledAt = base;
  }

  // Buscar deal activo o pedido si no se especificó
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

  // Obtener datos del cliente y pedido si existen
  let infoPedido = "";
  try {
    const [pedido] = await db
      .select({
        numeroOrden: pedidosOrdenes.numeroOrden,
        total: pedidosOrdenes.total,
        direccionEnvio: pedidosOrdenes.direccionEnvio,
        ciudad: pedidosOrdenes.ciudad,
        distrito: pedidosOrdenes.distrito,
      })
      .from(pedidosOrdenes)
      .where(eq(pedidosOrdenes.contactId, contactId))
      .orderBy(desc(pedidosOrdenes.createdAt))
      .limit(1);

    if (pedido) {
      infoPedido = `Pedido ${pedido.numeroOrden} (${pedido.total ? `S/ ${pedido.total}` : ""})`;
    }
  } catch {
    // ignorar
  }

  const partesDesc: string[] = [];
  if (tipo === "delivery") partesDesc.push("🚚 [ENTREGA AGENDADA]");
  else if (tipo === "payment") partesDesc.push("💰 [COBRO AGENDADO]");
  else if (tipo === "call") partesDesc.push("📞 [LLAMADA AGENDADA]");
  else partesDesc.push("📅 [SEGUIMIENTO AGENDADO]");

  if (params.descripcion) {
    partesDesc.push(params.descripcion);
  } else if (infoPedido) {
    partesDesc.push(infoPedido);
  }

  if (horario) partesDesc.push(`Horario: ${horario}`);
  if (direccion) partesDesc.push(`Dirección: ${direccion}`);
  if (monto) partesDesc.push(`Cobro: S/ ${monto}`);

  const descripcionFinal = partesDesc.join(" · ");

  const [row] = await db
    .insert(activities)
    .values({
      type: tipo,
      description: descripcionFinal,
      contactId,
      dealId,
      scheduledAt,
    })
    .returning();

  return row;
}

/**
 * Detector automático: revisa si el último mensaje del cliente o la respuesta del bot
 * coordinó una fecha/horario de entrega o cobro y asegura que quede en el calendario.
 */
export async function autoDetectarYAgendarHorario(params: {
  contactId: string;
  mensajeUsuario?: string;
  respuestaBot?: string;
  conversationId?: string;
}) {
  const { contactId, mensajeUsuario = "", respuestaBot = "" } = params;
  const textoTotal = `${mensajeUsuario} \n ${respuestaBot}`.toLowerCase();

  // Patrones de fecha / horario de entrega o cobro
  const tieneDia = /lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo|ma[nñ]ana|hoy/i.test(textoTotal);
  const tieneHorario = /\b(?:de\s+\d{1,2}\s+a\s+\d{1,2}|\d{1,2}\s*(?:am|pm)|en la ma[nñ]ana|en la tarde|a las \d{1,2})\b/i.test(textoTotal);
  const tieneIntencion = /entrega|env[ií]o|despacho|recibir|llegar|coordin[eé]|agend[eé]|horario|cobro|pagar/i.test(textoTotal);

  if (!tieneDia && !tieneHorario) return null;
  if (!tieneIntencion && !tieneHorario) return null;

  // Evitar duplicados: si ya se creó una actividad programada en los últimos 15 minutos, ignorar
  const hace15Min = new Date(Date.now() - 15 * 60 * 1000);
  const [existente] = await db
    .select({ id: activities.id })
    .from(activities)
    .where(
      and(
        eq(activities.contactId, contactId),
        gte(activities.createdAt, hace15Min)
      )
    )
    .limit(1);

  if (existente) return null;

  // Extraer el texto del horario
  let horarioExtraido = "";
  const matchHorario = textoTotal.match(/\b(?:s[aá]bado|viernes|lunes|martes|mi[eé]rcoles|jueves|domingo|ma[nñ]ana|hoy)?\s*(?:de\s+\d{1,2}\s*(?:am|pm)?\s*(?:a|hasta|-)\s*\d{1,2}\s*(?:am|pm)?|\d{1,2}\s*(?:am|pm)|en la ma[nñ]ana|en la tarde)\b/i);
  if (matchHorario) {
    horarioExtraido = matchHorario[0].trim();
  } else if (tieneDia) {
    const matchDia = textoTotal.match(/\b(lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo|ma[nñ]ana|hoy)\b/i);
    if (matchDia) horarioExtraido = matchDia[0].trim();
  }

  // Buscar pedido más reciente del cliente
  const [pedido] = await db
    .select({
      numeroOrden: pedidosOrdenes.numeroOrden,
      total: pedidosOrdenes.total,
      direccionEnvio: pedidosOrdenes.direccionEnvio,
      items: pedidosOrdenes.items,
    })
    .from(pedidosOrdenes)
    .where(eq(pedidosOrdenes.contactId, contactId))
    .orderBy(desc(pedidosOrdenes.createdAt))
    .limit(1);

  const [cliente] = await db
    .select({ name: contacts.name, phone: contacts.phone })
    .from(contacts)
    .where(eq(contacts.id, contactId))
    .limit(1);

  const itemsTxt = pedido?.items && Array.isArray(pedido.items)
    ? (pedido.items as Array<{ cantidad: number; titulo: string }>).map((i) => `${i.cantidad}x ${i.titulo}`).join(", ")
    : "Pedido Aliv";

  const descripcionActividad = pedido
    ? `Pedido ${pedido.numeroOrden}: ${itemsTxt} para ${cliente?.name ?? "Cliente"}`
    : `Coordinación con ${cliente?.name ?? "Cliente"}`;

  const tipo = /cobro|pagar|abono/i.test(textoTotal) ? "payment" : "delivery";

  return await agendarEventoCalendario({
    contactId,
    tipo,
    fecha: horarioExtraido || "mañana",
    horario: horarioExtraido,
    descripcion: descripcionActividad,
    direccion: pedido?.direccionEnvio ?? "",
    monto: pedido?.total ?? undefined,
  });
}
