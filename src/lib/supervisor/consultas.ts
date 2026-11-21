import "server-only";
import { db } from "@/db";
import { contacts } from "@/db/schema";
import { and, desc, eq, gte, inArray, lt, ne, sql } from "drizzle-orm";
import { pedidosOrdenes } from "@modules/pedidos/tabla";
import { adelantoRegistrado } from "@/lib/pedidos/adelanto";
import { cuentasDelPedido } from "./comandos";
import type { Periodo, TipoConsulta } from "./parser";

/**
 * Consultas generales del Administrador por WhatsApp («quién me debe», «resumen de hoy»).
 * Solo leen: nunca cambian nada.
 */

const MAX_FILAS = 15;
const soles = (n: number) => `S/ ${n.toFixed(2)}`;

type Fila = typeof pedidosOrdenes.$inferSelect & { contactName: string | null };

/** Inicio y fin del periodo en hora de Lima (UTC-5, sin horario de verano). */
export function rangoPeriodo(periodo: Periodo, ahora = new Date()): { desde: Date; hasta: Date; etiqueta: string } {
  const OFFSET = 5 * 3600_000;
  const lima = new Date(ahora.getTime() - OFFSET);
  const inicioHoy = Date.UTC(lima.getUTCFullYear(), lima.getUTCMonth(), lima.getUTCDate()) + OFFSET;
  const DIA = 86_400_000;
  if (periodo === "ayer") return { desde: new Date(inicioHoy - DIA), hasta: new Date(inicioHoy), etiqueta: "ayer" };
  if (periodo === "semana") {
    const dow = (lima.getUTCDay() + 6) % 7; // lunes = 0
    return { desde: new Date(inicioHoy - dow * DIA), hasta: new Date(inicioHoy + DIA), etiqueta: "esta semana" };
  }
  if (periodo === "mes") {
    const inicioMes = Date.UTC(lima.getUTCFullYear(), lima.getUTCMonth(), 1) + OFFSET;
    return { desde: new Date(inicioMes), hasta: new Date(inicioHoy + DIA), etiqueta: "este mes" };
  }
  return { desde: new Date(inicioHoy), hasta: new Date(inicioHoy + DIA), etiqueta: "hoy" };
}

