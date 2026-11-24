import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

/**
 * Prueba la clave de OpenRouter (el respaldo de la IA) sin mostrarla: consulta /key (gratis)
 * y hace una llamada mínima. Solo administradores. Devuelve estados y saldo, nunca la clave.
 */
export async function GET() {
  const auth = await requireAdmin();
  if ("response" in auth) return auth.response;

  const clave = (process.env.OPENROUTER_API_KEY ?? "").trim();
  if (!clave) return NextResponse.json({ ok: false, error: "OPENROUTER_API_KEY no está cargada en Render" });

  const headers = { Authorization: `Bearer ${clave}`, "Content-Type": "application/json" };
  const info = await fetch("https://openrouter.ai/api/v1/key", { headers, signal: AbortSignal.timeout(10_000) })
    .then(async (r) => ({ status: r.status, j: (await r.json().catch(() => null)) as Record<string, unknown> | null }))
    .catch((e) => ({ status: 0, j: { error: e instanceof Error ? e.message : String(e) } as Record<string, unknown> }));
  const datos = (info.j?.data ?? null) as { label?: string; usage?: number; limit?: number | null; limit_remaining?: number | null; is_free_tier?: boolean } | null;

  const modelo = (process.env.OPENROUTER_MODELS || "google/gemini-2.5-flash").split(",")[0].trim();
  const prueba = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers,
    body: JSON.stringify({ model: modelo, messages: [{ role: "user", content: "Responde solo: ok" }], max_tokens: 5 }),
    signal: AbortSignal.timeout(20_000),
  })
    .then(async (r) => {
      const j = (await r.json().catch(() => null)) as { choices?: { message?: { content?: string } }[]; error?: { message?: string } } | null;
      return { status: r.status, respuesta: j?.choices?.[0]?.message?.content ?? null, error: j?.error?.message ?? null };
    })
    .catch((e) => ({ status: 0, respuesta: null, error: e instanceof Error ? e.message : String(e) }));

  return NextResponse.json({
    ok: info.status === 200 && prueba.status === 200,
    clave: {
      status: info.status,
      etiqueta: datos?.label ? `${String(datos.label).slice(0, 12)}…` : null,
      gastado: datos?.usage ?? null,
      limite: datos?.limit ?? null,
      restante: datos?.limit_remaining ?? null,
      planGratis: datos?.is_free_tier ?? null,
      error: info.status === 200 ? null : (info.j?.error as { message?: string } | undefined)?.message ?? info.j?.error ?? null,
    },
    prueba: { modelo, ...prueba },
  });
}
