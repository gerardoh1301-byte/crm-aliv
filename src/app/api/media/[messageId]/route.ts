import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { messages } from "@/db/schema";
import { eq } from "drizzle-orm";
import { requireMember } from "@/lib/api-auth";
import { canAccessContactId } from "@/lib/team";

/**
 * Muestra al asesor la imagen, video, audio o documento que envio el cliente.
 *
 * Zernio guarda el archivo en `rawPayload.message.attachments[i].url`, pero ese enlace
 * exige la clave del servidor (desde el navegador responde 401). Esta ruta lo descarga
 * con ZERNIO_API_KEY y se lo entrega solo a un miembro del equipo con acceso al contacto.
 *
 * GET /api/media/{messageId}?i=0
 */

export const dynamic = "force-dynamic";

interface Adjunto {
  url?: string;
  type?: string;
  mimeType?: string;
  payload?: { mimeType?: string };
}

function adjuntosDe(raw: unknown): Adjunto[] {
  const r = (raw ?? {}) as { message?: { attachments?: unknown }; attachments?: unknown };
  const lista = r.message?.attachments ?? r.attachments ?? [];
  return Array.isArray(lista) ? (lista as Adjunto[]) : [];
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ messageId: string }> }
) {
  const auth = await requireMember();
  if ("response" in auth) return auth.response;

  const { messageId } = await params;
  const indice = Math.max(0, Number(request.nextUrl.searchParams.get("i") ?? 0) || 0);

  const [msg] = await db
    .select({ contactId: messages.contactId, rawPayload: messages.rawPayload })
    .from(messages)
    .where(eq(messages.id, messageId))
    .limit(1);
  if (!msg) return NextResponse.json({ error: "Mensaje no encontrado" }, { status: 404 });

  if (msg.contactId && !(await canAccessContactId(auth.member, msg.contactId))) {
    return NextResponse.json({ error: "Sin acceso a este contacto" }, { status: 403 });
  }

  const adjunto = adjuntosDe(msg.rawPayload)[indice];
  if (!adjunto?.url) return NextResponse.json({ error: "El mensaje no tiene archivo" }, { status: 404 });

  // Solo se reenvia la clave a Zernio; cualquier otro host se pide sin credenciales.
  let host = "";
  try {
    host = new URL(adjunto.url).host;
  } catch {
    return NextResponse.json({ error: "URL de archivo invalida" }, { status: 400 });
  }
  const headers: Record<string, string> = {};
  const zernioKey = process.env.ZERNIO_API_KEY;
  if (zernioKey && (host === "zernio.com" || host.endsWith(".zernio.com"))) {
    headers["Authorization"] = `Bearer ${zernioKey}`;
  }

  let res: Response;
  try {
    res = await fetch(adjunto.url, { headers, signal: AbortSignal.timeout(30000) });
  } catch (err) {
    console.warn("[media] fallo la descarga:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "No se pudo descargar el archivo" }, { status: 502 });
  }
  if (!res.ok || !res.body) {
    console.warn(`[media] el proveedor respondio ${res.status} para el mensaje ${messageId}`);
    return NextResponse.json(
      { error: res.status === 404 || res.status === 410 ? "El archivo ya vencio en WhatsApp" : "No se pudo descargar el archivo" },
      { status: res.status === 404 || res.status === 410 ? 410 : 502 }
    );
  }

  const tipo =
    res.headers.get("content-type")?.split(";")[0] ||
    adjunto.payload?.mimeType ||
    adjunto.mimeType ||
    "application/octet-stream";

  return new NextResponse(res.body, {
    status: 200,
    headers: {
      "Content-Type": tipo,
      "Cache-Control": "private, max-age=3600",
      ...(res.headers.get("content-length") ? { "Content-Length": res.headers.get("content-length")! } : {}),
    },
  });
}
