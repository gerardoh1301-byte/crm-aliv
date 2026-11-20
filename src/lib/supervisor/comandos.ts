import "server-only";
import { db } from "@/db";
import { activities, contacts, conversations, crmSettings, messages } from "@/db/schema";
import { and, desc, eq, gt, ilike, ne, or, sql, type SQL } from "drizzle-orm";
import { pedidosOrdenes } from "@modules/pedidos/tabla";
import { deliverMessage } from "@/lib/channels/deliver";
import { SUPERVISOR_PAGOS, normalizarTelefono } from "@/lib/alerts/supervisor-alerts";
import { extraerFinanzasShalom } from "@/lib/finanzas/tags-shalom";
import { registrarFinanzasShalom } from "@/lib/finanzas/registrar-shalom";
import { notificarCambioDealAlErp } from "@/lib/finanzas/notificar-erp";
import {
  digitosPedido,
  interpretarComando,
  separarPedidoYMonto,
  type Comando,
  type TokenNumero,
} from "./parser";

/**
 * Órdenes por WhatsApp del supervisor de pagos (solo el 951365418).
 *
 * Nada que cambie datos se aplica sin una confirmación explícita con el número del
 * pedido ("SI 1140" / "ENVIAR 1140"). La pendiente vive 15 minutos en crm_settings.
 * La clave de retiro solo se muestra si el saldo ya está registrado como pagado, y solo
 * llega al cliente con "ENVIAR <pedido>".
 */

const AUTOR = "Gerardo (WhatsApp)";
const CLAVE_PENDIENTE = "supervisor_whatsapp_pendiente";
const VIGENCIA_PENDIENTE_MS = 15 * 60_000;
const TOLERANCIA_SOLES = 0.5;
const ADELANTO_SHALOM_POR_DEFECTO = 20;

export function esSupervisorPagos(phone: string | null | undefined): boolean {
  const d = normalizarTelefono(phone);
  return d === SUPERVISOR_PAGOS || d === `51${SUPERVISOR_PAGOS}`;
}

type Accion = "pago" | "flete" | "entregado" | "enviar_clave" | "guia";

interface Pendiente {
  accion: Accion;
  pedidoId: string;
  numeroOrden: string;
  monto: number | null;
  guia?: string;
  codigo?: string;
  destino?: string;
  creado: number;
}

type Pedido = typeof pedidosOrdenes.$inferSelect & { contactName: string | null };

// ---------------------------------------------------------------------------
// Cuentas del pedido

export interface CuentasPedido {
  total: number;
  adelanto: number;
  saldoPendiente: number;
  saldoCobrado: number | null;
  saldoCubierto: boolean;
  fleteRegistrado: number | null;
}

export function cuentasDelPedido(p: {
  total: string | number | null;
  notas: string | null;
  modalidadPago: string | null;
  transportadora: string | null;
}): CuentasPedido {
  const total = Number(p.total) || 0;
  const fin = extraerFinanzasShalom(p.notas);
  const esShalom =
    p.modalidadPago === "adelanto_agencia" || /shalom/i.test(p.transportadora || "");
  const adelanto = fin?.adelantoMonto ?? (esShalom ? ADELANTO_SHALOM_POR_DEFECTO : 0);
  const saldoPendiente = Math.max(0, Math.round((total - adelanto) * 100) / 100);
  const saldoCobrado = fin?.saldoMonto ?? null;
  return {
    total,
    adelanto,
    saldoPendiente,
    saldoCobrado,
    saldoCubierto: saldoCobrado !== null && saldoCobrado >= saldoPendiente - TOLERANCIA_SOLES,
    fleteRegistrado: fin?.fleteShalom ?? null,
  };
}

const soles = (n: number) => `S/ ${n.toFixed(2)}`;

// ---------------------------------------------------------------------------
// Pendiente de confirmación

