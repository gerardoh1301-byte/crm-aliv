import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { varianteAB } from "@/lib/agent/guion-venta";

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

  // ---- formularios abandonados y rescate de chats (actividades con prefijo fijo) ----
  const seguimiento = await filas(sql`
    select
      count(*) filter (where description like '[ABANDONO] Capturado%')::int as capturados,
      count(*) filter (where description like '[ABANDONO] Paso 1 enviado%')::int as paso1,
      count(*) filter (where description like '[ABANDONO] Paso 2 enviado%')::int as paso2,
      count(*) filter (where description like '[ABANDONO] Respondió%')::int as respondieron,
      count(*) filter (where description like '[ABANDONO] Recuperado tras mensaje%')::int as recuperados_mensaje,
      count(*) filter (where description like '[ABANDONO] Recuperado por su cuenta%')::int as recuperados_solos,
      coalesce(sum(nullif(substring(description from 'Recuperado tras mensaje: pedido .* por S/ ([0-9.]+)'), '')::numeric), 0) as monto_recuperado,
      count(*) filter (where description like '[ABANDONO] Cerrado%')::int as cerrados,
      count(*) filter (where description like '[ABANDONO] Error%')::int as errores,
      count(*) filter (where description like '[RESCATE VENTAS] Mensaje enviado%')::int as rescate_toque1,
      count(*) filter (where description like '[RESCATE VENTAS] Segundo%')::int as rescate_toque2
    from activities
    where created_at >= ${ini} and created_at < ${fin}
      and (description like '[ABANDONO]%' or description like '[RESCATE VENTAS]%')`);
  const sg = seguimiento[0] ?? {};

  // ---- comentarios (comment.received de Zernio, aun sin respuesta automatica) ----
  const clasificados = comentarios.map((c) => {
    const texto = textoComentario(c.payload);
    const tipo = PALABRAS_QUEJA.test(texto) ? "queja" : PALABRAS_COMPRA.test(texto) ? "compra" : "otro";
    return { tipo, texto };
  });

  const embudo = await calcularEmbudoChat(ini, fin);

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
    formularios_abandonados: {
      capturados: num(sg.capturados),
      mensaje_30min: num(sg.paso1),
      mensaje_24h: num(sg.paso2),
      respondieron: num(sg.respondieron),
      recuperados_tras_mensaje: num(sg.recuperados_mensaje),
      recuperados_por_su_cuenta: num(sg.recuperados_solos),
      monto_recuperado: num(sg.monto_recuperado),
      cerrados_sin_compra: num(sg.cerrados),
      errores_envio: num(sg.errores),
    },
    embudo_chat: embudo,
    rescate_chats: {
      primer_toque: num(sg.rescate_toque1),
      segundo_toque: num(sg.rescate_toque2),
    },
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

/**
 * Embudo de los chats que empezaron en el rango (plan de entrenamiento del bot, paso 7):
 * cuántos recibieron respuesta del bot, cuántos siguieron después del primer mensaje,
 * a cuántos se les cotizó, a cuántos se les pidió datos y cuántos terminaron en pedido
 * (dentro de 7 días). Separado por variante de la prueba A/B del primer mensaje y por largo
 * del primer mensaje. Sin datos personales.
 */
async function calcularEmbudoChat(ini: ReturnType<typeof sql>, fin: ReturnType<typeof sql>) {
  const rows = await filas(sql`
    with conv as (
      select c.id, c.contact_id, c.created_at
      from conversations c
      where c.created_at >= ${ini} and c.created_at < ${fin} and c.provider <> 'simulador'
    ),
    base as (
      select conv.id, conv.contact_id,
        (select min(m.created_at) from messages m where m.conversation_id = conv.id and m.direction = 'in') as t_in,
        (select m.body from messages m where m.conversation_id = conv.id and m.direction = 'out'
           and m.origin = 'agent' order by m.created_at limit 1) as primer_bot,
        (select min(m.created_at) from messages m where m.conversation_id = conv.id and m.direction = 'out'
           and m.origin = 'agent') as t_bot
      from conv
    )
    select b.id,
      char_length(coalesce(b.primer_bot, '')) as largo_primer,
      (b.t_bot is not null) as bot_respondio,
      exists(select 1 from messages m where m.conversation_id = b.id and m.direction = 'in' and m.created_at > b.t_bot) as siguio,
      exists(select 1 from messages m where m.conversation_id = b.id and m.direction = 'out'
        and m.body ~* 'S/ ?(79|119|139|189|199)') as cotizado,
      exists(select 1 from messages m where m.conversation_id = b.id and m.direction = 'out'
        and m.body ~* '(direcci[oó]n|referencia|dni|adelanto de s/ ?20|agencia shalom)') as pidio_datos,
      exists(select 1 from pedidos_ordenes p where p.contact_id = b.contact_id
        and p.created_at >= b.t_in and p.created_at < b.t_in + interval '7 days') as pedido
    from base b
    where b.t_in is not null`);

  type Cuenta = { chats: number; bot_respondio: number; siguio: number; cotizado: number; pidio_datos: number; pedido: number };
  const vacia = (): Cuenta => ({ chats: 0, bot_respondio: 0, siguio: 0, cotizado: 0, pidio_datos: 0, pedido: 0 });
  const total = vacia();
  const porVariante: Record<string, Cuenta> = { A: vacia(), B: vacia() };
  const porLargo: Record<string, Cuenta> = { "hasta_350": vacia(), "351_a_700": vacia(), "mas_de_700": vacia() };
  for (const r of rows) {
    const largo = num(r.largo_primer);
    const grupos = [total, porVariante[varianteAB(String(r.id), "on")]];
    if (r.bot_respondio) grupos.push(porLargo[largo <= 350 ? "hasta_350" : largo <= 700 ? "351_a_700" : "mas_de_700"]);
    for (const g of grupos) {
      g.chats++;
      if (r.bot_respondio) g.bot_respondio++;
      if (r.siguio) g.siguio++;
      if (r.cotizado) g.cotizado++;
      if (r.pidio_datos) g.pidio_datos++;
      if (r.pedido) g.pedido++;
    }
  }
  const tasa = (c: Cuenta) => ({ ...c, conversion_pct: c.chats ? Math.round((c.pedido / c.chats) * 1000) / 10 : 0 });
  return {
    total: tasa(total),
    prueba_ab_primer_mensaje: {
      nota: "B = primer mensaje corto (≤ 350 caracteres). Vigente desde el despliegue del 19/11/2026; antes de esa fecha la división es solo de referencia. Con menos de ~150 chats por variante la diferencia no es concluyente.",
      A: tasa(porVariante.A),
      B: tasa(porVariante.B),
    },
    por_largo_primer_mensaje: Object.fromEntries(Object.entries(porLargo).map(([k, v]) => [k, tasa(v)])),
  };
}
