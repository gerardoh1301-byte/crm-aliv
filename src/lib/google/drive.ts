import "server-only";
import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { crmSettings } from "@/db/schema";

/**
 * Google Drive con la cuenta del dueño (OAuth, permiso `drive.file`: solo ve y crea los
 * archivos que crea el propio CRM, nunca el resto del Drive).
 *
 * Por qué OAuth y no cuenta de servicio: en una cuenta Gmail normal la cuenta de servicio no
 * tiene espacio propio y Google rechaza que cree archivos en el Drive del usuario.
 *
 * Variables: GOOGLE_DRIVE_CLIENT_ID y GOOGLE_DRIVE_CLIENT_SECRET (Render). El refresh token
 * se guarda en crm_settings al conectar desde /api/google/drive/conectar.
 */

const SCOPE = "https://www.googleapis.com/auth/drive.file";
const CLAVE_TOKEN = "google_drive_refresh_token";
const CLAVE_CUENTA = "google_drive_cuenta";
const CLAVE_CARPETA = "google_drive_carpeta_guias";
export const NOMBRE_CARPETA_GUIAS = "Guías Shalom (CRM)";

export function redirectUriDrive(): string {
  const base = (process.env.NEXT_PUBLIC_APP_URL || "https://crm-aliv.onrender.com").replace(/\/+$/, "");
  return process.env.GOOGLE_DRIVE_REDIRECT_URI || `${base}/api/google/drive/callback`;
}

function credenciales(): { id: string; secreto: string } | null {
  const id = (process.env.GOOGLE_DRIVE_CLIENT_ID ?? "").trim();
  const secreto = (process.env.GOOGLE_DRIVE_CLIENT_SECRET ?? "").trim();
  return id && secreto ? { id, secreto } : null;
}

export function driveConfigurado(): boolean {
  return credenciales() !== null;
}

async function leer(key: string): Promise<string | null> {
  const [r] = await db.select({ value: crmSettings.value }).from(crmSettings).where(eq(crmSettings.key, key)).limit(1);
  return r?.value ?? null;
}

async function guardar(key: string, value: string) {
  await db.insert(crmSettings).values({ key, value }).onConflictDoUpdate({ target: crmSettings.key, set: { value } });
}

export function nuevoEstadoOAuth(): string {
  return crypto.randomBytes(24).toString("hex");
}

export function urlAutorizacion(estado: string): string {
  const c = credenciales();
  if (!c) throw new Error("Faltan GOOGLE_DRIVE_CLIENT_ID / GOOGLE_DRIVE_CLIENT_SECRET");
  const p = new URLSearchParams({
    client_id: c.id,
    redirect_uri: redirectUriDrive(),
    response_type: "code",
    scope: SCOPE,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state: estado,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
}

/** Cambia el código de Google por el refresh token y lo guarda. Devuelve el correo de la cuenta. */
export async function completarConexion(code: string): Promise<{ cuenta: string | null }> {
  const c = credenciales();
  if (!c) throw new Error("Faltan GOOGLE_DRIVE_CLIENT_ID / GOOGLE_DRIVE_CLIENT_SECRET");
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: c.id,
      client_secret: c.secreto,
      redirect_uri: redirectUriDrive(),
      grant_type: "authorization_code",
    }),
    signal: AbortSignal.timeout(10_000),
  });
  const j = (await res.json().catch(() => ({}))) as { refresh_token?: string; access_token?: string; error?: string; error_description?: string };
  if (!res.ok || !j.access_token) throw new Error(`Google rechazó la conexión: ${j.error_description || j.error || res.status}`);
  if (!j.refresh_token) throw new Error("Google no devolvió el permiso permanente; vuelve a conectar.");
  await guardar(CLAVE_TOKEN, j.refresh_token);
  accessCache = { token: j.access_token, hasta: Date.now() + 50 * 60_000 };
  const cuenta = await cuentaConectadaDesdeGoogle(j.access_token);
  if (cuenta) await guardar(CLAVE_CUENTA, cuenta);
  return { cuenta };
}

