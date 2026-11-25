import "server-only";
import { db } from "@/db";
import { crmSettings, teamMembers } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { SUPERVISORES, SUPERVISOR_ADMINISTRADOR } from "@/lib/alerts/perfiles-supervisor";
import { enviarTextoInterno } from "@/lib/alerts/conversacion-supervisor";
import { cuentaBotWhatsapp } from "@/lib/channels/numeros";
import { generarPdfResumen } from "./pdf";
import { tokenResumen } from "./token";
import {
  esPostulante,
  fechaLimaCorta,
  textoResumenAdmin,
  textoResumenVendedor,
  tocaResumen,
  type ActividadDia,
  type Pendiente,
} from "./formato";

/** crm_settings: { fecha, enviados: [dígitos] } — cada destinatario recibe un resumen por día. */
const CLAVE = "resumen_diario_pendientes";

const ETAPAS_POR_CERRAR = ["carrito_armado", "formulario_abandonado"];
const ETAPAS_PEDIDO = ["por_validar", "agendar_entrega", "adelanto_pagado", "en_reparto", "entregado"];
const ETAPAS_EN_CURSO = ["por_validar", "agendar_entrega", "adelanto_pagado", "en_reparto"];

/** Arreglo de texto como parámetros (drizzle expande un array JS como lista, no como arreglo). */
function lista(xs: readonly string[]) {
  return sql`array[${sql.join(xs.map((x) => sql`${x}`), sql`, `)}]::text[]`;
}

function filas<T>(r: unknown): T[] {
  return r as T[];
}

export async function cargarPendientes(): Promise<Pendiente[]> {
  // Fuera los chats de prueba del equipo y el propio número del bot.
  const bot = (await cuentaBotWhatsapp())?.username?.replace(/\D/g, "").slice(-9);
  const DIGITOS_EQUIPO = [...SUPERVISORES.map((s) => s.digitos), ...(bot && bot.length === 9 ? [bot] : [])];
  const equipo = sql`right(regexp_replace(coalesce(ct.phone, ''), '\\D', '', 'g'), 9) <> all(${lista(DIGITOS_EQUIPO)})`;

  const esperando = filas<Pendiente>(
    await db.execute(sql`
      select 'esperando' as tipo, c.id as "conversationId", ct.owner_id as "ownerId",
        coalesce(ct.name, c.participant_name) as nombre, coalesce(ct.phone, c.participant_id) as telefono,
        c.last_message_body as detalle, c.last_message_at as desde
      from conversations c join contacts ct on ct.id = c.contact_id
      where c.channel = 'whatsapp' and c.last_direction = 'in' and not c.needs_human
        and c.last_message_at > now() - interval '7 days' and ${equipo}
      order by c.last_message_at asc`)
  );

  const asesor = filas<Pendiente>(
    await db.execute(sql`
      select 'asesor' as tipo, c.id as "conversationId", ct.owner_id as "ownerId",
        coalesce(ct.name, c.participant_name) as nombre, coalesce(ct.phone, c.participant_id) as telefono,
        coalesce(c.needs_human_reason, c.last_message_body) as detalle, coalesce(c.needs_human_at, c.last_message_at) as desde
      from conversations c join contacts ct on ct.id = c.contact_id
      where c.needs_human and coalesce(c.needs_human_at, c.last_message_at) > now() - interval '14 days' and ${equipo}
      order by 7 asc`)
  );

  const porCerrar = filas<Pendiente>(
    await db.execute(sql`
      select distinct on (ct.id) 'por_cerrar' as tipo, null as "conversationId", ct.owner_id as "ownerId",
        ct.name as nombre, ct.phone as telefono, ps.name as detalle, d.updated_at as desde
      from deals d join pipeline_stages ps on ps.id = d.stage_id join contacts ct on ct.id = d.contact_id
      where ps.key = any(${lista(ETAPAS_POR_CERRAR)}) and d.updated_at > now() - interval '7 days' and ${equipo}
      order by ct.id, d.updated_at desc`)
  );

  // Un cliente aparece una sola vez: lo urgente (esperando / pide persona) primero.
  const vistos = new Set<string>();
  const clave = (p: Pendiente) => (p.telefono ?? "").replace(/\D/g, "").slice(-9) || p.conversationId || "";
  const out: Pendiente[] = [];
  const asesorOPostulante = asesor.map((p) => (esPostulante(p.detalle) ? { ...p, tipo: "postulante" as const } : p));
  for (const p of [...esperando, ...asesorOPostulante, ...porCerrar]) {
    const k = clave(p);
    if (k && vistos.has(k)) continue;
    if (k) vistos.add(k);
    out.push(p);
  }
  return out;
}

