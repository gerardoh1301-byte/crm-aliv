import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api-auth";
import { driveConfigurado, nuevoEstadoOAuth, urlAutorizacion } from "@/lib/google/drive";

export const dynamic = "force-dynamic";

/** Un administrador abre esta ruta y Google le pide permiso para los archivos que cree el CRM. */
export async function GET() {
  const auth = await requireAdmin();
  if ("response" in auth) return auth.response;
  if (!driveConfigurado()) {
    return NextResponse.json({ error: "Faltan GOOGLE_DRIVE_CLIENT_ID / GOOGLE_DRIVE_CLIENT_SECRET en Render" }, { status: 400 });
  }
  const estado = nuevoEstadoOAuth();
  const res = NextResponse.redirect(urlAutorizacion(estado));
  res.cookies.set("drive_oauth_estado", estado, { httpOnly: true, secure: true, sameSite: "lax", maxAge: 600, path: "/api/google/drive" });
  return res;
}
