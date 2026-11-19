import { NextRequest, NextResponse } from "next/server";
import { registrarAbandono } from "@/lib/abandonos/servidor";

export const dynamic = "force-dynamic";

/**
 * POST /api/webhooks/formulario-abandonado
 *
 * Lo llama la landing de alivstore.shop (public/js/captura-formulario.js) cuando el
 * cliente escribe un celular válido en el formulario EasySell y todavía no lo envía.
 * Es público por necesidad (el navegador del cliente no puede guardar un secreto), así
 * que se protege por origen, tamaño, trampa para bots y límite por IP. Lo peor que
 * puede hacer un abuso es crear contactos en la columna "Formulario abandonado".
 *
 * Acepta text/plain para que `navigator.sendBeacon` funcione sin preflight.
 */

const ORIGENES = new Set(
  (process.env.ABANDONOS_ORIGENES ||
    "https://alivstore.shop,https://www.alivstore.shop,https://3ahfj7-br.myshopify.com")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
);

const VENTANA_MS = 10 * 60_000;
const MAX_POR_IP = 20;
const porIp = new Map<string, { n: number; desde: number }>();

function limitar(ip: string): boolean {
  const ahora = Date.now();
  const r = porIp.get(ip);
  if (!r || ahora - r.desde > VENTANA_MS) {
    porIp.set(ip, { n: 1, desde: ahora });
    if (porIp.size > 5000) porIp.clear();
    return true;
  }
  r.n++;
  return r.n <= MAX_POR_IP;
}

function cors(origin: string | null): Record<string, string> {
  if (!origin || !ORIGENES.has(origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, { status: 204, headers: cors(request.headers.get("origin")) });
}

export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  const headers = cors(origin);
  if (!origin || !ORIGENES.has(origin)) {
    return NextResponse.json({ ok: false }, { status: 403 });
  }

  const ip = (request.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "sin-ip";
  if (!limitar(ip)) {
    return NextResponse.json({ ok: false, error: "demasiadas solicitudes" }, { status: 429, headers });
  }

  const raw = await request.text();
  if (raw.length > 4000) {
    return NextResponse.json({ ok: false }, { status: 413, headers });
  }
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ ok: false, error: "JSON invalido" }, { status: 400, headers });
  }

  // Trampa: campo invisible en el script; un humano nunca lo llena.
  if (typeof body.web === "string" && body.web.trim()) {
    return NextResponse.json({ ok: true }, { headers });
  }

  try {
    const r = await registrarAbandono({
      telefono: body.telefono,
      nombre: body.nombre,
      ciudad: body.ciudad,
      direccion: body.direccion,
      producto: body.producto,
      total: body.total,
      url: body.url,
    });
    // No se devuelve el contactId: la landing no lo necesita.
    return NextResponse.json({ ok: r.ok, estado: r.estado }, { status: r.ok ? 200 : 422, headers });
  } catch (err) {
    console.error("[formulario-abandonado]", err);
    return NextResponse.json({ ok: false }, { status: 500, headers });
  }
}
