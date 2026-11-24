import "server-only";
import { db } from "@/db";
import { contacts, conversations, messages } from "@/db/schema";
import { desc, eq, ilike, or } from "drizzle-orm";
import { pedidoParaHerramienta } from "./comandos";

/**
 * Herramientas del asistente de Gerardo que hablan con las conexiones del CRM:
 * AliClik (MCP oficial), Shalom (rastreo en vivo y padrón de agencias), ERP de finanzas y
 * los chats por celular. Todas son de LECTURA, salvo la sincronización de AliClik, que es
 * el mismo proceso automático de siempre ejecutado a pedido.
 */

const ZONA = "America/Lima";

/** Fecha AAAA-MM-DD en Lima, desplazada en días. */
export function diaLima(desplazamiento = 0, base = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: ZONA }).format(new Date(base.getTime() + desplazamiento * 86_400_000));
}

/** Convierte «hoy / ayer / semana / mes» o un rango explícito en desde/hasta (AAAA-MM-DD). */
export function rangoFechas(args: { periodo?: string; desde?: string; hasta?: string }, base = new Date()): { desde: string; hasta: string } {
  const valida = (f?: string) => (f && /^\d{4}-\d{2}-\d{2}$/.test(f) ? f : null);
  const d = valida(args.desde);
  const h = valida(args.hasta);
  if (d || h) return { desde: d ?? h!, hasta: h ?? d! };
  switch ((args.periodo || "").toLowerCase()) {
    case "ayer":
      return { desde: diaLima(-1, base), hasta: diaLima(-1, base) };
    case "semana":
      return { desde: diaLima(-6, base), hasta: diaLima(0, base) };
    case "mes":
      return { desde: diaLima(-29, base), hasta: diaLima(0, base) };
    default:
      return { desde: diaLima(0, base), hasta: diaLima(0, base) };
  }
}

const recortar = (v: unknown, max = 6000) => {
  const t = typeof v === "string" ? v : JSON.stringify(v);
  return t.length > max ? `${t.slice(0, max)}… (recortado)` : t;
};

// ---------------------------------------------------------------------------
// AliClik

/** Una herramienta del MCP de AliClik es de lectura si su nombre lo dice. */
export function esHerramientaLecturaAliclik(nombre: string): boolean {
  return /^(search|get|list|summari[sz]e|query|count|find|track|report|stats)/i.test(nombre);
}

/** Textos con los que AliClik marca un estado (en código o etiqueta). */
export function coincideEstado(item: { deliveryStatus?: string | null; deliveryStatusLabel?: string | null; callStatus?: string | null; callStatusLabel?: string | null; trackingStatus?: string | null; trackingStatusLabel?: string | null }, estado: string): boolean {
  const e = estado.toLowerCase();
  const campos = [item.deliveryStatus, item.deliveryStatusLabel, item.trackingStatus, item.trackingStatusLabel, item.callStatus, item.callStatusLabel]
    .map((x) => String(x ?? "").toLowerCase())
    .join(" | ");
  if (e === "entregado") {
    // «no entregado», «undelivered» o «por entregar» no son entregas.
    const entrega = [item.deliveryStatus, item.deliveryStatusLabel].map((x) => String(x ?? "")).join(" | ");
    return /(entregad[oa]|delivered)/i.test(entrega) && !/(no\s+entregad|undeliver|not\s+deliver|por\s+entregar|rechaz|devuel)/i.test(entrega);
  }
  const sinonimos: Record<string, string[]> = {
    rechazado: ["reject", "rechaz", "no recib", "devuel", "return"],
    pendiente: ["pend", "program", "schedul", "ruta", "route", "transit"],
    cancelado: ["cancel", "anul"],
  };
  return (sinonimos[e] ?? [e]).some((s) => campos.includes(s));
}