async function leerPendiente(): Promise<Pendiente | null> {
  const [row] = await db.select().from(crmSettings).where(eq(crmSettings.key, CLAVE_PENDIENTE)).limit(1);
  if (!row) return null;
  try {
    const p = JSON.parse(row.value) as Pendiente;
    if (!p?.accion || Date.now() - p.creado > VIGENCIA_PENDIENTE_MS) return null;
    return p;
  } catch {
    return null;
  }
}

async function guardarPendiente(p: Omit<Pendiente, "creado"> | null): Promise<void> {
  if (!p) {
    await db.delete(crmSettings).where(eq(crmSettings.key, CLAVE_PENDIENTE));
    return;
  }
  const value = JSON.stringify({ ...p, creado: Date.now() });
  await db
    .insert(crmSettings)
    .values({ key: CLAVE_PENDIENTE, value })
    .onConflictDoUpdate({ target: crmSettings.key, set: { value } });
}

// ---------------------------------------------------------------------------
// Búsqueda del pedido

function condicionToken(texto: string): SQL | undefined {
  const t = texto.toUpperCase();
  if (/^[A-Z]+-\d+$/.test(t)) return ilike(pedidosOrdenes.numeroOrden, `%${t}`);
  return or(
    eq(pedidosOrdenes.numeroOrden, `#${t}`),
    eq(pedidosOrdenes.numeroOrden, t),
    eq(pedidosOrdenes.numeroOrden, `#ALIV-${t}`),
    ilike(pedidosOrdenes.numeroOrden, `%-${t}`)
  );
}

const columnasPedido = {
  pedido: pedidosOrdenes,
  contactName: contacts.name,
};

async function pedidoPorToken(texto: string): Promise<Pedido | null> {
  const cond = condicionToken(texto);
  if (!cond) return null;
  const [row] = await db
    .select(columnasPedido)
    .from(pedidosOrdenes)
    .leftJoin(contacts, eq(contacts.id, pedidosOrdenes.contactId))
    .where(cond)
    .orderBy(desc(pedidosOrdenes.createdAt))
    .limit(1);
  return row ? { ...row.pedido, contactName: row.contactName } : null;
}

async function pedidoPorId(id: string): Promise<Pedido | null> {
  const [row] = await db
    .select(columnasPedido)
    .from(pedidosOrdenes)
    .leftJoin(contacts, eq(contacts.id, pedidosOrdenes.contactId))
    .where(eq(pedidosOrdenes.id, id))
    .limit(1);
  return row ? { ...row.pedido, contactName: row.contactName } : null;
}

async function pedidosPorNombre(nombre: string): Promise<Pedido[]> {
  const palabras = nombre.split(/\s+/).filter((p) => p.length >= 3).slice(0, 3);
  if (!palabras.length) return [];
  const rows = await db
    .select(columnasPedido)
    .from(pedidosOrdenes)
    .innerJoin(contacts, eq(contacts.id, pedidosOrdenes.contactId))
    .where(
      and(
        ...palabras.map((p) => sql`translate(lower(${contacts.name}), 'áéíóúü', 'aeiouu') like ${"%" + p + "%"}`),
        ne(pedidosOrdenes.estado, "cancelado"),
        gt(pedidosOrdenes.createdAt, sql`now() - interval '60 days'`)
      )
    )
    .orderBy(desc(pedidosOrdenes.createdAt))
    .limit(6);
  const pedidos = rows.map((r) => ({ ...r.pedido, contactName: r.contactName }));
  // Si alguno sigue en curso, los ya entregados no compiten.
  const enCurso = pedidos.filter((p) => p.estado !== "entregado");
  return enCurso.length ? enCurso : pedidos;
}

