import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { createChatCompletionWithFallback, getAgentModel, hasOpenRouterKey } from "@/lib/agent/openrouter";
import { notificarSupervisoresCritico } from "@/lib/alerts/supervisor-alerts";
import {
  type CategoriaComentario,
  clasificarSinIA,
  esCategoria,
  linkWhatsapp,
  mensajePrivado,
  planPara,
  primerNombre,
  respuestaRespaldo,
  sanearRespuesta,
  WHATSAPP_VENTAS_DEFAULT,
} from "./reglas";
import {
  type ComentarioMeta,
  comentariosFacebook,
  comentariosInstagram,
  eliminarComentario,
  metaComentariosConfig,
  ocultarComentario,
  responderComentario,
  respuestaPrivada,
} from "./meta-graph";

/**
 * Moderador automático de comentarios (lo llama barridos.ts). Con COMENTARIOS_MODERACION=on
 * actúa en Facebook e Instagram; con cualquier otro valor solo clasifica y registra
 * lo que haría (modo prueba), sin tocar nada.
 */
export function moderacionActiva(): boolean {
  return (process.env.COMENTARIOS_MODERACION ?? "").trim().toLowerCase() === "on";
}

/** Comentarios más viejos que esto no se tocan (evita contestar el historial entero el primer día). */
function maxHoras(): number {
  const n = Number(process.env.COMENTARIOS_MAX_HORAS);
  return Number.isFinite(n) && n > 0 ? n : 72;
}

function waVentas(): string {
  return linkWhatsapp((process.env.COMENTARIOS_WHATSAPP ?? "").trim() || WHATSAPP_VENTAS_DEFAULT);
}

export interface DetalleModeracion {
  id: string;
  plataforma: string;
  autor: string | null;
  texto: string;
  categoria: CategoriaComentario;
  accion: string;
  respuesta?: string | null;
  privado?: boolean;
  error?: string;
}

export interface ResultadoModeracion {
  activo: boolean;
  configurado: boolean;
  leidos: number;
  nuevos: number;
  detalles: DetalleModeracion[];
  errores: string[];
}

declare global {
  var __moderandoComentarios: boolean | undefined;
}

