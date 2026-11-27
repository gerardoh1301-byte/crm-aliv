import "server-only";

/**
 * Cliente mínimo de la Graph API de Meta para los comentarios de la página Aliv Perú
 * y su Instagram (incluye los anuncios). Usa el token de la página (META_PAGE_TOKEN),
 * que sale de un usuario del sistema del Business Manager y no vence.
 *
 * Permisos del token: pages_show_list, pages_read_engagement, pages_read_user_content,
 * pages_manage_engagement, pages_messaging, instagram_basic, instagram_manage_comments,
 * instagram_manage_messages, ads_read (este último solo para los comentarios de anuncios
 * de Instagram).
 */

const VERSION = process.env.META_GRAPH_VERSION || "v21.0";
const BASE = `https://graph.facebook.com/${VERSION}`;

export function metaComentariosConfig() {
  return {
    token: (process.env.META_PAGE_TOKEN ?? "").trim(),
    pageId: (process.env.META_PAGE_ID ?? "").trim(),
    igUserId: (process.env.META_IG_USER_ID ?? "").trim(),
    adAccountId: (process.env.META_AD_ACCOUNT_ID ?? "").trim().replace(/^act_/, ""),
  };
}

export class GraphError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: number,
    public subcode?: number
  ) {
    super(message);
  }
}

declare global {
  var __metaTokenPagina: { base: string; token: string } | undefined;
}

/**
 * META_PAGE_TOKEN puede ser el token del usuario del sistema: con él se pide el token de
 * la página (que es el que permite responder, ocultar y mandar privados) y se guarda en
 * memoria. Si ya es un token de página, la consulta falla y se usa tal cual.
 */
async function tokenPagina(): Promise<string> {
  const { token, pageId } = metaComentariosConfig();
  if (!token) throw new GraphError("Falta META_PAGE_TOKEN", 0);
  const cache = globalThis.__metaTokenPagina;
  if (cache && cache.base === token) return cache.token;
  let final = token;
  if (pageId) {
    try {
      const r = await graph<{ access_token?: string }>(pageId, { params: { fields: "access_token" }, usar: "base" });
      if (r.access_token) final = r.access_token;
    } catch {
      /* ya era token de página */
    }
  }
  globalThis.__metaTokenPagina = { base: token, token: final };
  return final;
}