/** Último aviso de pedido enviado a este chat: permite escribir "pagó 179" sin número. */
async function ultimaAlerta(conversationId: string): Promise<{ token: string; flete: number | null } | null> {
  const rows = await db
    .select({ body: messages.body })
    .from(messages)
    .where(and(eq(messages.conversationId, conversationId), eq(messages.direction, "out")))
    .orderBy(desc(messages.createdAt))
    .limit(30);
  for (const r of rows) {
    const body = r.body || "";
    if (!/ALERTA/i.test(body)) continue;
    const m = body.match(/#+((?:LEG-|CHAT-|ALIV-)?\d{3,})/i);
    if (!m) continue;
    const f = body.match(/flete\s+S\/\s*([\d.]+)/i);
    return { token: m[1].toUpperCase(), flete: f ? Number(f[1]) : null };
  }
  return null;
}

type Resolucion =
  | { ok: true; pedido: Pedido; monto: number | null; fleteAlerta: number | null }
  | { ok: false; texto: string };

async function resolverPedido(cmd: Comando, conversationId: string): Promise<Resolucion> {
  // Tokens enteros de 3+ cifras que podrían ser pedidos: se consultan antes de decidir.
  const candidatos = cmd.numeros.filter((t) => !t.esMonto && (t.esPedido || t.texto.length >= 3));
  const existentes = new Map<TokenNumero, Pedido>();
  for (const t of candidatos) {
    const p = await pedidoPorToken(t.texto);
    if (p) existentes.set(t, p);
  }
  const { pedido: tokenPedido, monto } = separarPedidoYMonto(cmd.numeros, (t) => existentes.has(t));

  if (tokenPedido) {
    const p = existentes.get(tokenPedido) ?? (await pedidoPorToken(tokenPedido.texto));
    if (!p) return { ok: false, texto: `No encuentro el pedido ${tokenPedido.texto}. Revisa el número.` };
    const alerta = await ultimaAlerta(conversationId);
    const fleteAlerta = alerta && digitosPedido(alerta.token) === digitosPedido(p.numeroOrden) ? alerta.flete : null;
    return { ok: true, pedido: p, monto, fleteAlerta };
  }

  if (cmd.nombre) {
    const lista = await pedidosPorNombre(cmd.nombre);
    if (lista.length === 1) return { ok: true, pedido: lista[0], monto, fleteAlerta: null };
    if (lista.length > 1) {
      const opciones = lista
        .slice(0, 5)
        .map((p) => `• ${p.numeroOrden} · ${p.contactName ?? "-"} · ${soles(Number(p.total) || 0)} · ${p.estado}`)
        .join("\n");
      return { ok: false, texto: `Hay varios pedidos para «${cmd.nombre}». Repite la orden con el número:\n${opciones}` };
    }
  }

  const alerta = await ultimaAlerta(conversationId);
  if (alerta) {
    const p = await pedidoPorToken(alerta.token);
    if (p) return { ok: true, pedido: p, monto, fleteAlerta: alerta.flete };
  }
  return {
    ok: false,
    texto: cmd.nombre
      ? `No encuentro pedidos de «${cmd.nombre}». Usa el número, por ejemplo: «pagó 1140 179».`
      : "¿De qué pedido? Escribe el número, por ejemplo: «pagó 1140 179». Escribe «ayuda» para ver las órdenes.",
  };
}

// ---------------------------------------------------------------------------
// Respuestas

function encabezado(p: Pedido): string {
  const nombre = (p.contactName || "Cliente").trim();
  return `${p.numeroOrden} · ${nombre}`;
}

function datosRastreo(p: Pedido): string {
  if (!p.numeroGuia) return "sin N° de orden Shalom todavía";
  return `orden ${p.numeroGuia}${p.codigoRastreo ? ` · código ${p.codigoRastreo}` : " · sin código"}`;
}

const AYUDA = [
  "🤖 *Órdenes por WhatsApp (solo este número)*",
  "• *pagó 1140 179* → registra el pago del saldo (también «Jaime pagó 179» o «pago completo 1140»)",
  "• *flete 1140 10* → flete pagado en Págalo",
  "• *clave 1140* → te muestro la clave de retiro (solo si el saldo está pagado)",
  "• *entregado 1140* → marca el pedido como entregado",
  "• *estado 1140* → resumen del pedido",
  "• *guia 1066 104169999 AB12* → registra la guía nueva (por ejemplo tras un cambio de destino)",
  "Antes de cambiar algo te pido confirmar con *SI 1140*. Para mandar la clave al cliente: *ENVIAR 1140*. *NO* cancela.",
  "Si no pones número, uso el pedido de la última alerta.",
].join("\n");

function textoClaveCliente(p: Pedido, c: CuentasPedido): string {
  const destino = [p.direccionEnvio, p.ciudad].filter(Boolean).join(", ") || "tu agencia Shalom";
  return [
    `¡Pago del saldo de ${soles(c.saldoCobrado ?? c.saldoPendiente)} confirmado! 🙌`,
    "",
    `🔑 Tu clave de retiro en Shalom es: *${p.claveRecojo}*`,
    p.numeroGuia ? `📦 N° de orden: ${p.numeroGuia}${p.codigoRastreo ? ` · Código: ${p.codigoRastreo}` : ""}` : null,
    `📍 Destino: ${destino}`,
    "",
    "Acércate con tu DNI físico para el retiro. ¡Gracias por confiar en Aliv! 💚",
  ]
    .filter((l) => l !== null)
    .join("\n");
}

function mensajeClaveParaSupervisor(p: Pedido, c: CuentasPedido): string {
  const nombre = (p.contactName || "el cliente").split(" ")[0];
  return [
    `🔑 Clave de retiro ${encabezado(p)}: *${p.claveRecojo}*`,
    `📦 ${datosRastreo(p)} · saldo cobrado ${soles(c.saldoCobrado ?? 0)}`,
    `¿Se la envío a ${nombre} por WhatsApp? Responde *ENVIAR ${digitosPedido(p.numeroOrden)}* (o *NO*).`,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Ejecución

async function responder(conversationId: string, texto: string): Promise<void> {
  // "human": son respuestas del sistema a una orden del supervisor, no texto de la IA.
  // Con "agent" el blindaje anti-filtración taparía la clave que Gerardo pidió ver.
  const res = await deliverMessage(conversationId, { text: texto }, "human");
  if (!res.ok) console.warn("[supervisor-comandos] no se pudo responder:", res.error);
}

async function nota(p: Pedido, descripcion: string): Promise<void> {
  if (!p.contactId) return;
  await db.insert(activities).values({ type: "note", description: descripcion, contactId: p.contactId, dealId: p.dealId });
}

async function proponer(
  cmd: Comando,
  conversationId: string
): Promise<string> {
  const r = await resolverPedido(cmd, conversationId);
  if (!r.ok) return r.texto;
  const p = r.pedido;
  const c = cuentasDelPedido(p);
  const n = digitosPedido(p.numeroOrden);

  if (cmd.tipo === "estado") {
    return [
      `📋 *${encabezado(p)}*`,
      `Estado: ${p.estado} · total ${soles(c.total)} · adelanto ${soles(c.adelanto)}`,
      c.saldoCobrado !== null
        ? `Saldo cobrado: ${soles(c.saldoCobrado)}${c.saldoCubierto ? " ✅" : ` (faltan ${soles(c.saldoPendiente - c.saldoCobrado)})`}`
        : `Saldo pendiente: ${soles(c.saldoPendiente)}`,
      `Shalom: ${datosRastreo(p)}`,
      `Flete registrado: ${c.fleteRegistrado !== null ? soles(c.fleteRegistrado) : "no"} · clave en CRM: ${p.claveRecojo ? "sí" : "no"}`,
    ].join("\n");
  }

  if (cmd.tipo === "clave") {
    if (!p.claveRecojo) return `${encabezado(p)} todavía no tiene la clave de retiro registrada en el CRM.`;
    if (!c.saldoCubierto) {
      return `🔒 ${encabezado(p)}: el saldo de ${soles(c.saldoPendiente)} aún no está registrado como pagado. Primero confirma el pago: «pagó ${n} ${c.saldoPendiente}».`;
    }
    await guardarPendiente({ accion: "enviar_clave", pedidoId: p.id, numeroOrden: p.numeroOrden, monto: null });
    return mensajeClaveParaSupervisor(p, c);
  }

  if (cmd.tipo === "pago") {
    const monto = r.monto ?? (cmd.completo ? c.saldoPendiente : null);
    if (monto === null) {
      return `¿Cuánto pagó? Por ejemplo: «pagó ${n} ${c.saldoPendiente}» (saldo pendiente de ${encabezado(p)}: ${soles(c.saldoPendiente)}).`;
    }
    if (monto <= 0 || monto > 2000) return `El monto ${soles(monto)} no parece correcto. Revisa y vuelve a escribirlo.`;
    const diferencia = Math.round((monto - c.saldoPendiente) * 100) / 100;
    const aviso =
      diferencia < -TOLERANCIA_SOLES
        ? `⚠️ No cubre el saldo: faltan ${soles(-diferencia)}. Quedará como pago parcial y la clave NO se habilita.`
        : diferencia > TOLERANCIA_SOLES
          ? `⚠️ Es ${soles(diferencia)} más que el saldo pendiente.`
          : "✔️ Cubre el saldo completo.";
    await guardarPendiente({ accion: "pago", pedidoId: p.id, numeroOrden: p.numeroOrden, monto });
    return [
      `💰 *${encabezado(p)}*`,
      `Total ${soles(c.total)} · adelanto ${soles(c.adelanto)} · saldo pendiente ${soles(c.saldoPendiente)}`,
      `Pago a registrar: *${soles(monto)}*${c.saldoCobrado !== null ? ` (reemplaza el registrado antes: ${soles(c.saldoCobrado)})` : ""}`,
      aviso,
      `Se registra en el pedido, el pipeline y el ERP. Responde *SI ${n}* para confirmar o *NO*.`,
    ].join("\n");
  }

  if (cmd.tipo === "flete") {
    const monto = r.monto ?? r.fleteAlerta;
    if (monto === null) return `¿Cuánto fue el flete? Por ejemplo: «flete ${n} 10».`;
    if (monto <= 0 || monto > 100) return `El flete ${soles(monto)} no parece correcto (máx. S/ 100).`;
    await guardarPendiente({ accion: "flete", pedidoId: p.id, numeroOrden: p.numeroOrden, monto });
    return [
      `🚚 *${encabezado(p)}* · ${datosRastreo(p)}`,
      `Flete pagado en Págalo a registrar: *${soles(monto)}* (cuenta BCP)${c.fleteRegistrado !== null ? ` · reemplaza ${soles(c.fleteRegistrado)}` : ""}`,
      `Responde *SI ${n}* para confirmar o *NO*.`,
    ].join("\n");
  }

  if (cmd.tipo === "guia") {
    if (!cmd.guia || !cmd.codigo) {
      return `Escribe el número de orden Shalom y el código, por ejemplo: «guia ${n} 104169999 AB12».`;
    }
    const { consultarEstadoShalom } = await import("@/lib/agencias/shalom-rastreo");
    const rastro = await consultarEstadoShalom(cmd.guia, cmd.codigo);
    if (!rastro.ok) {
      return `⚠️ Shalom no reconoce la orden ${cmd.guia} con el código ${cmd.codigo}${rastro.mensaje ? ` (${rastro.mensaje})` : ""}. Revisa los datos; no se cambió nada.`;
    }
    const destino = rastro.agenciaDestino || "-";
    await guardarPendiente({
      accion: "guia",
      pedidoId: p.id,
      numeroOrden: p.numeroOrden,
      monto: null,
      guia: cmd.guia,
      codigo: cmd.codigo,
      destino,
    });
    return [
      `📦 *${encabezado(p)}* (estado: ${p.estado})`,
      `Guía actual: ${datosRastreo(p)}`,
      `Guía nueva: orden ${cmd.guia} · código ${cmd.codigo} · destino Shalom: *${destino}*${rastro.ciudadDestino ? ` (${rastro.ciudadDestino})` : ""}`,
      p.estado === "entregado" ? "El pedido vuelve a *En camino* (no estaba entregado de verdad)." : null,
      `Responde *SI ${n}* para registrarla o *NO*.`,
    ]
      .filter(Boolean)
      .join("\n");
  }

  if (cmd.tipo === "entregado") {
    if (p.estado === "entregado") return `${encabezado(p)} ya figura como entregado.`;
    await guardarPendiente({ accion: "entregado", pedidoId: p.id, numeroOrden: p.numeroOrden, monto: null });
    return [
      `📦 *${encabezado(p)}* (estado actual: ${p.estado})`,
      c.saldoCobrado === null && c.saldoPendiente > 0
        ? `⚠️ No hay pago del saldo registrado (${soles(c.saldoPendiente)}).`
        : null,
      `Pasa a *Entregado* en el pipeline y arranca la posventa. Responde *SI ${n}* para confirmar o *NO*.`,
    ]
      .filter(Boolean)
      .join("\n");
  }

  return AYUDA;
}

async function ejecutarPendiente(cmd: Comando, conversationId: string): Promise<string> {
  const pend = await leerPendiente();
  const n = cmd.numeros.find((t) => !t.esMonto);
  if (!pend) return "No hay nada pendiente de confirmar (las confirmaciones vencen a los 15 minutos).";
  if (!n || digitosPedido(n.texto) !== digitosPedido(pend.numeroOrden)) {
    return `Lo pendiente es del pedido ${pend.numeroOrden}. Responde con ese número o *NO* para cancelar.`;
  }
  const esEnvio = cmd.tipo === "enviar_clave";
  if (esEnvio !== (pend.accion === "enviar_clave")) {
    return pend.accion === "enviar_clave"
      ? `Para mandar la clave al cliente responde *ENVIAR ${digitosPedido(pend.numeroOrden)}*.`
      : `Para confirmar responde *SI ${digitosPedido(pend.numeroOrden)}*.`;
  }

  const p = await pedidoPorId(pend.pedidoId);
  if (!p) {
    await guardarPendiente(null);
    return "Ese pedido ya no existe.";
  }
  await guardarPendiente(null);

  if (pend.accion === "pago" && pend.monto !== null) {
    const res = await registrarFinanzasShalom(
      { pedidoId: p.id, dealId: p.dealId, numeroOrden: p.numeroOrden, saldoMonto: pend.monto, saldoCuenta: "BCP" },
      AUTOR
    );
    if (!res.ok) return `❌ No se pudo registrar: ${res.error}`;
    if (p.dealId) notificarCambioDealAlErp(p.dealId).catch(() => {});
    const actualizado = (await pedidoPorId(p.id)) ?? p;
    const c = cuentasDelPedido(actualizado);
    const base = `✅ Pago de ${soles(pend.monto)} registrado en ${encabezado(p)} (pedido, pipeline y ERP).`;
    if (!c.saldoCubierto) return `${base}\nAún faltan ${soles(c.saldoPendiente - (c.saldoCobrado ?? 0))}: la clave sigue bloqueada.`;
    if (!actualizado.claveRecojo) return `${base}\nEl pedido no tiene clave de retiro registrada en el CRM.`;
    await guardarPendiente({ accion: "enviar_clave", pedidoId: p.id, numeroOrden: p.numeroOrden, monto: null });
    return `${base}\n\n${mensajeClaveParaSupervisor(actualizado, c)}`;
  }

  if (pend.accion === "flete" && pend.monto !== null) {
    const res = await registrarFinanzasShalom(
      { pedidoId: p.id, dealId: p.dealId, numeroOrden: p.numeroOrden, fleteShalom: pend.monto, fleteCuenta: "BCP" },
      AUTOR
    );
    if (!res.ok) return `❌ No se pudo registrar: ${res.error}`;
    return `✅ Flete de ${soles(pend.monto)} registrado en ${encabezado(p)} y enviado al ERP.`;
  }

  if (pend.accion === "guia" && pend.guia && pend.codigo) {
    // Las marcas de aviso eran de la guía vieja: se quitan para que la nueva tenga sus avisos.
    const notasLimpias = (p.notas || "")
      .split("\n")
      .filter((l) => !/\[(AVISO_LLEGADA_ENVIADO|ENVIO_CONFIRMADO_AVISADO)/i.test(l))
      .join("\n");
    const marca = `[GUIA_NUEVA:${pend.guia}/${pend.codigo} antes=${p.numeroGuia || "-"}/${p.codigoRastreo || "-"}]`;
    const volvioAEnCamino = p.estado === "entregado";
    await db
      .update(pedidosOrdenes)
      .set({
        numeroGuia: pend.guia,
        codigoRastreo: pend.codigo,
        ...(pend.destino && pend.destino !== "-" ? { direccionEnvio: `Agencia Shalom ${pend.destino}` } : {}),
        ...(volvioAEnCamino ? { estado: "enviado" as const } : {}),
        notas: notasLimpias ? `${notasLimpias}\n${marca}` : marca,
        updatedAt: new Date(),
      })
      .where(eq(pedidosOrdenes.id, p.id));
    if (volvioAEnCamino && p.contactId) {
      const { sincronizarEtapaPipeline } = await import("@modules/pedidos/servidor");
      const producto = p.items?.[0]?.titulo ?? "Pedido Aliv";
      await sincronizarEtapaPipeline(p.contactId, "enviado", `${p.numeroOrden} · ${producto}`, Number(p.total) || 0, p.id, p.dealId);
    }
    await nota(
      p,
      `[GUIA NUEVA] ${AUTOR} registró la guía ${pend.guia} (código ${pend.codigo}) hacia Shalom ${pend.destino || "-"}; antes ${p.numeroGuia || "-"}.`
    );
    if (p.dealId) notificarCambioDealAlErp(p.dealId).catch(() => {});
    return [
      `✅ Guía nueva registrada en ${encabezado(p)}: orden ${pend.guia} · código ${pend.codigo} → ${pend.destino || "-"}.`,
      volvioAEnCamino ? "El pedido volvió a *En camino* en el pipeline." : null,
      "El CRM seguirá esta guía y le avisará al cliente cuando llegue.",
    ]
      .filter(Boolean)
      .join("\n");
  }

  if (pend.accion === "entregado") {
    const { sincronizarEtapaPipeline } = await import("@modules/pedidos/servidor");
    const { crearOActualizarDealPostventa } = await import("@/lib/postventa/engine");
    await db
      .update(pedidosOrdenes)
      .set({ estado: "entregado", updatedAt: new Date() })
      .where(eq(pedidosOrdenes.id, p.id));
    const producto = p.items?.[0]?.titulo ?? "Pedido Aliv";
    if (p.contactId) {
      await sincronizarEtapaPipeline(p.contactId, "entregado", `${p.numeroOrden} · ${producto}`, Number(p.total) || 0, p.id, p.dealId);
      await crearOActualizarDealPostventa(p.contactId, p.numeroOrden, Number(p.total) || 0).catch((err) =>
        console.warn("[supervisor-comandos] posventa:", err)
      );
    }
    await nota(p, `Pedido ${p.numeroOrden} marcado como Entregado por ${AUTOR}.`);
    if (p.dealId) notificarCambioDealAlErp(p.dealId).catch(() => {});
    return `✅ ${encabezado(p)} quedó como *Entregado* en el pipeline y el ERP; la posventa arranca sola.`;
  }

  if (pend.accion === "enviar_clave") {
    const c = cuentasDelPedido(p);
    if (!p.claveRecojo || !c.saldoCubierto) return `🔒 ${encabezado(p)}: la clave ya no está habilitada (revisa el pago).`;
    if (!p.contactId) return "El pedido no tiene contacto asociado.";
    const [conv] = await db
      .select({ id: conversations.id })
      .from(conversations)
      .where(eq(conversations.contactId, p.contactId))
      .orderBy(desc(conversations.lastMessageAt))
      .limit(1);
    const texto = textoClaveCliente(p, c);
    const nombre = (p.contactName || "el cliente").split(" ")[0];
    const res = conv ? await deliverMessage(conv.id, { text: texto }, "human") : { ok: false, error: "sin_chat" };
    if (!res.ok) {
      await nota(p, `[CLAVE NO ENVIADA] ${AUTOR} pidió enviar la clave pero WhatsApp no la entregó (${res.error}).`);
      return `⚠️ No pude enviársela a ${nombre} (${res.error === "sin_chat" ? "no tiene chat en el CRM" : "WhatsApp la rechazó; quizá pasaron más de 24 h desde su último mensaje"}). Reenvíale tú este texto:\n\n${texto}`;
    }
    await db
      .update(pedidosOrdenes)
      .set({ notas: `${p.notas ? `${p.notas}\n` : ""}[CLAVE_ENVIADA_WHATSAPP:${new Date().toISOString()}]`, updatedAt: new Date() })
      .where(eq(pedidosOrdenes.id, p.id));
    await nota(p, `[CLAVE ENVIADA] Clave de retiro enviada al cliente por orden de ${AUTOR}.`);
    return `✅ Clave enviada a ${nombre} por WhatsApp.`;
  }

  return "No reconozco lo pendiente; vuelve a escribir la orden.";
}

/**
 * Atiende el último mensaje del chat del supervisor si es una orden. Devuelve true si
 * lo atendió (el bot de ventas no responde); false si no era una orden (el mensaje
 * sigue al bot como chat de prueba).
 */
export async function manejarComandoSupervisor(conversationId: string, phone: string | null): Promise<boolean> {
  if (!esSupervisorPagos(phone)) return false;

  const [ultimo] = await db
    .select({ body: messages.body, direction: messages.direction })
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(desc(messages.createdAt))
    .limit(1);
  if (!ultimo || ultimo.direction !== "in") return false;

  const cmd = interpretarComando(ultimo.body);
  if (!cmd) {
    // Un "sí" / "ok" suelto con algo pendiente no va al bot de ventas (que podría
    // inventar que registró algo): se le recuerda cómo confirmar.
    const pend = await leerPendiente();
    if (pend && (ultimo.body || "").trim().length <= 40) {
      const n = digitosPedido(pend.numeroOrden);
      await responder(
        conversationId,
        pend.accion === "enviar_clave"
          ? `Para mandarle la clave al cliente responde *ENVIAR ${n}*, o *NO* para cancelar.`
          : `Para confirmar responde *SI ${n}* (con el número), o *NO* para cancelar.`
      );
      return true;
    }
    return false;
  }

  let texto: string;
  try {
    if (cmd.tipo === "ayuda") texto = AYUDA;
    else if (cmd.tipo === "cancelar") {
      const pend = await leerPendiente();
      if (!pend) return false; // un "no" suelto sin nada pendiente es conversación normal
      await guardarPendiente(null);
      texto = `Cancelado: no se aplicó nada en ${pend.numeroOrden}.`;
    } else if (cmd.tipo === "confirmar" || cmd.tipo === "enviar_clave") {
      texto = await ejecutarPendiente(cmd, conversationId);
    } else {
      texto = await proponer(cmd, conversationId);
    }
  } catch (err) {
    console.error("[supervisor-comandos] error:", err);
    texto = "❌ Hubo un error al procesar la orden. No se cambió nada; inténtalo de nuevo o hazlo desde el CRM.";
  }
  await responder(conversationId, texto);
  return true;
}

// Exportado para pruebas.
export const _internas = { AYUDA, textoClaveCliente };
