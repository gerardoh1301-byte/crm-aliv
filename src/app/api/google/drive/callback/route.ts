import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api-auth";
import { completarConexion, NOMBRE_CARPETA_GUIAS, carpetaGuias } from "@/lib/google/drive";

export const dynamic = "force-dynamic";

function pagina(titulo: string, detalle: string, ok: boolean) {
  const html = `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${titulo}</title><body style="font-family:system-ui;max-width:520px;margin:48px auto;padding:0 16px;color:#1f2937">
<h2 style="color:${ok ? "#15803d" : "#b91c1c"}">${titulo}</h2><p>${detalle}</p><p><a href="/pipeline">Volver al CRM</a></p></body></html>`;
  return new NextResponse(html, { status: ok ? 200 : 400, headers: { "Content-Type": "text/html; charset=utf-8" } });
}

const escapar = (t: string) => t.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export async function GET(req: NextRequest) {
  const auth = await requireAdmin();
  if ("response" in auth) return auth.response;
  const p = req.nextUrl.searchParams;
  const estado = req.cookies.get("drive_oauth_estado")?.value;
  if (p.get("error")) return pagina("No se conectó Drive", `Google respondió: ${escapar(p.get("error") || "")}`, false);
  if (!estado || estado !== p.get("state")) return pagina("No se conectó Drive", "El enlace venció o no coincide. Vuelve a tocar «Conectar Drive».", false);
  const code = p.get("code");
  if (!code) return pagina("No se conectó Drive", "Google no envió el código de autorización.", false);
  try {
    const { cuenta } = await completarConexion(code);
    await carpetaGuias();
    const res = pagina(
      "Drive conectado ✅",
      `Las guías se guardarán en la carpeta «${NOMBRE_CARPETA_GUIAS}»${cuenta ? ` de ${escapar(cuenta)}` : ""}.`,
      true
    );
    res.cookies.delete({ name: "drive_oauth_estado", path: "/api/google/drive" });
    return res;
  } catch (err) {
    return pagina("No se conectó Drive", escapar(err instanceof Error ? err.message : String(err)), false);
  }
}