export async function aliclikPedidos(args: {
  periodo?: string;
  desde?: string;
  hasta?: string;
  tipo?: string;
  estado?: string;
  celular?: string;
  distrito?: string;
}): Promise<string> {
  const { AliclikMcpClient } = await import("@/lib/aliclik/mcp-client");
  const cliente = new AliclikMcpClient();
  const { desde, hasta } = rangoFechas(args);
  const tipo = /agen|shalom/i.test(args.tipo || "") ? "AGENCY" : /cod|contra|cash/i.test(args.tipo || "") ? "CASH_ON_DELIVERY" : undefined;
  const items: Awaited<ReturnType<typeof cliente.searchOrders>>["items"] = [];
  let total = 0;
  for (let page = 1; page <= 4; page++) {
    const r = await cliente.searchOrders({
      from: desde,
      to: hasta,
      page,
      pageSize: 50,
      ...(tipo ? { deliveryType: tipo } : {}),
      ...(args.celular ? { phone: args.celular.replace(/\D/g, "").slice(-9) } : {}),
      ...(args.distrito ? { district: args.distrito } : {}),
    });
    if (typeof r === "string") return `AliClik respondió: ${recortar(r, 1500)}`;
    total = r.total ?? 0;
    items.push(...(r.items ?? []));
    if (!r.items?.length || items.length >= total) break;
  }
  const filtrados = args.estado ? items.filter((i) => coincideEstado(i, args.estado!)) : items;
  const cabecera = `AliClik · pedidos creados del ${desde} al ${hasta}${tipo ? ` · ${tipo === "AGENCY" ? "agencia" : "contra entrega"}` : ""}${args.estado ? ` · estado «${args.estado}»` : ""}: ${filtrados.length} de ${items.length} listados (total AliClik ${total}).`;
  if (!filtrados.length) return `${cabecera}\nOJO: la búsqueda filtra por FECHA DE CREACIÓN. Para entregas de un día usa aliclik_consulta con query_orders o amplía el rango.`;
  const lineas = filtrados.slice(0, 40).map((i) =>
    [
      i.orderNumber,
      i.createdAt?.slice(0, 10),
      i.customerName,
      i.customerPhone,
      i.district || "-",
      `S/ ${Number(i.total || 0).toFixed(2)}`,
      i.deliveryTypeLabel || i.deliveryType,
      `llamada: ${i.callStatusLabel || i.callStatus}`,
      `entrega: ${i.deliveryStatusLabel || i.deliveryStatus}`,
      i.trackingStatusLabel ? `seguimiento: ${i.trackingStatusLabel}` : null,
      i.agency ? `agencia: ${i.agency}` : null,
    ]
      .filter(Boolean)
      .join(" · ")
  );
  return [cabecera, ...lineas, filtrados.length > 40 ? `… y ${filtrados.length - 40} más` : null].filter(Boolean).join("\n");
}

export async function aliclikOrden(args: { orden?: string; pedido?: string }, conversationId: string): Promise<string> {
  let orden = (args.orden || "").trim().toUpperCase();
  let titulo = "";
  if (!orden && args.pedido) {
    const r = await pedidoParaHerramienta(args.pedido, conversationId);
    if (!r.ok) return r.texto;
    const { ordenAliclikRegistrada } = await import("@/lib/aliclik/registrar-orden");
    orden = ordenAliclikRegistrada(r.pedido.notas) || "";
    titulo = r.titulo;
    if (!orden) return `${titulo} no tiene orden de AliClik guardada en el CRM. Busca con aliclik_pedidos por su celular.`;
  }
  if (!orden) return "Falta la orden de AliClik (ERG…) o el pedido del CRM.";
  const { AliclikMcpClient } = await import("@/lib/aliclik/mcp-client");
  const d = await new AliclikMcpClient().getOrder(orden);
  return `${titulo ? `${titulo} → ` : ""}AliClik ${orden}:\n${recortar(d, 4000)}`;
}

let cacheHerramientasAliclik: { cuando: number; texto: string; nombres: Set<string> } | null = null;

/** Lista las herramientas de lectura del MCP de AliClik con sus parámetros (cacheada 1 h). */
export async function aliclikHerramientas(): Promise<{ texto: string; nombres: Set<string> }> {
  if (cacheHerramientasAliclik && Date.now() - cacheHerramientasAliclik.cuando < 3600_000) return cacheHerramientasAliclik;
  const { AliclikMcpClient } = await import("@/lib/aliclik/mcp-client");
  const tools = (await new AliclikMcpClient().listTools()).filter((t) => esHerramientaLecturaAliclik(t.name));
  const texto = tools
    .map((t) => `## ${t.name}\n${(t.description || "").slice(0, 700)}\nParámetros: ${recortar(t.inputSchema ?? {}, 1500)}`)
    .join("\n\n");
  cacheHerramientasAliclik = { cuando: Date.now(), texto: texto || "AliClik no publicó herramientas de lectura.", nombres: new Set(tools.map((t) => t.name)) };
  return cacheHerramientasAliclik;
}