/** Origen del pedido según su numeración. */
export function origenPedido(numeroOrden: string): "chat" | "web" | "otro" {
  if (/^#?CHAT-/i.test(numeroOrden)) return "chat";
  if (/^#\d+$/.test(numeroOrden) || /^#?ALIV-/i.test(numeroOrden)) return "web";
  return "otro";
}

function dias(desde: Date | string | null): string {
  if (!desde) return "";
  const d = Math.floor((Date.now() - new Date(desde).getTime()) / 86_400_000);
  return d <= 0 ? "hoy" : d === 1 ? "1 día" : `${d} días`;
}

function nombre(p: Fila): string {
  return (p.contactName || "Cliente").trim().split(/\s+/).slice(0, 2).join(" ");
}

async function pedidos(where: ReturnType<typeof and>, limite = 200): Promise<Fila[]> {
  const rows = await db
    .select({ pedido: pedidosOrdenes, contactName: contacts.name })
    .from(pedidosOrdenes)
    .leftJoin(contacts, eq(contacts.id, pedidosOrdenes.contactId))
    .where(where)
    .orderBy(desc(pedidosOrdenes.createdAt))
    .limit(limite);
  return rows.map((r) => ({ ...r.pedido, contactName: r.contactName }));
}

const recientes = () => sql`${pedidosOrdenes.createdAt} > now() - interval '60 days'`;

function lista(titulo: string, filas: Fila[], linea: (p: Fila) => string, vacio: string, pie?: string): string {
  if (!filas.length) return vacio;
  const cuerpo = filas.slice(0, MAX_FILAS).map((p) => `• ${linea(p)}`);
  const mas = filas.length > MAX_FILAS ? [`… y ${filas.length - MAX_FILAS} más (míralos en el CRM).`] : [];
  return [titulo, ...cuerpo, ...mas, pie].filter(Boolean).join("\n");
}

export async function responderConsultaGeneral(consulta: TipoConsulta, periodo: Periodo = "hoy"): Promise<string> {
  if (consulta === "resumen") return resumen(periodo);

  if (consulta === "deben") {
    const filas = (await pedidos(and(eq(pedidosOrdenes.estado, "enviado"), recientes())))
      .map((p) => ({ p, c: cuentasDelPedido(p) }))
      .filter(({ c }) => !c.saldoCubierto && c.saldoPendiente > 0);
    const total = filas.reduce((s, { c }) => s + (c.saldoPendiente - (c.saldoCobrado ?? 0)), 0);
    return lista(
      `💰 *Te deben ${filas.length} pedido(s) enviados · ${soles(total)} por cobrar*`,
      filas.map(({ p }) => p),
      (p) => {
        const c = cuentasDelPedido(p);
        return `${p.numeroOrden} · ${nombre(p)} · debe ${soles(c.saldoPendiente - (c.saldoCobrado ?? 0))}${p.numeroGuia ? ` · guía ${p.numeroGuia}` : ""} · enviado hace ${dias(p.updatedAt)}`;
      },
      "✅ Nadie te debe: no hay pedidos enviados con saldo pendiente.",
      "Para registrar un pago: «pagó 1140 179»."
    );
  }

  if (consulta === "adelantos") {
    const filas = (
      await pedidos(and(inArray(pedidosOrdenes.estado, ["por_confirmar_cod", "confirmado", "preparando"]), recientes()))
    ).filter(
      (p) => (p.modalidadPago === "adelanto_agencia" || /shalom/i.test(p.transportadora || "")) && !adelantoRegistrado(p.notas)
    );
    return lista(
      `💵 *${filas.length} adelanto(s) de provincia sin verificar*`,
      filas,
      (p) => `${p.numeroOrden} · ${nombre(p)} · ${p.ciudad || "sin ciudad"} · ${soles(Number(p.total) || 0)} · hace ${dias(p.createdAt)}`,
      "✅ No hay adelantos pendientes de verificar.",
      "Si ya te llegó el Yape: «adelanto 1153»."
    );
  }

  if (consulta === "por_enviar") {
    const filas = (await pedidos(and(inArray(pedidosOrdenes.estado, ["confirmado", "preparando"]), recientes()))).filter(
      (p) => !p.numeroGuia
    );
    return lista(
      `📦 *${filas.length} pedido(s) confirmados sin guía (por enviar)*`,
      filas,
      (p) => `${p.numeroOrden} · ${nombre(p)} · ${[p.distrito, p.ciudad].filter(Boolean).join(" / ") || "sin destino"} · ${p.estado}`,
      "✅ No hay pedidos confirmados pendientes de envío.",
      "Para registrar la guía: «guia 1140 104169999 AB12»."
    );
  }

  if (consulta === "en_camino") {
    const filas = await pedidos(and(eq(pedidosOrdenes.estado, "enviado"), recientes()));
    return lista(
      `🚚 *${filas.length} pedido(s) en camino o en agencia*`,
      filas,
      (p) => `${p.numeroOrden} · ${nombre(p)} · ${p.numeroGuia ? `guía ${p.numeroGuia}` : "sin guía"} · ${p.direccionEnvio || p.ciudad || "-"} · hace ${dias(p.updatedAt)}`,
      "No hay pedidos en camino.",
      "Para ver uno completo: «estado 1140»."
    );
  }

  // por_confirmar
  const filas = await pedidos(and(eq(pedidosOrdenes.estado, "por_confirmar_cod"), recientes()));
  return lista(
    `⏳ *${filas.length} pedido(s) por confirmar*`,
    filas,
    (p) => `${p.numeroOrden} · ${nombre(p)} · ${soles(Number(p.total) || 0)} · ${p.ciudad || "sin ciudad"} · hace ${dias(p.createdAt)}`,
    "✅ No hay pedidos por confirmar.",
    "Para confirmarlo: «pasa 1140 a confirmado»."
  );
}

async function resumen(periodo: Periodo): Promise<string> {
  const { desde, hasta, etiqueta } = rangoPeriodo(periodo);
  const delPeriodo = await pedidos(
    and(gte(pedidosOrdenes.createdAt, desde), lt(pedidosOrdenes.createdAt, hasta)),
    1000
  );
  const validos = delPeriodo.filter((p) => p.estado !== "cancelado");
  const cancelados = delPeriodo.length - validos.length;
  const monto = validos.reduce((s, p) => s + (Number(p.total) || 0), 0);
  const porOrigen = { chat: 0, web: 0, otro: 0 };
  for (const p of validos) porOrigen[origenPedido(p.numeroOrden)]++;

  // Cómo está la operación ahora (no solo lo del periodo).
  const abiertos = await pedidos(and(ne(pedidosOrdenes.estado, "cancelado"), ne(pedidosOrdenes.estado, "entregado"), recientes()), 1000);
  const cuenta = (e: string) => abiertos.filter((p) => p.estado === e).length;
  const adelantos = abiertos.filter(
    (p) =>
      ["por_confirmar_cod", "confirmado", "preparando"].includes(p.estado) &&
      (p.modalidadPago === "adelanto_agencia" || /shalom/i.test(p.transportadora || "")) &&
      !adelantoRegistrado(p.notas)
  ).length;
  const porEnviar = abiertos.filter((p) => ["confirmado", "preparando"].includes(p.estado) && !p.numeroGuia).length;
  const deben = abiertos
    .filter((p) => p.estado === "enviado")
    .map((p) => cuentasDelPedido(p))
    .filter((c) => !c.saldoCubierto && c.saldoPendiente > 0);
  const porCobrar = deben.reduce((s, c) => s + (c.saldoPendiente - (c.saldoCobrado ?? 0)), 0);

  return [
    `📊 *Resumen de ${etiqueta}*`,
    `Pedidos: *${validos.length}* por ${soles(monto)} (chat ${porOrigen.chat} · web ${porOrigen.web}${porOrigen.otro ? ` · otros ${porOrigen.otro}` : ""})${cancelados ? ` · ${cancelados} cancelado(s)` : ""}`,
    "",
    "*Ahora mismo*",
    `⏳ Por confirmar: ${cuenta("por_confirmar_cod")}`,
    `💵 Adelantos sin verificar: ${adelantos}`,
    `📦 Por enviar (sin guía): ${porEnviar}`,
    `🚚 En camino: ${cuenta("enviado")} · te deben ${deben.length} (${soles(porCobrar)})`,
    "",
    "Detalle: «quién me debe», «adelantos pendientes», «por enviar», «en camino», «pedidos por confirmar».",
  ].join("\n");
}