async function cuentaConectadaDesdeGoogle(token: string): Promise<string | null> {
  const r = await fetch("https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)", {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(8_000),
  }).catch(() => null);
  if (!r?.ok) return null;
  const j = (await r.json().catch(() => null)) as { user?: { emailAddress?: string } } | null;
  return j?.user?.emailAddress ?? null;
}

export async function estadoDrive(): Promise<{ configurado: boolean; conectado: boolean; cuenta: string | null }> {
  if (!driveConfigurado()) return { configurado: false, conectado: false, cuenta: null };
  const [token, cuenta] = await Promise.all([leer(CLAVE_TOKEN), leer(CLAVE_CUENTA)]);
  return { configurado: true, conectado: Boolean(token), cuenta };
}

let accessCache: { token: string; hasta: number } | null = null;

async function accessToken(): Promise<string> {
  if (accessCache && accessCache.hasta > Date.now()) return accessCache.token;
  const c = credenciales();
  if (!c) throw new Error("Drive sin configurar (faltan variables en Render)");
  const refresh = await leer(CLAVE_TOKEN);
  if (!refresh) throw new Error("Drive no está conectado: un administrador debe tocar «Conectar Drive».");
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: c.id, client_secret: c.secreto, refresh_token: refresh, grant_type: "refresh_token" }),
    signal: AbortSignal.timeout(10_000),
  });
  const j = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string };
  if (!res.ok || !j.access_token) {
    throw new Error(j.error === "invalid_grant" ? "El permiso de Drive venció o se revocó: vuelve a «Conectar Drive»." : `Drive: ${j.error || res.status}`);
  }
  accessCache = { token: j.access_token, hasta: Date.now() + Math.max(60, (j.expires_in ?? 3600) - 300) * 1000 };
  return j.access_token;
}

async function api(path: string, init: RequestInit = {}): Promise<Response> {
  const token = await accessToken();
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  return fetch(`https://www.googleapis.com${path}`, { ...init, headers, signal: AbortSignal.timeout(20_000) });
}

/** Carpeta «Guías Shalom (CRM)» (la crea el CRM la primera vez). */
export async function carpetaGuias(): Promise<string> {
  const guardada = await leer(CLAVE_CARPETA);
  if (guardada) {
    const r = await api(`/drive/v3/files/${guardada}?fields=id,trashed`);
    const j = r.ok ? ((await r.json()) as { trashed?: boolean }) : null;
    if (j && !j.trashed) return guardada;
  }
  const r = await api("/drive/v3/files?fields=id", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: NOMBRE_CARPETA_GUIAS, mimeType: "application/vnd.google-apps.folder" }),
  });
  if (!r.ok) throw new Error(`No se pudo crear la carpeta en Drive (${r.status})`);
  const { id } = (await r.json()) as { id: string };
  await guardar(CLAVE_CARPETA, id);
  return id;
}

export interface ArchivoDrive {
  id: string;
  webViewLink: string | null;
}

export async function subirArchivo(params: { nombre: string; mime: string; datos: Buffer | Uint8Array; carpetaId: string }): Promise<ArchivoDrive> {
  const limite = `aliv${crypto.randomBytes(8).toString("hex")}`;
  const meta = JSON.stringify({ name: params.nombre, parents: [params.carpetaId] });
  const cuerpo = Buffer.concat([
    Buffer.from(`--${limite}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${limite}\r\nContent-Type: ${params.mime}\r\n\r\n`),
    Buffer.from(params.datos),
    Buffer.from(`\r\n--${limite}--`),
  ]);
  const r = await api("/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink", {
    method: "POST",
    headers: { "Content-Type": `multipart/related; boundary=${limite}` },
    body: cuerpo,
  });
  if (!r.ok) throw new Error(`Drive rechazó el archivo (${r.status}): ${(await r.text()).slice(0, 200)}`);
  const j = (await r.json()) as { id: string; webViewLink?: string };
  return { id: j.id, webViewLink: j.webViewLink ?? null };
}

export async function descargarArchivo(id: string): Promise<{ datos: Buffer; mime: string } | null> {
  const r = await api(`/drive/v3/files/${encodeURIComponent(id)}?alt=media`);
  if (!r.ok) return null;
  return { datos: Buffer.from(await r.arrayBuffer()), mime: r.headers.get("content-type") || "application/octet-stream" };
}