/** Consulta libre de SOLO LECTURA al MCP de AliClik (search/get/summarize/query…). */
export async function aliclikConsulta(args: { herramienta?: string; argumentos?: unknown }): Promise<string> {
  const nombre = String(args.herramienta || "").trim();
  if (!nombre) return (await aliclikHerramientas()).texto;
  if (!esHerramientaLecturaAliclik(nombre)) return `«${nombre}» no es de solo lectura: el asistente no la ejecuta. Para registrar un pedido usa proponer_registro_aliclik.`;
  let argumentos: Record<string, unknown> = {};
  if (typeof args.argumentos === "string") {
    try {
      argumentos = JSON.parse(args.argumentos);
    } catch {
      return "Los argumentos deben ser un objeto JSON.";
    }
  } else if (args.argumentos && typeof args.argumentos === "object") argumentos = args.argumentos as Record<string, unknown>;
  const { AliclikMcpClient } = await import("@/lib/aliclik/mcp-client");
  const r = await new AliclikMcpClient().callAny(nombre, argumentos);
  return `AliClik ${nombre}:\n${recortar(r, 6000)}`;
}

export async function sincronizarAliclik(): Promise<string> {
  const { sincronizarEntregasAliclik } = await import("@/lib/aliclik/sync-entregas");
  const r = await sincronizarEntregasAliclik();
  const cambios = r.detalles.filter((d) => d.accion === "marcar_entregado" || d.accion === "solo_informar").slice(0, 15);
  const errores = r.detalles.filter((d) => d.accion === "error").slice(0, 5);
  return [
    `Sincronización AliClik ${r.activo ? "ACTIVA" : "en modo prueba (no cambió nada)"}: ${r.revisados} pedidos revisados, ${r.entregados} pasados a entregado.`,
    ...cambios.map((d) => `• ${d.numeroOrden} (${d.ordenAliclik ?? "sin orden"}): ${d.accion} — ${d.motivo}`),
    ...errores.map((d) => `• ERROR ${d.numeroOrden}: ${d.motivo}`),
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Shalom

export async function rastreoShalom(args: { pedido?: string; guia?: string; codigo?: string }, conversationId: string): Promise<string> {
  let guia = (args.guia || "").trim();
  let codigo = (args.codigo || "").trim();
  let titulo = "";
  if ((!guia || !codigo) && args.pedido) {
    const r = await pedidoParaHerramienta(args.pedido, conversationId);
    if (!r.ok) return r.texto;
    titulo = r.titulo;
    guia = guia || r.pedido.numeroGuia || "";
    codigo = codigo || r.pedido.codigoRastreo || "";
    if (!guia || !codigo) return `${titulo} no tiene ${!guia ? "N° de orden Shalom" : "código de rastreo"} en el CRM; no se puede rastrear.`;
  }
  const { consultarEstadoShalom } = await import("@/lib/agencias/shalom-rastreo");
  const r = await consultarEstadoShalom(guia, codigo);
  if (!r.ok) return `${titulo ? `${titulo}: ` : ""}Shalom no devolvió la guía ${guia} (${r.mensaje || r.estadoGeneral}).`;
  return [
    `${titulo ? `${titulo} · ` : ""}Shalom guía ${guia}: *${r.estadoGeneral}*${r.cambioDeDestino ? " (CAMBIO DE DESTINO, no es entrega real)" : ""}`,
    r.agenciaOrigen ? `Origen: ${r.agenciaOrigen}${r.confirmadoEnOrigen ? " (recibido en agencia)" : " (solo preguía)"}` : null,
    r.agenciaDestino ? `Destino: ${r.agenciaDestino}${r.ciudadDestino ? ` (${r.ciudadDestino})` : ""}` : null,
    r.fechaLlegadaDestino ? `Llegó a destino: ${r.fechaLlegadaDestino}` : null,
    r.enDestinoListoParaRecojo ? "Listo para recoger en agencia." : null,
    r.yaEntregado && !r.cambioDeDestino ? "Ya fue entregado." : null,
    r.montoFlete ? `Flete: ${r.montoFlete} (${r.tipoPago || "-"} · ${r.estadoPago || "-"})` : null,
    r.mensaje ? `Nota: ${r.mensaje}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

export async function agenciasShalom(args: { ciudad?: string; distrito?: string; direccion?: string }): Promise<string> {
  const { buscarAgenciaShalomCercana, textoAgenciaOficial } = await import("@/lib/agencias/shalom-directorio");
  const r = buscarAgenciaShalomCercana({ ciudad: args.ciudad, distrito: args.distrito, direccion: args.direccion });
  const lista = [r.mejorOpcion, ...r.otrasOpciones].filter((a): a is NonNullable<typeof a> => Boolean(a)).slice(0, 6);
  if (!lista.length) return "No encontré agencias Shalom para ese lugar en el padrón.";
  return [`Agencias Shalom${r.ciudadDetectada ? ` en ${r.ciudadDetectada}` : ""}:`, ...lista.map((a, i) => `${i === 0 ? "★" : "•"} ${textoAgenciaOficial(a)}`)].join("\n");
}

// ---------------------------------------------------------------------------
// ERP de finanzas (solo lectura)

type BaseErp = {
  lotes?: Record<string, { productoId?: string; cantidad?: number; costoUnit?: number }>;
  ajustes?: Record<string, { productoId?: string; delta?: number; cantidad?: number }>;
  pedidos?: Record<string, { productoId?: string; estado?: string; unidades?: number; anulado?: boolean; total?: number; monto?: number }>;
  movimientos?: Record<string, { tipo?: string; monto?: number; cuenta?: string; fecha?: string; concepto?: string; cat?: string }>;
  gastos?: Record<string, { monto?: number; fecha?: string; concepto?: string; cat?: string }>;
  publicidad?: Record<string, { monto?: number; fecha?: string }>;
};

async function leerBaseErp(): Promise<BaseErp | string> {
  const pin = process.env.ALIV_FINANZAS_PIN?.trim();
  if (!pin) return "El CRM no tiene acceso al ERP (falta ALIV_FINANZAS_PIN en Render).";
  const base = process.env.ALIV_ERP_URL || "https://aliv-finanzas-erp.onrender.com";
  const login = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pin }),
    signal: AbortSignal.timeout(15_000),
  });
  const token = login.ok ? ((await login.json().catch(() => ({}))) as { token?: string }).token : undefined;
  const r = await fetch(`${base}/api/load`, {
    headers: token ? { Authorization: `Bearer ${token}` } : { "x-aliv-pin": pin },
    signal: AbortSignal.timeout(20_000),
  });
  if (!r.ok) return `El ERP respondió ${r.status}; no pude leerlo.`;
  return (await r.json()) as BaseErp;
}

export async function resumenErp(args: { periodo?: string; desde?: string; hasta?: string }): Promise<string> {
  const erp = await leerBaseErp();
  if (typeof erp === "string") return erp;
  const { calcularStockNacDesdeErp } = await import("@/lib/finanzas/sync");
  const stock = calcularStockNacDesdeErp(erp);
  const { desde, hasta } = rangoFechas({ periodo: args.periodo || "mes", desde: args.desde, hasta: args.hasta });
  const movs = Object.values(erp.movimientos ?? {});
  const porCuenta: Record<string, { ingresos: number; egresos: number }> = {};
  for (const m of movs) {
    const c = m.cuenta || "sin cuenta";
    porCuenta[c] ??= { ingresos: 0, egresos: 0 };
    if (m.tipo === "egreso") porCuenta[c].egresos += Number(m.monto) || 0;
    else porCuenta[c].ingresos += Number(m.monto) || 0;
  }
  const enRango = (f?: string) => Boolean(f && f.slice(0, 10) >= desde && f.slice(0, 10) <= hasta);
  const movsRango = movs.filter((m) => enRango(m.fecha));
  const gastos = Object.values(erp.gastos ?? {}).filter((g) => enRango(g.fecha)).reduce((a, g) => a + (Number(g.monto) || 0), 0);
  const publicidad = Object.values(erp.publicidad ?? {}).filter((g) => enRango(g.fecha)).reduce((a, g) => a + (Number(g.monto) || 0), 0);
  const pedidos = Object.values(erp.pedidos ?? {}).filter((p) => !p.anulado);
  const porEstado: Record<string, number> = {};
  for (const p of pedidos) porEstado[p.estado || "?"] = (porEstado[p.estado || "?"] ?? 0) + 1;
  const s = (n: number) => `S/ ${n.toFixed(2)}`;
  return [
    `ERP (lectura en vivo) · periodo ${desde} a ${hasta}`,
    `Stock NAC600: ${stock.disponibleNac} disponibles (lotes ${stock.lotesNac}, entregados ${stock.entregadosNac}, en tránsito ${stock.transitoNac}).`,
    `Pedidos en el ERP por estado: ${Object.entries(porEstado).map(([k, v]) => `${k} ${v}`).join(", ") || "ninguno"}.`,
    `Movimientos por cuenta (histórico): ${Object.entries(porCuenta).map(([c, v]) => `${c}: +${s(v.ingresos)} / −${s(v.egresos)}`).join(" · ") || "sin movimientos"}.`,
    `En el periodo: ${movsRango.length} movimientos, gastos ${s(gastos)}, publicidad ${s(publicidad)}.`,
    ...movsRango
      .sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)))
      .slice(0, 8)
      .map((m) => `• ${m.fecha} ${m.tipo === "egreso" ? "−" : "+"}${s(Number(m.monto) || 0)} ${m.cuenta || ""} · ${(m.concepto || m.cat || "").slice(0, 90)}`),
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Chats por celular o nombre (clientes con o sin pedido)

export async function chatPorCliente(args: { cliente?: string; cantidad?: number }): Promise<string> {
  const ref = (args.cliente || "").trim();
  if (ref.length < 3) return "Falta el celular o el nombre del cliente.";
  const digitos = ref.replace(/\D/g, "");
  const filtro = digitos.length >= 6 ? ilike(contacts.phone, `%${digitos.slice(-9)}%`) : or(ilike(contacts.name, `%${ref.replace(/[%_]/g, "")}%`));
  const encontrados = await db
    .select({ id: contacts.id, nombre: contacts.name, celular: contacts.phone })
    .from(contacts)
    .where(filtro!)
    .limit(5);
  if (!encontrados.length) return `No hay contactos que coincidan con «${ref}».`;
  if (encontrados.length > 1 && digitos.length < 6) {
    return `Hay ${encontrados.length} contactos: ${encontrados.map((c) => `${c.nombre || "Cliente"} (${c.celular || "-"})`).join(", ")}. Pide el chat por celular.`;
  }
  const c = encontrados[0];
  const [conv] = await db
    .select({ id: conversations.id, bot: conversations.aiEnabled, pideHumano: conversations.needsHuman })
    .from(conversations)
    .where(eq(conversations.contactId, c.id))
    .orderBy(desc(conversations.lastMessageAt))
    .limit(1);
  if (!conv) return `${c.nombre || "Cliente"} (${c.celular}) no tiene chat en el CRM.`;
  const filas = await db
    .select({ body: messages.body, direction: messages.direction, createdAt: messages.createdAt })
    .from(messages)
    .where(eq(messages.conversationId, conv.id))
    .orderBy(desc(messages.createdAt))
    .limit(Math.min(Math.max(Number(args.cantidad) || 12, 1), 25));
  const lineas = filas
    .reverse()
    .filter((m) => (m.body || "").trim())
    .map((m) => {
      const hora = m.createdAt ? new Date(m.createdAt).toLocaleString("es-PE", { timeZone: ZONA, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "";
      return `[${hora}] ${m.direction === "in" ? "Cliente" : "Aliv"}: ${(m.body || "").replace(/\s+/g, " ").slice(0, 300)}`;
    });
  return [`Chat de ${c.nombre || "Cliente"} (${c.celular}) · bot ${conv.bot ? "activo" : "pausado"}${conv.pideHumano ? " · PIDE HUMANO" : ""}:`, ...lineas].join("\n");
}
