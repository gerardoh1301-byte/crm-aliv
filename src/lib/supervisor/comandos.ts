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
import { adelantoRegistrado, quienVerificoAdelanto } from "@/lib/pedidos/adelanto";
import {
  digitosPedido,
  interpretarComando,
  interpretarCorreccion,
  mejoresPorNombre,
  pareceOrdenNoEntendida,
  separarPedidoYMonto,
  type Comando,
  type TokenNumero,
} from "./parser";

/**
 * Órdenes por WhatsApp del supervisor de pagos (solo el 951365418).
 *
 * Nada que cambie datos se aplica sin una confirmación explícita con el número del
 * pedido ("SI 1140" / "ENVIAR 1140"). La pendiente vive 15 minutos en crm_settings.
 * La clave llega al cliente solo con "ENVIAR <pedido>". Entregarla equivale a decir que el
 * saldo se verificó: se registra como cobrado y el pedido pasa a «Entregado y cobrado».
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

type Accion = "pago" | "flete" | "entregado" | "enviar_clave" | "guia" | "adelanto";

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

// Última orden propuesta (aunque no dejara nada pendiente, p. ej. una clave bloqueada):
// permite corregir el pedido con «pedido es 1084» sin repetir toda la orden.
const CLAVE_ULTIMA = "supervisor_whatsapp_ultima_orden";
type TipoCorregible = "pago" | "flete" | "clave" | "entregado" | "estado" | "guia" | "adelanto";
const CORREGIBLES = new Set<string>(["pago", "flete", "clave", "entregado", "estado", "guia", "adelanto"]);

async function guardarUltimaOrden(u: { tipo: string; numeroOrden: string }): Promise<void> {
  if (!CORREGIBLES.has(u.tipo)) return;
  const value = JSON.stringify({ ...u, creado: Date.now() });
  await db
    .insert(crmSettings)
    .values({ key: CLAVE_ULTIMA, value })
    .onConflictDoUpdate({ target: crmSettings.key, set: { value } });
}

async function leerUltimaOrden(): Promise<{ tipo: TipoCorregible; numeroOrden: string } | null> {
  const [row] = await db.select().from(crmSettings).where(eq(crmSettings.key, CLAVE_ULTIMA)).limit(1);
  if (!row) return null;
  try {
    const u = JSON.parse(row.value) as { tipo: string; numeroOrden: string; creado: number };
    if (!CORREGIBLES.has(u.tipo) || Date.now() - u.creado > VIGENCIA_PENDIENTE_MS) return null;
    return { tipo: u.tipo as TipoCorregible, numeroOrden: u.numeroOrden };
  } catch {
    return null;
  }
}

const TIPO_POR_ACCION: Record<Accion, TipoCorregible> = {
  pago: "pago",
  flete: "flete",
  entregado: "entregado",
  enviar_clave: "clave",
  guia: "guia",
  adelanto: "adelanto",
};

/**
 * «no no pedido es 1084»: repite la última orden con el pedido correcto. Cancela lo
 * pendiente del pedido equivocado y NO arrastra su monto (era el saldo de otro cliente):
 * si hace falta, se vuelve a preguntar. Devuelve null si no hay orden reciente que corregir.
 */
