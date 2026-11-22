/**
 * Mantiene despierto el CRM en el plan gratis de Render.
 *
 * Render apaga la instancia gratis tras ~15 min sin tráfico ENTRANTE, y mientras duerme
 * los webhooks de WhatsApp (Zernio) se pierden: el 22/11 el mensaje de Gerardo de las
 * 10:36 nunca llegó. Los barridos llaman a 127.0.0.1 y eso no cuenta como tráfico, así
 * que aquí el proceso se llama a sí mismo por la URL PÚBLICA cada 10 min.
 *
 * Render define RENDER_EXTERNAL_URL solo; en otro host no hace nada. Se apaga con
 * MANTENER_DESPIERTO=off (por ejemplo, si se pasa al plan Starter).
 */

declare global {
  var __builderDespierto: ReturnType<typeof setInterval> | undefined;
}

export const MINUTOS_PING = 10;

export function urlPing(env: Record<string, string | undefined> = process.env): string | null {
  if ((env.MANTENER_DESPIERTO || "").toLowerCase() === "off") return null;
  const base = (env.RENDER_EXTERNAL_URL || "").trim().replace(/\/+$/, "");
  if (!/^https:\/\//.test(base)) return null;
  return `${base}/api/health`;
}

export function iniciarMantenerDespierto() {
  if (globalThis.__builderDespierto) return;
  const url = urlPing();
  if (!url) return;

  const ping = async () => {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(30_000), cache: "no-store" });
      if (!res.ok) console.warn(`[despierto] ${url} -> ${res.status}`);
    } catch (err) {
      console.warn("[despierto] ping falló:", err instanceof Error ? err.message : err);
    }
  };

  globalThis.__builderDespierto = setInterval(ping, MINUTOS_PING * 60_000);
  globalThis.__builderDespierto.unref?.();
  console.log(`[despierto] ping a ${url} cada ${MINUTOS_PING} min`);
}
