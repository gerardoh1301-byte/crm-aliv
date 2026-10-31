import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db";

/**
 * Metricas del CRM para el panel de crecimiento del sistema integrado (Claude lee esto
 * cada manana y lo cruza con Meta Ads y Shopify en Google Sheets).
 *
 * Sin datos personales a proposito: ni telefonos, ni direcciones, ni apellidos. El
 * panel necesita cuentas y tiempos, no clientes.
 *
 * `salud` es lo que decide que servicios vale la pena pagar (ver decisiones-pago.md):
 *  - demora_webhook: segundos entre que el cliente envia y el CRM guarda el mensaje.
 *    Si Render gratis esta dormido, aqui se ve.
 *  - errores_limite: trabajos del agente que fallaron por cuota de Gemini (429).
 */

const ZONA = "America/Lima";
const MAX_DIAS = 92;

export interface RangoMetricas {
  desde: string;
  hasta: string;
}

const PALABRAS_COMPRA =
  /(precio|cu[aá]nto|costo|cuesta|env[ií]o|env[ií]an|delivery|provincia|pedido|comprar|quiero|info|informaci[oó]n|disponible|stock|contraentrega|yape|plin|d[oó]nde)/i;
const PALABRAS_QUEJA =
  /(estafa|enga[nñ]o|fraude|no lleg[oó]|reclamo|devoluci[oó]n|no funciona|malo|p[eé]simo|nunca|robo)/i;

function hoyLima(desplazamientoDias = 0): string {
  const fecha = new Date(Date.now() + desplazamientoDias * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: ZONA }).format(fecha);
}

/** Valida `desde`/`hasta` (YYYY-MM-DD, hora de Lima). Por defecto: ayer. */
export function leerRango(params: URLSearchParams): RangoMetricas | { error: string } {
  const formato = /^\d{4}-\d{2}-\d{2}$/;
  const desde = params.get("desde") ?? hoyLima(-1);
  const hasta = params.get("hasta") ?? desde;
  if (!formato.test(desde) || !formato.test(hasta)) {
    return { error: "desde/hasta deben ser YYYY-MM-DD" };
  }
  const dias = (Date.parse(hasta) - Date.parse(desde)) / 86_400_000;
  if (Number.isNaN(dias) || dias < 0) return { error: "rango invalido" };
  if (dias > MAX_DIAS) return { error: `maximo ${MAX_DIAS} dias por consulta` };
  return { desde, hasta };
}

type Fila = Record<string, unknown>;

async function filas(consulta: ReturnType<typeof sql>): Promise<Fila[]> {
  return (await db.execute(consulta)) as unknown as Fila[];
}

function num(valor: unknown): number {
  const n = Number(valor);
  return Number.isFinite(n) ? n : 0;
}

function primerNombre(nombre: unknown): string {
  return String(nombre ?? "").trim().split(/\s+/)[0] || "Cliente";
}

/** El payload de comment.received no esta documentado: se prueban las formas probables. */
function textoComentario(payload: unknown): string {
  type Nodo = { text?: unknown; message?: unknown };
  const p = (payload ?? {}) as Nodo & { comment?: Nodo; message?: Nodo; data?: Nodo };
  const texto =
    p.comment?.text ?? p.comment?.message ?? p.message?.text ?? p.data?.text ?? p.text ?? "";
  return String(texto).slice(0, 200);
}