export async function cargarActividad(): Promise<ActividadDia> {
  const [a] = filas<{ chats: number; mensajes: number; pedidos: number }>(
    await db.execute(sql`
      select
        (select count(*)::int from conversations where created_at > now() - interval '24 hours' and last_message_at is not null) as chats,
        (select count(*)::int from messages where direction = 'in' and created_at > now() - interval '24 hours') as mensajes,
        (select count(*)::int from deals d join pipeline_stages ps on ps.id = d.stage_id
           where d.created_at > now() - interval '24 hours' and ps.key = any(${lista(ETAPAS_PEDIDO)})) as pedidos`)
  );
  const etapas = filas<{ nombre: string; n: number }>(
    await db.execute(sql`
      select ps.name as nombre, count(d.id)::int as n
      from pipeline_stages ps left join deals d on d.stage_id = ps.id
      where ps.key = any(${lista(ETAPAS_EN_CURSO)})
      group by ps.name, ps."order" order by ps."order"`)
  );
  return { chatsNuevos: a?.chats ?? 0, mensajesClientes: a?.mensajes ?? 0, pedidosNuevos: a?.pedidos ?? 0, etapas };
}

async function leerEstado(hoy: string): Promise<Set<string>> {
  const [fila] = await db.select({ value: crmSettings.value }).from(crmSettings).where(eq(crmSettings.key, CLAVE)).limit(1);
  try {
    const v = JSON.parse(fila?.value ?? "{}") as { fecha?: string; enviados?: string[] };
    return new Set(v.fecha === hoy ? v.enviados ?? [] : []);
  } catch {
    return new Set();
  }
}

async function guardarEstado(hoy: string, enviados: Set<string>) {
  const value = JSON.stringify({ fecha: hoy, enviados: [...enviados] });
  await db.insert(crmSettings).values({ key: CLAVE, value }).onConflictDoUpdate({ target: crmSettings.key, set: { value } });
}

/** «2026-11-25» → «25/11». */
function diaMes(fecha: string): string {
  const [, m, d] = fecha.split("-");
  return `${d}/${m}`;
}

/** Destino «admin» = resumen general; si no, el team_members.id del vendedor. */
export async function pdfResumen(destino: string, fecha: string): Promise<Uint8Array | null> {
  const [pendientes, miembros] = await Promise.all([
    cargarPendientes(),
    db.select({ id: teamMembers.id, nombre: teamMembers.name }).from(teamMembers),
  ]);
  const nombreDueno = (id: string | null) => miembros.find((m) => m.id === id)?.nombre || "Sin asignar";
  if (destino === "admin") {
    const actividad = await cargarActividad();
    const grupos = new Map<string, Pendiente[]>();
    for (const p of pendientes.filter((x) => x.tipo !== "postulante")) {
      const k = nombreDueno(p.ownerId);
      grupos.set(k, [...(grupos.get(k) ?? []), p]);
    }
    const n = (l: Pendiente[], t: Pendiente["tipo"]) => l.filter((p) => p.tipo === t).length;
    return generarPdfResumen({
      titulo: `Resumen del día ${diaMes(fecha)}`,
      subtitulo: "Todos los chats del CRM · para empezar la jornada de mañana",
      pendientes,
      actividad,
      porVendedor: [...grupos.entries()].map(([nombre, l]) => ({
        nombre,
        esperando: n(l, "esperando"),
        asesor: n(l, "asesor"),
        porCerrar: n(l, "por_cerrar"),
      })),
      nombreDueno,
    });
  }
  const miembro = miembros.find((m) => m.id === destino);
  if (!miembro) return null;
  return generarPdfResumen({
    titulo: `${miembro.nombre ?? "Vendedor"}, tus pendientes del ${diaMes(fecha)}`,
    subtitulo: "Tus clientes en el CRM · para empezar la jornada de mañana",
    pendientes: pendientes.filter((p) => p.ownerId === destino && p.tipo !== "postulante"),
  });
}