async function graph<T>(
  path: string,
  init: {
    method?: "GET" | "POST" | "DELETE";
    params?: Record<string, string>;
    body?: unknown;
    /** "base": el token tal cual (anuncios); "pagina" (default): el de la página. */
    usar?: "base" | "pagina";
  } = {}
): Promise<T> {
  const base = metaComentariosConfig().token;
  if (!base) throw new GraphError("Falta META_PAGE_TOKEN", 0);
  const token = init.usar === "base" ? base : await tokenPagina();
  const url = new URL(`${BASE}/${path.replace(/^\//, "")}`);
  for (const [k, v] of Object.entries(init.params ?? {})) url.searchParams.set(k, v);
  const res = await fetch(url, {
    method: init.method ?? "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(20_000),
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* no JSON */
  }
  if (!res.ok) {
    const e = (json as { error?: { message?: string; code?: number; error_subcode?: number } } | null)?.error;
    throw new GraphError(e?.message ?? `HTTP ${res.status}`, res.status, e?.code, e?.error_subcode);
  }
  return json as T;
}

/** Comentario normalizado de cualquiera de las dos redes. */
export interface ComentarioMeta {
  id: string;
  plataforma: "facebook" | "instagram";
  postId: string;
  /** Texto del post o anuncio (para dar contexto a la IA). */
  postTexto: string;
  esAnuncio: boolean;
  texto: string;
  autorId: string | null;
  autorNombre: string | null;
  creado: Date;
  oculto: boolean;
  esRespuesta: boolean;
  /** La página ya contestó dentro del hilo (a mano o antes). */
  yaRespondido: boolean;
}

interface FbFrom {
  id?: string;
  name?: string;
}
interface FbComment {
  id: string;
  message?: string;
  from?: FbFrom;
  created_time: string;
  is_hidden?: boolean;
  parent?: { id?: string };
  comments?: { data?: Array<{ from?: FbFrom }> };
}
interface FbPost {
  id: string;
  message?: string;
  comments?: { data?: FbComment[] };
}

const CAMPOS_FB_COMENTARIO = "id,message,from,created_time,is_hidden,parent{id},comments.limit(10){from}";

function campoPostsFb(limiteComentarios: number): string {
  return `id,message,comments.filter(stream).order(reverse_chronological).limit(${limiteComentarios}){${CAMPOS_FB_COMENTARIO}}`;
}

function normalizarFb(post: FbPost, esAnuncio: boolean, pageId: string): ComentarioMeta[] {
  return (post.comments?.data ?? []).map((c) => ({
    id: c.id,
    plataforma: "facebook" as const,
    postId: post.id,
    postTexto: (post.message ?? "").slice(0, 300),
    esAnuncio,
    texto: c.message ?? "",
    autorId: c.from?.id ?? null,
    autorNombre: c.from?.name ?? null,
    creado: new Date(c.created_time),
    oculto: !!c.is_hidden,
    esRespuesta: !!c.parent?.id,
    yaRespondido: (c.comments?.data ?? []).some((r) => r.from?.id === pageId),
  }));
}

/** Comentarios recientes de la página: posts del muro y posts de anuncios (dark posts). */
export async function comentariosFacebook(opts: { posts?: number; porPost?: number } = {}): Promise<{
  comentarios: ComentarioMeta[];
  errores: string[];
}> {
  const { pageId } = metaComentariosConfig();
  const errores: string[] = [];
  const out: ComentarioMeta[] = [];
  if (!pageId) return { comentarios: out, errores: ["Falta META_PAGE_ID"] };
  const fields = campoPostsFb(opts.porPost ?? 25);
  const fuentes: Array<{ edge: string; esAnuncio: boolean }> = [
    { edge: "feed", esAnuncio: false },
    { edge: "ads_posts", esAnuncio: true },
  ];
  for (const f of fuentes) {
    try {
      const res = await graph<{ data?: FbPost[] }>(`${pageId}/${f.edge}`, {
        params: { fields, limit: String(opts.posts ?? 25) },
      });
      for (const p of res.data ?? []) out.push(...normalizarFb(p, f.esAnuncio, pageId));
    } catch (err) {
      errores.push(`facebook ${f.edge}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  // Un post impulsado aparece en feed y en ads_posts: un comentario una sola vez.
  const vistos = new Set<string>();
  return {
    comentarios: out.filter((c) => (vistos.has(c.id) ? false : (vistos.add(c.id), true))),
    errores,
  };
}

interface IgComment {
  id: string;
  text?: string;
  username?: string;
  from?: { id?: string; username?: string };
  timestamp: string;
  hidden?: boolean;
  replies?: { data?: Array<{ username?: string; from?: { id?: string } }> };
}
interface IgMedia {
  id: string;
  caption?: string;
  comments?: { data?: IgComment[] };
}

const CAMPOS_IG_COMENTARIO = "id,text,username,from,timestamp,hidden,replies.limit(10){username,from}";

function normalizarIg(media: IgMedia, esAnuncio: boolean, igUserId: string): ComentarioMeta[] {
  return (media.comments?.data ?? []).map((c) => ({
    id: c.id,
    plataforma: "instagram" as const,
    postId: media.id,
    postTexto: (media.caption ?? "").slice(0, 300),
    esAnuncio,
    texto: c.text ?? "",
    autorId: c.from?.id ?? null,
    autorNombre: c.username ?? c.from?.username ?? null,
    creado: new Date(c.timestamp),
    oculto: !!c.hidden,
    esRespuesta: false,
    yaRespondido: (c.replies?.data ?? []).some((r) => r.from?.id === igUserId),
  }));
}

/** Comentarios recientes del Instagram: publicaciones del perfil y anuncios activos. */
export async function comentariosInstagram(opts: { posts?: number; porPost?: number } = {}): Promise<{
  comentarios: ComentarioMeta[];
  errores: string[];
}> {
  const { igUserId, adAccountId } = metaComentariosConfig();
  const errores: string[] = [];
  const out: ComentarioMeta[] = [];
  if (!igUserId) return { comentarios: out, errores: ["Falta META_IG_USER_ID"] };
  const porPost = opts.porPost ?? 25;
  const camposMedia = `id,caption,comments.limit(${porPost}){${CAMPOS_IG_COMENTARIO}}`;
  try {
    const res = await graph<{ data?: IgMedia[] }>(`${igUserId}/media`, {
      params: { fields: camposMedia, limit: String(opts.posts ?? 20) },
    });
    for (const m of res.data ?? []) out.push(...normalizarIg(m, false, igUserId));
  } catch (err) {
    errores.push(`instagram media: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Los anuncios de Instagram no salen en /media: se llega por el creativo de cada anuncio activo.
  if (adAccountId) {
    try {
      const ads = await graph<{ data?: Array<{ creative?: { effective_instagram_media_id?: string } }> }>(
        `act_${adAccountId}/ads`,
        {
          usar: "base",
          params: {
            fields: "creative{effective_instagram_media_id}",
            effective_status: JSON.stringify(["ACTIVE"]),
            limit: "100",
          },
        }
      );
      const ids = [
        ...new Set((ads.data ?? []).map((a) => a.creative?.effective_instagram_media_id).filter((x): x is string => !!x)),
      ];
      for (const id of ids) {
        try {
          const m = await graph<IgMedia>(id, { params: { fields: camposMedia } });
          out.push(...normalizarIg(m, true, igUserId));
        } catch (err) {
          errores.push(`instagram anuncio ${id}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    } catch (err) {
      errores.push(`instagram anuncios: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  const vistos = new Set<string>();
  return {
    comentarios: out.filter((c) => (vistos.has(c.id) ? false : (vistos.add(c.id), true))),
    errores,
  };
}

// ---------------------------------------------------------------- acciones

export async function responderComentario(c: Pick<ComentarioMeta, "id" | "plataforma">, mensaje: string): Promise<string | null> {
  const edge = c.plataforma === "instagram" ? "replies" : "comments";
  const res = await graph<{ id?: string }>(`${c.id}/${edge}`, { method: "POST", params: { message: mensaje } });
  return res.id ?? null;
}

export async function ocultarComentario(c: Pick<ComentarioMeta, "id" | "plataforma">): Promise<void> {
  const params: Record<string, string> = c.plataforma === "instagram" ? { hide: "true" } : { is_hidden: "true" };
  await graph(c.id, { method: "POST", params });
}

export async function eliminarComentario(c: Pick<ComentarioMeta, "id">): Promise<void> {
  await graph(c.id, { method: "DELETE" });
}

/** Mensaje privado al autor del comentario (una sola vez por comentario, hasta 7 días). */
export async function respuestaPrivada(c: Pick<ComentarioMeta, "id" | "plataforma">, mensaje: string): Promise<void> {
  const { pageId, igUserId } = metaComentariosConfig();
  const origen = c.plataforma === "instagram" ? igUserId : pageId;
  await graph(`${origen}/messages`, {
    method: "POST",
    body: { recipient: { comment_id: c.id }, message: { text: mensaje } },
  });
}

/** Para la prueba de conexión: quién es el token y qué cuentas ve. */
export async function diagnosticoMeta(): Promise<Record<string, unknown>> {
  const { pageId, igUserId, adAccountId } = metaComentariosConfig();
  const out: Record<string, unknown> = { pageId, igUserId, adAccountId: adAccountId || null };
  const probar = async (k: string, fn: () => Promise<unknown>) => {
    try {
      out[k] = await fn();
    } catch (err) {
      out[k] = { error: err instanceof Error ? err.message : String(err) };
    }
  };
  await probar("pagina", () => graph(pageId, { params: { fields: "id,name,instagram_business_account" } }));
  if (igUserId) await probar("instagram", () => graph(igUserId, { params: { fields: "id,username" } }));
  return out;
}