export async function calcularMetricas({ desde, hasta }: RangoMetricas) {
  // Limites del rango en hora de Lima, como timestamptz.
  const ini = sql`((${desde})::date)::timestamp at time zone ${ZONA}`;
  const fin = sql`(((${hasta})::date + 1))::timestamp at time zone ${ZONA}`;
  const dia = (col: ReturnType<typeof sql>) => sql`to_char(${col} at time zone ${ZONA}, 'YYYY-MM-DD')`;

  const [
    convPorDia,
    msgPorDia,
    derivadosPorDia,
    pedidosPorDia,
    estados,
    convAnuncio,
    pedidosLista,
    demoraWebhook,
    respuestaAgente,
    jobs,
    fallidos,
    eventos,
    comentarios,
    sinRespuesta,
  ] = await Promise.all([
    filas(sql`
      select ${dia(sql`created_at`)} as fecha, channel as canal, count(*)::int as n
      from conversations where created_at >= ${ini} and created_at < ${fin}
      group by 1, 2`),
    filas(sql`
      select ${dia(sql`created_at`)} as fecha, direction, coalesce(origin, '') as origen, count(*)::int as n
      from messages where created_at >= ${ini} and created_at < ${fin}
      group by 1, 2, 3`),
    filas(sql`
      select ${dia(sql`needs_human_at`)} as fecha, count(*)::int as n
      from conversations where needs_human_at >= ${ini} and needs_human_at < ${fin}
      group by 1`),
    filas(sql`
      select ${dia(sql`created_at`)} as fecha,
             case when shopify_order_id is null then 'chat' else 'web' end as origen,
             count(*)::int as n, coalesce(sum(total), 0)::float8 as monto
      from pedidos_ordenes where created_at >= ${ini} and created_at < ${fin}
      group by 1, 2`),
    filas(sql`
      select estado, count(*)::int as n, coalesce(sum(total), 0)::float8 as monto
      from pedidos_ordenes where created_at >= ${ini} and created_at < ${fin}
      group by 1`),
    filas(sql`
      select coalesce(metadata->>'ctwa_source_id', metadata->>'meta_ad_id') as ad_id,
             max(metadata->>'ctwa_headline') as titular,
             count(*)::int as conversaciones,
             array_agg(distinct contact_id) as contactos
      from conversations
      where created_at >= ${ini} and created_at < ${fin}
        and coalesce(metadata->>'ctwa_source_id', metadata->>'meta_ad_id') is not null
      group by 1`),
    filas(sql`
      select p.numero_orden, ${dia(sql`p.created_at`)} as fecha,
             case when p.shopify_order_id is null then 'chat' else 'web' end as origen,
             p.estado, p.total::float8 as total, p.ciudad, p.contact_id,
             (select coalesce(sum((i->>'cantidad')::int), 0) from jsonb_array_elements(p.items) i)::int as unidades,
             p.items->0->>'titulo' as producto,
             (select coalesce(c.metadata->>'ctwa_source_id', c.metadata->>'meta_ad_id')
                from conversations c
               where c.contact_id = p.contact_id
                 and coalesce(c.metadata->>'ctwa_source_id', c.metadata->>'meta_ad_id') is not null
               order by c.created_at desc limit 1) as ad_id
      from pedidos_ordenes p
      where p.created_at >= ${ini} and p.created_at < ${fin}
      order by p.created_at
      limit 1000`),
    filas(sql`
      select count(*)::int as n,
             coalesce(percentile_cont(0.5) within group (order by s), 0)::float8 as p50,
             coalesce(percentile_cont(0.95) within group (order by s), 0)::float8 as p95,
             coalesce(max(s), 0)::float8 as maximo,
             count(*) filter (where s > 60)::int as mayores_60s
      from (
        select extract(epoch from (created_at - sent_at)) as s
        from messages
        where direction = 'in' and sent_at is not null
          and created_at >= ${ini} and created_at < ${fin}
          and created_at - sent_at < interval '1 day'
      ) t`),
    filas(sql`
      select count(*)::int as n,
             coalesce(percentile_cont(0.5) within group (order by s), 0)::float8 as p50,
             coalesce(percentile_cont(0.95) within group (order by s), 0)::float8 as p95
      from (
        select extract(epoch from (r.created_at - m.created_at)) as s
        from messages m
        join lateral (
          select o.created_at from messages o
          where o.conversation_id = m.conversation_id and o.direction = 'out'
            and o.origin = 'agent' and o.created_at > m.created_at
            and o.created_at < m.created_at + interval '15 minutes'
          order by o.created_at limit 1
        ) r on true
        where m.direction = 'in' and m.created_at >= ${ini} and m.created_at < ${fin}
      ) t`),
    filas(sql`
      select count(*) filter (where status = 'failed')::int as fallidos,
             count(*) filter (where status = 'failed' and (error ilike '%429%' or error ilike '%quota%' or error ilike '%rate%limit%' or error ilike '%resource%exhausted%'))::int as errores_limite,
             count(*) filter (where status = 'pending' and process_after < now() - interval '10 minutes')::int as atascados,
             count(*)::int as total
      from agent_jobs where created_at >= ${ini} and created_at < ${fin}`),
    filas(sql`
      select count(*)::int as n from messages
      where direction = 'out' and status = 'failed' and created_at >= ${ini} and created_at < ${fin}`),
    filas(sql`
      select coalesce(event, '') as evento, status, count(*)::int as n
      from webhook_events where received_at >= ${ini} and received_at < ${fin}
      group by 1, 2`),
    filas(sql`
      select payload from webhook_events
      where event = 'comment.received' and received_at >= ${ini} and received_at < ${fin}
      order by received_at desc limit 200`),
    filas(sql`
      select id, channel as canal, participant_name as nombre, needs_human, ai_enabled,
             left(coalesce(last_message_body, ''), 80) as ultimo_mensaje,
             floor(extract(epoch from (now() - last_inbound_at)) / 60)::int as minutos
      from conversations
      where last_direction = 'in'
        and last_inbound_at < now() - interval '60 minutes'
        and last_inbound_at > now() - interval '48 hours'
      order by last_inbound_at
      limit 50`),
  ]);

  // ---- por dia ----
  const dias = new Map<string, Record<string, number | string>>();
  const fila = (fecha: unknown) => {
    const clave = String(fecha);
    if (!dias.has(clave)) {
      dias.set(clave, {
        fecha: clave,
        conversaciones_nuevas: 0,
        mensajes_entrantes: 0,
        respuestas_agente: 0,
        respuestas_humano: 0,
        plantillas: 0,
        derivados_humano: 0,
        pedidos_chat: 0,
        monto_chat: 0,
        pedidos_web: 0,
        monto_web: 0,
      });
    }
    return dias.get(clave)!;
  };
  const sumar = (f: Record<string, number | string>, k: string, v: number) => {
    f[k] = num(f[k]) + v;
  };

  const porCanal: Record<string, number> = {};
  for (const r of convPorDia) {
    sumar(fila(r.fecha), "conversaciones_nuevas", num(r.n));
    porCanal[String(r.canal)] = (porCanal[String(r.canal)] ?? 0) + num(r.n);
  }
  for (const r of msgPorDia) {
    const f = fila(r.fecha);
    if (r.direction === "in") sumar(f, "mensajes_entrantes", num(r.n));
    else if (r.origen === "agent") sumar(f, "respuestas_agente", num(r.n));
    else if (r.origen === "template") sumar(f, "plantillas", num(r.n));
    else if (r.origen === "human") sumar(f, "respuestas_humano", num(r.n));
  }
  for (const r of derivadosPorDia) sumar(fila(r.fecha), "derivados_humano", num(r.n));
  for (const r of pedidosPorDia) {
    const f = fila(r.fecha);
    sumar(f, `pedidos_${r.origen}`, num(r.n));
    sumar(f, `monto_${r.origen}`, num(r.monto));
  }

  // ---- por anuncio (chats que llegaron desde un anuncio de Meta) ----
  const porAnuncio = convAnuncio.map((r) => {
    const contactos = new Set((r.contactos as string[] | null) ?? []);
    const pedidos = pedidosLista.filter((p) => contactos.has(String(p.contact_id)));
    return {
      ad_id: String(r.ad_id),
      titular: r.titular ?? null,
      conversaciones: num(r.conversaciones),
      pedidos: pedidos.length,
      monto: pedidos.reduce((acc, p) => acc + num(p.total), 0),
    };
  });

  // ---- comentarios (comment.received de Zernio, aun sin respuesta automatica) ----
  const clasificados = comentarios.map((c) => {
    const texto = textoComentario(c.payload);
    const tipo = PALABRAS_QUEJA.test(texto) ? "queja" : PALABRAS_COMPRA.test(texto) ? "compra" : "otro";
    return { tipo, texto };
  });

  const d = demoraWebhook[0] ?? {};
  const a = respuestaAgente[0] ?? {};
  const j = jobs[0] ?? {};

  return {
    periodo: { desde, hasta, zona: ZONA },
    generado: new Date().toISOString(),
    por_dia: Array.from(dias.values()).sort((x, y) => String(x.fecha).localeCompare(String(y.fecha))),
    por_canal: porCanal,
    por_anuncio: porAnuncio,
    estados_pedido: Object.fromEntries(
      estados.map((r) => [String(r.estado), { n: num(r.n), monto: num(r.monto) }])
    ),
    pedidos: pedidosLista.map((p) => ({
      numero: p.numero_orden,
      fecha: p.fecha,
      origen: p.origen,
      estado: p.estado,
      total: num(p.total),
      unidades: num(p.unidades),
      producto: p.producto ?? null,
      ciudad: p.ciudad ?? null,
      ad_id: p.ad_id ?? null,
    })),
    comentarios: {
      total: clasificados.length,
      compra: clasificados.filter((c) => c.tipo === "compra").length,
      queja: clasificados.filter((c) => c.tipo === "queja").length,
      ejemplos: clasificados.filter((c) => c.tipo !== "otro").slice(0, 10),
    },
    salud: {
      demora_webhook_seg: {
        mensajes: num(d.n),
        p50: num(d.p50),
        p95: num(d.p95),
        maximo: num(d.maximo),
        mayores_60s: num(d.mayores_60s),
      },
      respuesta_agente_seg: { respondidos: num(a.n), p50: num(a.p50), p95: num(a.p95) },
      trabajos_agente: {
        total: num(j.total),
        fallidos: num(j.fallidos),
        errores_limite: num(j.errores_limite),
        atascados: num(j.atascados),
      },
      mensajes_salientes_fallidos: num(fallidos[0]?.n),
      eventos_webhook: eventos.map((r) => ({ evento: r.evento, estado: r.status, n: num(r.n) })),
    },
    sin_respuesta: sinRespuesta.map((r) => ({
      conversacion_id: r.id,
      canal: r.canal,
      nombre: primerNombre(r.nombre),
      minutos: num(r.minutos),
      derivado_humano: Boolean(r.needs_human),
      bot_activo: Boolean(r.ai_enabled),
      ultimo_mensaje: r.ultimo_mensaje,
    })),
  };
}