/** El PDF va como segundo mensaje: si falla, el texto ya llegó igual. */
async function enviarPdf(digitos: string, destino: string, fecha: string, nombreArchivo: string) {
  const secreto = process.env.AGENT_WORKER_SECRET;
  if (!secreto) return { ok: false, error: "sin_secreto" };
  const base = (process.env.NEXT_PUBLIC_APP_URL || "https://crm-aliv.onrender.com").replace(/\/+$/, "");
  const url = `${base}/api/publico/resumen/${tokenResumen(fecha, destino, secreto)}`;
  const r = await enviarTextoInterno(digitos, "📄 Detalle completo en PDF", {
    type: "document",
    url,
    name: nombreArchivo,
    mimeType: "application/pdf",
  });
  if (!r.ok) console.warn(`[resumen-diario] PDF no enviado a ${digitos}: ${r.error}`);
  return r;
}

/**
 * Barrido: desde las 22:00 de Lima manda a cada vendedor sus pendientes y a Gerardo el resumen
 * general. Una vez por día y por persona; si a alguien no le llegó (ventana de 24 h cerrada),
 * se reintenta en la vuelta siguiente hasta medianoche. Sin plantillas (no genera cobro).
 */
export async function enviarResumenDiario(opts: { ahora?: Date; forzar?: boolean; soloVer?: boolean } = {}) {
  const ahora = opts.ahora ?? new Date();
  if (!opts.forzar && !tocaResumen(ahora)) return { hecho: false, motivo: "antes de las 22:00" };
  const hoy = fechaLimaCorta(ahora);
  const enviados = opts.forzar ? new Set<string>() : await leerEstado(hoy);
  const admin = SUPERVISOR_ADMINISTRADOR;
  if (enviados.has(admin) && !opts.soloVer) return { hecho: false, motivo: "ya enviado hoy" };

  const [pendientes, actividad, miembros] = await Promise.all([
    cargarPendientes(),
    cargarActividad(),
    db.select({ id: teamMembers.id, nombre: teamMembers.name }).from(teamMembers),
  ]);

  const envios: { nombre: string; ok: boolean; error?: string; sinPendientes?: boolean }[] = [];
  const textos: { nombre: string; texto: string }[] = [];
  for (const sup of SUPERVISORES) {
    if (sup.digitos === admin || !sup.miembroId) continue;
    const texto = textoResumenVendedor(sup.nombre, pendientes.filter((p) => p.ownerId === sup.miembroId), ahora);
    if (!texto) {
      envios.push({ nombre: sup.nombre, ok: false, sinPendientes: true });
      continue;
    }
    textos.push({ nombre: sup.nombre, texto });
    if (opts.soloVer) continue;
    if (enviados.has(sup.digitos)) {
      envios.push({ nombre: sup.nombre, ok: true });
      continue;
    }
    const r = await enviarTextoInterno(sup.digitos, texto);
    envios.push({ nombre: sup.nombre, ok: r.ok, error: r.error });
    if (r.ok) {
      enviados.add(sup.digitos);
      await enviarPdf(sup.digitos, sup.miembroId, hoy, `Pendientes ${sup.nombre} ${hoy}.pdf`);
    }
  }

  const textoAdmin = textoResumenAdmin({ pendientes, actividad, vendedores: miembros, envios, ahora });
  textos.push({ nombre: "Gerardo", texto: textoAdmin });
  if (opts.soloVer) return { hecho: false, motivo: "solo ver", textos };

  const r = await enviarTextoInterno(admin, textoAdmin);
  if (r.ok) {
    enviados.add(admin);
    await enviarPdf(admin, "admin", hoy, `Resumen CRM ${hoy}.pdf`);
  } else console.warn(`[resumen-diario] no se pudo enviar a Gerardo: ${r.error}`);
  await guardarEstado(hoy, enviados);
  return { hecho: r.ok, envios: [...envios, { nombre: "Gerardo", ok: r.ok, error: r.error }], pendientes: pendientes.length };
}