async function corregirPedido(token: string, conversationId: string): Promise<string | null> {
  const pend = await leerPendiente();
  const ultima = await leerUltimaOrden();
  const tipo = pend ? TIPO_POR_ACCION[pend.accion] : ultima?.tipo;
  if (!tipo) return null;
  const anterior = pend?.numeroOrden ?? ultima?.numeroOrden ?? "";
  if (digitosPedido(anterior) === digitosPedido(token)) {
    return pend
      ? `Ya estamos con el pedido ${pend.numeroOrden}. Responde *SI ${digitosPedido(pend.numeroOrden)}* o *NO*.`
      : null;
  }
  if (pend) await guardarPendiente(null);
  const cmd: Comando = {
    tipo,
    numeros: [{ texto: token, esPedido: true, esMonto: false, valor: Number(digitosPedido(token)) || 0 }],
    nombre: null,
    completo: false,
    ...(pend?.accion === "guia" ? { guia: pend.guia ?? null, codigo: pend.codigo ?? null } : {}),
  };
  const texto = await proponer(cmd, conversationId);
  return `↩️ Corregido: dejo ${anterior || "el pedido anterior"} sin cambios y sigo con el ${token}.\n\n${texto}`;
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

/** Pedido por su guía Shalom (número de orden de 8-10 cifras), con el código si lo hay. */
async function pedidoPorGuia(guia: string, codigo?: string | null): Promise<Pedido | null> {
  const rows = await db
    .select(columnasPedido)
    .from(pedidosOrdenes)
    .leftJoin(contacts, eq(contacts.id, pedidosOrdenes.contactId))
    .where(
      or(
        eq(pedidosOrdenes.numeroGuia, guia),
        // Guía reemplazada con la orden «guia»: la anterior queda en las notas.
        ilike(pedidosOrdenes.notas, `%antes=${guia}/%`)
      )
    )
    .orderBy(desc(pedidosOrdenes.createdAt))
    .limit(3);
  const pedidos = rows.map((r) => ({ ...r.pedido, contactName: r.contactName }));
  const actual = pedidos.filter((p) => p.numeroGuia === guia);
  const conCodigo = codigo ? actual.find((p) => (p.codigoRastreo || "").toUpperCase() === codigo) : null;
  return conCodigo ?? actual[0] ?? pedidos[0] ?? null;
}

/**
 * Pedidos cuyo contacto se llama como lo escrito. Se traen los que tienen alguna de las
 * palabras y se quedan los que más coinciden (ver `mejoresPorNombre`): así un apellido
 * de más o de menos no deja sin resultado.
 */
async function pedidosPorNombre(nombre: string): Promise<Pedido[]> {
  const palabras = nombre.split(/\s+/).filter((p) => p.length >= 3).slice(0, 4);
  if (!palabras.length) return [];
  const nombreSql = sql`translate(lower(${contacts.name}), 'áéíóúü', 'aeiouu')`;
  const rows = await db
    .select(columnasPedido)
    .from(pedidosOrdenes)
    .innerJoin(contacts, eq(contacts.id, pedidosOrdenes.contactId))
    .where(
      and(
        or(...palabras.map((p) => sql`${nombreSql} like ${"%" + p + "%"}`)),
        ne(pedidosOrdenes.estado, "cancelado"),
        gt(pedidosOrdenes.createdAt, sql`now() - interval '90 days'`)
      )
    )
    .orderBy(desc(pedidosOrdenes.createdAt))
    .limit(40);
  const pedidos = mejoresPorNombre(
    palabras,
    rows.map((r) => ({ ...r.pedido, contactName: r.contactName }))
  ).slice(0, 6);
  // Si alguno sigue en curso, los ya entregados no compiten.
  const enCurso = pedidos.filter((p) => p.estado !== "entregado");
  return enCurso.length ? enCurso : pedidos;
}

/**
 * Pedido en curso de un contacto: el más reciente que no está cancelado, y entre ellos
 * el que aún no se entregó. Lo usan los avisos y la resolución por celular.
 */
export async function pedidoActivoDeContacto(contactId: string): Promise<Pedido | null> {
  const rows = await db
    .select(columnasPedido)
    .from(pedidosOrdenes)
    .leftJoin(contacts, eq(contacts.id, pedidosOrdenes.contactId))
    .where(and(eq(pedidosOrdenes.contactId, contactId), ne(pedidosOrdenes.estado, "cancelado")))
    .orderBy(desc(pedidosOrdenes.createdAt))
    .limit(5);
  const pedidos = rows.map((r) => ({ ...r.pedido, contactName: r.contactName }));
  return pedidos.find((p) => p.estado !== "entregado") ?? pedidos[0] ?? null;
}

/** «Pedido #1084 · saldo pendiente S/ 99.00» para los avisos al supervisor, o null. */
export async function resumenPedidoParaAviso(contactId: string | null | undefined): Promise<string | null> {
  if (!contactId) return null;
  const p = await pedidoActivoDeContacto(contactId);
  if (!p) return null;
  const c = cuentasDelPedido(p);
  const saldo =
    c.saldoCubierto ? "saldo ya registrado como pagado" : `saldo pendiente ${soles(c.saldoPendiente)}`;
  return `Pedido ${p.numeroOrden} · ${saldo}`;
}

async function pedidoPorCelular(celular: string): Promise<Pedido | null> {
  const nueve = normalizarTelefono(celular).slice(-9);
  if (nueve.length !== 9) return null;
  const [c] = await db
    .select({ id: contacts.id })
    .from(contacts)
    .where(or(eq(contacts.phone, `+51${nueve}`), eq(contacts.phone, nueve), eq(contacts.phone, `51${nueve}`)))
    .limit(1);
  return c ? pedidoActivoDeContacto(c.id) : null;
}

/**
 * Pedido del ÚLTIMO aviso enviado a este chat: permite escribir "pagó 179" sin número.
 * Solo mira el aviso más reciente. Si no trae número de pedido, se busca por el celular
 * del cliente del aviso; nunca se salta a un aviso anterior (eso llevó a tomar el #1095
 * de otro cliente cuando el aviso era del pago de Roger, #1084).
 */
async function ultimaAlerta(
  conversationId: string
): Promise<{ pedido: Pedido; flete: number | null; cliente: string | null } | null> {
  const rows = await db
    .select({ body: messages.body })
    .from(messages)
    .where(and(eq(messages.conversationId, conversationId), eq(messages.direction, "out")))
    .orderBy(desc(messages.createdAt))
    .limit(30);
  const body = rows.map((r) => r.body || "").find((b) => /ALERTA/i.test(b));
  if (!body) return null;
  const f = body.match(/flete\s+S\/\s*([\d.]+)/i);
  const flete = f ? Number(f[1]) : null;
  const cliente = body.match(/Cliente:\**\s*([^(\n]+?)\s*\(/i)?.[1]?.trim() ?? null;
  const m = body.match(/#+((?:LEG-|CHAT-|ALIV-)?\d{3,})/i);
  if (m) {
    const p = await pedidoPorToken(m[1].toUpperCase());
    return p ? { pedido: p, flete, cliente } : null;
  }
  const cel = body.match(/\+?51\s?(9\d{8})\b/);
  if (!cel) return null;
  const p = await pedidoPorCelular(cel[1]);
  return p ? { pedido: p, flete, cliente } : null;
}

type Resolucion =
  | { ok: true; pedido: Pedido; monto: number | null; fleteAlerta: number | null; delAviso?: string }
  | { ok: false; texto: string };

async function resolverPedido(cmd: Comando, conversationId: string): Promise<Resolucion> {
  // La guía Shalom o el celular identifican el pedido sin dudas: mandan sobre el nombre y
  // nunca se cambian por el pedido del último aviso (así se tomó a Jaime #1140 cuando
  // Gerardo pidió la clave de la guía 104493022 de Carlos Huaynalaya).
  if (cmd.tipo !== "guia" && cmd.guia && !cmd.numeros.some((t) => t.esPedido)) {
    const p = await pedidoPorGuia(cmd.guia, cmd.codigo);
    if (!p) {
      return { ok: false, texto: `No encuentro ningún pedido con la guía Shalom ${cmd.guia}. Revisa el número o escribe el número de pedido.` };
    }
    return { ok: true, pedido: p, monto: separarPedidoYMonto(cmd.numeros, () => false).monto, fleteAlerta: null };
  }
  if (cmd.celular && !cmd.numeros.some((t) => t.esPedido)) {
    const p = await pedidoPorCelular(cmd.celular);
    if (!p) return { ok: false, texto: `No encuentro pedidos del celular ${cmd.celular}.` };
    return { ok: true, pedido: p, monto: separarPedidoYMonto(cmd.numeros, () => false).monto, fleteAlerta: null };
  }

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
    const fleteAlerta = alerta && alerta.pedido.id === p.id ? alerta.flete : null;
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
    // Dio un nombre y no hay pedidos con ese nombre: no se cambia por el cliente del último
    // aviso, que sería otra persona. Se le dice cuál es, por si era ese.
    const alertaNombre = await ultimaAlerta(conversationId);
    const sugerencia = alertaNombre
      ? `\nSi es el del último aviso (${alertaNombre.cliente ?? alertaNombre.pedido.contactName ?? "cliente"}, ${alertaNombre.pedido.numeroOrden}), repite la orden con ese número.`
      : "";
    return {
      ok: false,
      texto: `No encuentro pedidos a nombre de «${cmd.nombre}». Escribe el número de pedido, la guía Shalom o el celular del cliente.${sugerencia}`,
    };
  }

  const alerta = await ultimaAlerta(conversationId);
  if (alerta) {
    return {
      ok: true,
      pedido: alerta.pedido,
      monto,
      fleteAlerta: alerta.flete,
      delAviso: alerta.cliente ?? alerta.pedido.contactName ?? "el cliente del último aviso",
    };
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
  "• *adelanto 1140* → confirmas que verificaste el Yape de S/20 (pedido a Confirmado y S/20 al ERP)",
  "• *pagó 1140 179* → registra el pago del saldo (también «Jaime pagó 179» o «pago completo 1140»)",
  "• *flete 1140 10* → flete pagado en Págalo",
  "• *clave 1140* → te muestro la clave; al *ENVIAR* el saldo queda cobrado y el pedido entregado",
  "• *entregado 1140* → marca el pedido como entregado",
  "• *estado 1140* → ficha completa: cliente, DNI, dirección, productos, saldo, guía Shalom y clave",
  "• *guia 1066 104169999 AB12* → registra la guía nueva (por ejemplo tras un cambio de destino)",
  "Antes de cambiar algo te pido confirmar con *SI 1140*. Para mandar la clave al cliente: *ENVIAR 1140*. *NO* cancela.",
  "El pedido puede ir por número (1140), por guía Shalom (104493022), por celular (987654321) o por nombre («clave de Carlos Huaynalaya»).",
  "Si no pones número, uso el pedido de la última alerta. También puedes escribirme normal («ya me llegó el yape de Manuel», «cuánto le falta a Vertiz»): te digo qué entendí y siempre te pido el SI antes de cambiar algo.",
].join("\n");

/**
 * Ficha completa del pedido para el Administrador: todo lo que el CRM sabe (cliente,
 * productos, dinero, Shalom con la clave de retiro y lo verificado). Solo lectura.
 */
function fichaPedido(p: Pedido, c: CuentasPedido, celular: string | null): string {
  const productos = (p.items ?? []).map((i) => `${i.cantidad ?? 1}x ${i.titulo ?? "producto"}`).join(", ");
  const fecha = p.createdAt
    ? new Date(p.createdAt).toLocaleDateString("es-PE", { timeZone: "America/Lima", day: "2-digit", month: "2-digit" })
    : null;
  const adelantoOk = adelantoRegistrado(p.notas);
  const quien = adelantoOk ? quienVerificoAdelanto(p.notas) : null;
  return [
    `📋 *${encabezado(p)}*${fecha ? ` · ${fecha}` : ""}`,
    `Estado: *${p.estado}* · pago: ${p.modalidadPago}`,
    `👤 ${[celular, p.dniCliente ? `DNI ${p.dniCliente}` : "sin DNI"].filter(Boolean).join(" · ")}`,
    `📍 ${[p.direccionEnvio, p.distrito, p.ciudad].filter(Boolean).join(", ") || "sin dirección"}`,
    `🛒 ${productos || "sin productos"} · total ${soles(c.total)}`,
    `💵 Adelanto ${soles(c.adelanto)}${c.adelanto > 0 ? (adelantoOk ? ` verificado${quien ? ` (${quien})` : ""}` : " sin verificar") : ""} · ` +
      (c.saldoCobrado !== null
        ? `saldo cobrado ${soles(c.saldoCobrado)}${c.saldoCubierto ? " ✅" : ` (faltan ${soles(c.saldoPendiente - c.saldoCobrado)})`}`
        : `saldo pendiente ${soles(c.saldoPendiente)}`),
    `📦 ${p.transportadora || "Shalom"}: ${datosRastreo(p)} · flete ${c.fleteRegistrado !== null ? soles(c.fleteRegistrado) : "no registrado"}`,
    `🔑 Clave de retiro: ${p.claveRecojo ? `*${p.claveRecojo}*` : "no registrada"}`,
    p.claveRecojo && p.estado !== "entregado"
      ? `Para mandársela al cliente escribe «clave ${digitosPedido(p.numeroOrden)}».`
      : null,
  ]
    .filter(Boolean)
    .join("\n");
}

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
    `📦 ${datosRastreo(p)} · ${
      c.saldoCubierto
        ? `saldo cobrado ${soles(c.saldoCobrado ?? 0)}`
        : `⚠️ al enviarla registro el saldo de ${soles(c.saldoPendiente)} como cobrado`
    }`,
    `El pedido pasa a *Entregado y cobrado* al enviar la clave.`,
    `¿Se la envío a ${nombre} por WhatsApp? Responde *ENVIAR ${digitosPedido(p.numeroOrden)}* (o *NO*).`,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Clave entregada = saldo cobrado + pedido entregado

/** Pedido a «Entregado» (pedido, pipeline, posventa y ERP). */
async function marcarEntregado(p: Pedido, autor: string): Promise<void> {
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
  await nota(p, `Pedido ${p.numeroOrden} marcado como Entregado por ${autor}.`);
  if (p.dealId) notificarCambioDealAlErp(p.dealId).catch(() => {});
}

/**
 * Se entregó la clave de retiro (botón «Enviar Clave Auto» o «ENVIAR 1084» por chat).
 * Entregarla implica que Gerardo ya verificó el saldo, así que:
 * 1. si el saldo no estaba registrado, se registra completo como cobrado (cuenta BCP);
 * 2. el pedido pasa a «Entregado y cobrado» (pipeline, posventa y ERP).
 * Es idempotente: si ya estaba cobrado y entregado, no cambia nada.
 */
export async function registrarClaveEntregada(
  pedidoId: string,
  autor: string
): Promise<{ ok: boolean; saldoRegistrado: number | null; entregado: boolean; texto: string }> {
  const p = await pedidoPorId(pedidoId);
  if (!p) return { ok: false, saldoRegistrado: null, entregado: false, texto: "No encontré el pedido." };
  const c = cuentasDelPedido(p);
  let saldoRegistrado: number | null = null;
  if (!c.saldoCubierto && c.saldoPendiente > 0) {
    const res = await registrarFinanzasShalom(
      { pedidoId: p.id, dealId: p.dealId, numeroOrden: p.numeroOrden, saldoMonto: c.saldoPendiente, saldoCuenta: "BCP" },
      autor
    );
    if (!res.ok) {
      await nota(p, `[CLAVE ENTREGADA] No se pudo registrar el saldo de ${soles(c.saldoPendiente)}: ${res.error}`);
      return {
        ok: false,
        saldoRegistrado: null,
        entregado: false,
        texto: `⚠️ No pude registrar el saldo de ${soles(c.saldoPendiente)} (${res.error}); regístralo a mano. El pedido no cambió de etapa.`,
      };
    }
    saldoRegistrado = c.saldoPendiente;
    await nota(p, `[CLAVE ENTREGADA] Saldo de ${soles(c.saldoPendiente)} registrado como cobrado al entregar la clave (${autor}).`);
  }
  const yaEntregado = p.estado === "entregado";
  if (!yaEntregado) await marcarEntregado((await pedidoPorId(p.id)) ?? p, autor);
  else if (saldoRegistrado !== null && p.dealId) notificarCambioDealAlErp(p.dealId).catch(() => {});
  const partes = [
    saldoRegistrado !== null ? `💰 Saldo de ${soles(saldoRegistrado)} registrado como cobrado.` : null,
    yaEntregado ? `${encabezado(p)} ya estaba como Entregado.` : `📦 ${encabezado(p)} pasó a *Entregado y cobrado*; la posventa arranca sola.`,
  ].filter(Boolean);
  return { ok: true, saldoRegistrado, entregado: true, texto: partes.join("\n") };
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

async function proponer(cmd: Comando, conversationId: string): Promise<string> {
  const r = await resolverPedido(cmd, conversationId);
  if (!r.ok) return r.texto;
  await guardarUltimaOrden({ tipo: cmd.tipo, numeroOrden: r.pedido.numeroOrden });
  const texto = await proponerPara(cmd, r);
  // Sin número en el mensaje: decir de qué aviso se tomó el pedido, para que se note
  // al instante si no es el cliente que el supervisor tenía en mente.
  return r.delAviso
    ? `ℹ️ Tomé el pedido del último aviso (${r.delAviso}). Si es otro, responde «pedido es 1234».\n\n${texto}`
    : texto;
}

async function proponerPara(cmd: Comando, r: Extract<Resolucion, { ok: true }>): Promise<string> {
  const p = r.pedido;
  const c = cuentasDelPedido(p);
  const n = digitosPedido(p.numeroOrden);

  if (cmd.tipo === "estado") {
    const [contacto] = p.contactId
      ? await db.select({ phone: contacts.phone }).from(contacts).where(eq(contacts.id, p.contactId)).limit(1)
      : [];
    return fichaPedido(p, c, contacto?.phone ?? null);
  }

  if (cmd.tipo === "clave") {
    if (!p.claveRecojo) return `${encabezado(p)} todavía no tiene la clave de retiro registrada en el CRM.`;
    // Pedir la clave implica que el saldo ya se verificó: al ENVIAR se registra como
    // cobrado y el pedido pasa a «Entregado y cobrado» (ver registrarClaveEntregada).
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

  if (cmd.tipo === "adelanto") {
    if (adelantoRegistrado(p.notas)) {
      const quien = quienVerificoAdelanto(p.notas);
      return `✔️ El adelanto de ${encabezado(p)} ya estaba verificado${quien ? ` (por ${quien})` : ""}. No cambié nada.`;
    }
    if (["enviado", "entregado", "cancelado", "rechazado"].includes(String(p.estado))) {
      return `${encabezado(p)} está en estado «${p.estado}»: el adelanto se confirma antes del envío. Si hay que corregirlo, hazlo desde el CRM.`;
    }
    await guardarPendiente({ accion: "adelanto", pedidoId: p.id, numeroOrden: p.numeroOrden, monto: 20 });
    const total = Number(p.total) || 0;
    const productos = (p.items ?? []).map((i) => `${i.cantidad ?? 1}x ${i.titulo ?? "producto"}`).join(", ");
    return [
      `💵 *${encabezado(p)}* · ${[p.ciudad, p.distrito].filter(Boolean).join(" / ") || "sin ciudad"}`,
      `${productos || "productos"} · total ${soles(total)} · estado: ${p.estado}`,
      `Adelanto a confirmar: *S/ 20.00* (Yape al BCP) · saldo a cobrar al recoger: ${soles(Math.max(0, total - 20))}`,
      `Queda verificado a tu nombre, el pedido pasa a *Confirmado* en el pipeline y el ERP registra los S/ 20. Responde *SI ${n}* para confirmar o *NO*.`,
    ].join("\n");
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

  if (pend.accion === "adelanto") {
    const { confirmarAdelantoPedido } = await import("@/lib/pedidos/confirmar-adelanto");
    const { yaEstaba } = await confirmarAdelantoPedido(p, AUTOR);
    if (yaEstaba) return `✔️ El adelanto de ${encabezado(p)} ya estaba verificado; no cambié nada.`;
    return [
      `✅ Adelanto de S/ 20.00 verificado en ${encabezado(p)}: pedido *Confirmado* en el pipeline y S/ 20 enviados al ERP (BCP).`,
      "Siguiente paso: registrar el envío en Shalom Pro y mandarle el seguimiento al cliente desde el CRM.",
    ].join("\n");
  }

  if (pend.accion === "entregado") {
    await marcarEntregado(p, AUTOR);
    return `✅ ${encabezado(p)} quedó como *Entregado* en el pipeline y el ERP; la posventa arranca sola.`;
  }

  if (pend.accion === "enviar_clave") {
    const c = cuentasDelPedido(p);
    if (!p.claveRecojo) return `🔒 ${encabezado(p)}: el pedido ya no tiene clave de retiro registrada.`;
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
    const cierre = await registrarClaveEntregada(p.id, AUTOR);
    return `✅ Clave enviada a ${nombre} por WhatsApp.\n${cierre.texto}`;
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

  let cmd = interpretarComando(ultimo.body);
  let entendido = "";
  if (!cmd) {
    const token = interpretarCorreccion(ultimo.body);
    if (token) {
      let correccion: string | null = null;
      try {
        correccion = await corregirPedido(token, conversationId);
      } catch (err) {
        console.error("[supervisor-comandos] error al corregir el pedido:", err);
        correccion = "❌ Hubo un error al cambiar de pedido. No se cambió nada; repite la orden con el número.";
      }
      if (correccion) {
        await responder(conversationId, correccion);
        return true;
      }
    }
    const pend = await leerPendiente();

    // Lenguaje libre: la IA traduce el mensaje a una orden estándar, que vuelve a pasar
    // por el intérprete fijo y sigue pidiendo «SI <pedido>» antes de cambiar algo.
    const traduccion = await traducirConIA(ultimo.body || "", conversationId);
    if (traduccion?.tipo === "no_soportada") {
      await responder(
        conversationId,
        `Entendí que quieres: ${traduccion.descripcion}. Eso todavía no lo puedo hacer por WhatsApp; hazlo desde el CRM. No cambié nada.`
      );
      return true;
    }
    if (traduccion?.tipo === "orden") {
      const t = traduccion.comando.tipo;
      if (t === "confirmar" || t === "enviar_clave") {
        // Confirmar o mandar una clave exige escribir el número tal cual: la IA no lo decide.
        const n = pend ? digitosPedido(pend.numeroOrden) : null;
        await responder(
          conversationId,
          !pend
            ? "No hay nada pendiente de confirmar (las confirmaciones vencen a los 15 minutos)."
            : pend.accion === "enviar_clave"
              ? `Para mandarle la clave al cliente escribe exactamente *ENVIAR ${n}*, o *NO* para cancelar.`
              : `Para confirmar escribe exactamente *SI ${n}*, o *NO* para cancelar.`
        );
        return true;
      }
      cmd = traduccion.comando;
      entendido = `🤖 Entendí: *${traduccion.orden}*\n\n`;
    }
  }

  if (!cmd) {
    const pend = await leerPendiente();
    // Un "sí" / "ok" suelto con algo pendiente no va al bot de ventas (que podría
    // inventar que registró algo): se le recuerda cómo confirmar.
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
    // Parece una orden pero no se entendió: se le avisa a Gerardo en vez de pasarla al bot de
    // ventas, que le contestaría como a un cliente («un asesor revisará tu pedido»).
    if (pareceOrdenNoEntendida(ultimo.body)) {
      await responder(conversationId, `No entendí la orden; no cambié nada.\n\n${AYUDA}`);
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
  await responder(conversationId, entendido + texto);
  return true;
}

/** Últimos mensajes del chat (sin el que se traduce) como contexto para la IA. */
async function traducirConIA(texto: string, conversationId: string) {
  if (!texto.trim() || texto.length > 600) return null;
  const { traducirOrdenConIA } = await import("./interprete-ia");
  const filas = await db
    .select({ body: messages.body, direction: messages.direction })
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(desc(messages.createdAt))
    .limit(9);
  const contexto = filas
    .slice(1)
    .reverse()
    .map((m) => `${m.direction === "in" ? "Gerardo" : "CRM"}: ${(m.body || "").replace(/\s+/g, " ").slice(0, 350)}`);
  return traducirOrdenConIA(texto, contexto);
}

// Exportado para pruebas.
export const _internas = { AYUDA, textoClaveCliente, fichaPedido };