export async function moderarComentarios(
  opts: { limite?: number; /** Solo en modo prueba: mirar más atrás para revisar la clasificación. */ horasPrueba?: number } = {}
): Promise<ResultadoModeracion> {
  const activo = moderacionActiva();
  const cfg = metaComentariosConfig();
  const res: ResultadoModeracion = {
    activo,
    configurado: !!(cfg.token && (cfg.pageId || cfg.igUserId)),
    leidos: 0,
    nuevos: 0,
    detalles: [],
    errores: [],
  };
  if (!res.configurado) {
    res.errores.push("Faltan META_PAGE_TOKEN y META_PAGE_ID / META_IG_USER_ID");
    return res;
  }
  if (globalThis.__moderandoComentarios) {
    res.errores.push("ya hay una vuelta en curso");
    return res;
  }
  globalThis.__moderandoComentarios = true;
  try {
    const [fb, ig] = await Promise.all([
      cfg.pageId ? comentariosFacebook() : Promise.resolve({ comentarios: [], errores: [] }),
      cfg.igUserId ? comentariosInstagram() : Promise.resolve({ comentarios: [], errores: [] }),
    ]);
    res.errores.push(...fb.errores, ...ig.errores);
    const todos = [...fb.comentarios, ...ig.comentarios];
    res.leidos = todos.length;

    const horas = !activo && opts.horasPrueba ? opts.horasPrueba : maxHoras();
    const desde = Date.now() - horas * 3600_000;
    const candidatos = todos.filter(
      (c) =>
        c.creado.getTime() >= desde &&
        !c.oculto &&
        c.texto.trim().length > 0 &&
        c.autorId !== cfg.pageId &&
        c.autorId !== cfg.igUserId
    );
    const ya = await yaProcesados(candidatos.map((c) => c.id));
    const nuevos = candidatos
      .filter((c) => !ya.has(c.id))
      .sort((a, b) => a.creado.getTime() - b.creado.getTime())
      .slice(0, opts.limite ?? 30);
    res.nuevos = nuevos.length;
    if (nuevos.length === 0) return res;

    const clasif = await clasificarConIA(nuevos);
    const wa = waVentas();

    for (const c of nuevos) {
      const ia = clasif.get(c.id);
      const categoria = ia?.categoria ?? clasificarSinIA(c.texto);
      const plan = planPara(categoria, c.esRespuesta);
      const nombre = primerNombre(c.autorNombre);
      let accion: string = plan.publico;
      let respuesta: string | null = null;
      let privadoOk = false;
      const errores: string[] = [];

      // Si la página ya contestó a mano en el hilo, no se duplica la respuesta.
      if (plan.publico === "responder" && c.yaRespondido) accion = "ninguna (ya respondido)";

      if (accion === "responder") {
        const cat = categoria === "positivo" ? "positivo" : "interes";
        respuesta = sanearRespuesta(ia?.respuesta, wa) ?? respuestaRespaldo(cat, c.id, nombre, wa);
      }

      if (activo) {
        try {
          if (accion === "responder" && respuesta) await responderComentario(c, respuesta);
          else if (accion === "ocultar") await ocultarComentario(c);
          else if (accion === "eliminar") await eliminarComentario(c);
        } catch (err) {
          errores.push(`${accion}: ${err instanceof Error ? err.message : String(err)}`);
          // Si no se pudo eliminar, al menos se oculta.
          if (accion === "eliminar") {
            try {
              await ocultarComentario(c);
              accion = "ocultar (no se pudo eliminar)";
            } catch {
              /* queda el error */
            }
          }
        }
        if (plan.privado && !c.yaRespondido) {
          try {
            await respuestaPrivada(c, mensajePrivado(nombre, wa));
            privadoOk = true;
          } catch (err) {
            errores.push(`privado: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
        if (plan.avisar) {
          await notificarSupervisoresCritico({
            tipo: "comentario_queja",
            titulo: "Queja en comentarios",
            detalle:
              `${c.plataforma === "instagram" ? "Instagram" : "Facebook"}${c.esAnuncio ? " (anuncio)" : ""}: «${c.texto.slice(0, 280)}». ` +
              `Lo oculté; búscalo y escríbele para resolverlo.`,
            clienteNombre: c.autorNombre,
            clienteTelefono: null,
          }).catch((e) => errores.push(`aviso: ${e instanceof Error ? e.message : String(e)}`));
        }
      }

      const detalle: DetalleModeracion = {
        id: c.id,
        plataforma: c.plataforma,
        autor: c.autorNombre,
        texto: c.texto.slice(0, 200),
        categoria,
        accion,
        respuesta,
        privado: plan.privado ? (activo ? privadoOk : true) : false,
        ...(errores.length ? { error: errores.join(" | ") } : {}),
      };
      res.detalles.push(detalle);
      // En modo prueba no se guarda: así, al activarlo, actúa sobre los mismos comentarios.
      if (activo) await guardar(c, detalle);
    }
    return res;
  } finally {
    globalThis.__moderandoComentarios = false;
  }
}

async function yaProcesados(ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const lista = sql.join(
    ids.map((id) => sql`${id}`),
    sql`, `
  );
  const rows = (await db.execute(
    sql`select comment_id from comentarios_moderados where comment_id in (${lista})`
  )) as unknown as Array<{ comment_id: string }>;
  return new Set(Array.from(rows, (r) => r.comment_id));
}

async function guardar(c: ComentarioMeta, d: DetalleModeracion): Promise<void> {
  try {
    await db.execute(sql`
      insert into comentarios_moderados
        (comment_id, plataforma, post_id, es_anuncio, autor_id, autor_nombre, texto, categoria, accion, respuesta, privado, modo, error, comentado_en)
      values
        (${c.id}, ${c.plataforma}, ${c.postId}, ${c.esAnuncio}, ${c.autorId}, ${c.autorNombre}, ${c.texto},
         ${d.categoria}, ${d.accion}, ${d.respuesta ?? null}, ${!!d.privado}, 'auto', ${d.error ?? null}, ${c.creado.toISOString()})
      on conflict (comment_id) do nothing
    `);
  } catch (err) {
    console.warn("[comentarios] no se pudo guardar", c.id, err);
  }
}

interface ClasificacionIA {
  categoria: CategoriaComentario;
  respuesta: string | null;
}

async function clasificarConIA(comentarios: ComentarioMeta[]): Promise<Map<string, ClasificacionIA>> {
  const out = new Map<string, ClasificacionIA>();
  if (!hasOpenRouterKey() || comentarios.length === 0) return out;
  const items = comentarios.map((c, i) => ({
    i,
    red: c.plataforma,
    anuncio: c.esAnuncio,
    publicacion: c.postTexto.slice(0, 160),
    autor: primerNombre(c.autorNombre) || null,
    comentario: c.texto.slice(0, 400),
  }));

  const prompt = `Eres el community manager de Aliv Perú (tienda online peruana). Vendemos NAC600 (N-acetilcisteína 600 mg + NAD+, 60 cápsulas, complemento alimenticio) y la tobillera Termix (calor y masaje).
Condiciones: envío gratis a todo el Perú; en Lima y Callao se paga al recibir (efectivo, Yape o Plin); a provincia va por agencia Shalom u Olva; garantía de 30 días.

Clasifica cada comentario en UNA categoría:
- "interes": pregunta precio, envío, cómo comprar, si llega a su ciudad, cómo se toma, pide info, "dm", "quiero".
- "positivo": elogio, testimonio, agradecimiento, recomienda el producto.
- "queja": cliente real con un problema de su pedido (no llegó, cobro, demora, devolución, mala atención).
- "negativo": ataque o desprestigio sin pedido de por medio: "estafa", "no sirve", "es mentira", insultos, burlas, competencia ofreciendo lo suyo, debate médico agresivo.
- "spam": links ajenos, ofertas de dinero/inversión, bots, cuentas promocionando otra cosa.
- "neutro": solo etiqueta a amigos, emojis sueltos, comentarios sin relación que no dañan.
Ante la duda entre negativo y queja, elige "queja". Ante la duda entre interes y neutro, elige "interes".

Para "interes" y "positivo" escribe "respuesta": 1 o 2 frases cortas y cálidas, en español peruano neutro, con 1 emoji, tuteando, con el nombre del autor si lo hay. Responde lo que preguntó si está en las condiciones de arriba; NO des precios (cambian por promoción), di que por WhatsApp le pasan precios y promociones. Termina invitando a escribir por WhatsApp. NO pongas links ni números (los agrega el sistema). Varía las palabras entre comentarios.
Salud (obligatorio): nunca digas que cura, desintoxica, elimina o adelgaza; es un complemento que apoya a tu cuerpo. Si menciona enfermedad, embarazo o medicamentos, sugiere consultarlo con su médico y que por WhatsApp le orientamos.
Para las demás categorías "respuesta" es null.

Comentarios (JSON):
${JSON.stringify(items)}

Responde SOLO un JSON: {"resultados":[{"i":0,"categoria":"interes","respuesta":"..."}]}`;

  try {
    const completion = await createChatCompletionWithFallback(
      {
        model: getAgentModel(),
        messages: [
          { role: "system", content: "Responde únicamente en formato JSON válido sin markdown ni texto extra." },
          { role: "user", content: prompt },
        ],
        temperature: 0.4,
        response_format: { type: "json_object" },
      },
      { origen: "comentarios" }
    );
    const contenido = completion.choices[0]?.message?.content?.trim() ?? "";
    const data = JSON.parse(contenido.replace(/^```(json)?|```$/g, "")) as {
      resultados?: Array<{ i?: number; categoria?: unknown; respuesta?: unknown }>;
    };
    for (const r of data.resultados ?? []) {
      const c = typeof r.i === "number" ? comentarios[r.i] : undefined;
      if (!c || !esCategoria(r.categoria)) continue;
      out.set(c.id, { categoria: r.categoria, respuesta: typeof r.respuesta === "string" ? r.respuesta : null });
    }
  } catch (err) {
    console.warn("[comentarios] IA no disponible, uso reglas fijas:", err instanceof Error ? err.message : err);
  }
  return out;
}

/** Conteo del día (hora de Lima) para el resumen de las 22:00. */
export async function resumenComentariosHoy(): Promise<Record<string, number>> {
  try {
    const rows = (await db.execute(sql`
      select categoria, count(*)::int as n from comentarios_moderados
      where (procesado_en at time zone 'America/Lima')::date = (now() at time zone 'America/Lima')::date
      group by categoria
    `)) as unknown as Array<{ categoria: string; n: number }>;
    return Object.fromEntries(Array.from(rows, (r) => [r.categoria, r.n]));
  } catch {
    return {};
  }
}
