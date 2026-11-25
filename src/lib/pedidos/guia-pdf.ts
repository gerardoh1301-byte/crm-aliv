import "server-only";
import crypto from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { activities, contacts, conversations } from "@/db/schema";
import { pedidosOrdenes } from "../../../modules/pedidos/tabla";
import { carpetaGuias, descargarArchivo, subirArchivo } from "@/lib/google/drive";
import { deliverMessage } from "@/lib/channels/deliver";
import { TAG_NO_REACTIVAR } from "@/lib/agent/baja";
import {
  MARCA_GUIA_ENVIADA,
  guiaYaEnviada,
  leerGuiaPdf,
  mensajeGuia,
  nombreArchivoGuia,
  notasConGuia,
  validarPdf,
} from "./guia-pdf-reglas";
import { pdfAImagen } from "./guia-pdf-imagen";

export function urlPublicaImagenGuia(token: string): string {
  const base = (process.env.NEXT_PUBLIC_APP_URL || "https://crm-aliv.onrender.com").replace(/\/+$/, "");
  return `${base}/api/publico/guia/${token}`;
}

export interface ResultadoSubida {
  ok: boolean;
  error?: string;
  archivo?: string;
  pdfUrl?: string | null;
  envio?: ResultadoEnvio;
}

/** Guarda el PDF y su imagen en Drive y deja la marca en el pedido. Si `enviar`, se la manda al cliente. */
export async function guardarGuiaPdf(params: { pedidoId: string; pdf: Uint8Array; enviar: boolean; quien: string }): Promise<ResultadoSubida> {
  const invalido = validarPdf(params.pdf);
  if (invalido) return { ok: false, error: invalido };

  const [p] = await db
    .select({ id: pedidosOrdenes.id, numeroOrden: pedidosOrdenes.numeroOrden, notas: pedidosOrdenes.notas, contactId: pedidosOrdenes.contactId, creado: pedidosOrdenes.createdAt, cliente: contacts.name })
    .from(pedidosOrdenes)
    .leftJoin(contacts, eq(contacts.id, pedidosOrdenes.contactId))
    .where(eq(pedidosOrdenes.id, params.pedidoId))
    .limit(1);
  if (!p) return { ok: false, error: "Pedido no encontrado" };

  let imagen: Buffer;
  try {
    imagen = await pdfAImagen(params.pdf);
  } catch (err) {
    return { ok: false, error: `No se pudo leer el PDF: ${err instanceof Error ? err.message : String(err)}` };
  }

  const nombre = nombreArchivoGuia({ cliente: p.cliente, numeroOrden: p.numeroOrden, fecha: p.creado });
  const carpeta = await carpetaGuias();
  const pdf = await subirArchivo({ nombre, mime: "application/pdf", datos: params.pdf, carpetaId: carpeta });
  const img = await subirArchivo({ nombre: nombre.replace(/\.pdf$/, ".jpg"), mime: "image/jpeg", datos: imagen, carpetaId: carpeta });
  const datos = { pdfId: pdf.id, imagenId: img.id, token: crypto.randomBytes(20).toString("hex") };

  await db.update(pedidosOrdenes).set({ notas: notasConGuia(p.notas, datos), updatedAt: new Date() }).where(eq(pedidosOrdenes.id, p.id));
  if (p.contactId) {
    await db.insert(activities).values({
      type: "note",
      description: `📄 [GUIA PDF] ${params.quien} subió la guía de ${p.numeroOrden} a Drive: ${nombre}`,
      contactId: p.contactId,
    });
  }

  const envio = params.enviar ? await enviarGuiaAlCliente(p.id) : undefined;
  return { ok: true, archivo: nombre, pdfUrl: pdf.webViewLink, envio };
}

export interface ResultadoEnvio {
  enviado: boolean;
  motivo?: string;
}

export interface PedidoShalomContacto {
  id: string;
  numeroOrden: string;
  fecha: string;
  estado: string;
  tieneGuia: boolean;
}

/** Pedidos Shalom del contacto (más recientes primero), para subir la preguía desde su ficha. */
export async function pedidosShalomDeContacto(contactId: string): Promise<PedidoShalomContacto[]> {
  const { ilike, or } = await import("drizzle-orm");
  const filas = await db
    .select({ id: pedidosOrdenes.id, numeroOrden: pedidosOrdenes.numeroOrden, creado: pedidosOrdenes.createdAt, estado: pedidosOrdenes.estado, notas: pedidosOrdenes.notas })
    .from(pedidosOrdenes)
    .where(
      and(
        eq(pedidosOrdenes.contactId, contactId),
        or(ilike(pedidosOrdenes.transportadora, "%shalom%"), ilike(pedidosOrdenes.modalidadPago, "%adelanto%"))
      )
    )
    .orderBy(desc(pedidosOrdenes.createdAt))
    .limit(10);
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Lima" });
  return filas.map((f) => ({
    id: f.id,
    numeroOrden: f.numeroOrden,
    fecha: fmt.format(f.creado),
    estado: f.estado,
    tieneGuia: leerGuiaPdf(f.notas) !== null,
  }));
}

/** Envía la imagen de la guía con la pregunta. Solo dentro de la ventana de 24 h; no repite. */
export async function enviarGuiaAlCliente(pedidoId: string): Promise<ResultadoEnvio> {
  const [p] = await db
    .select({
      id: pedidosOrdenes.id,
      numeroOrden: pedidosOrdenes.numeroOrden,
      notas: pedidosOrdenes.notas,
      contactId: pedidosOrdenes.contactId,
      numeroGuia: pedidosOrdenes.numeroGuia,
      codigo: pedidosOrdenes.codigoRastreo,
      agencia: pedidosOrdenes.direccionEnvio,
      cliente: contacts.name,
      tags: contacts.tags,
    })
    .from(pedidosOrdenes)
    .leftJoin(contacts, eq(contacts.id, pedidosOrdenes.contactId))
    .where(eq(pedidosOrdenes.id, pedidoId))
    .limit(1);
  if (!p?.contactId) return { enviado: false, motivo: "Pedido sin contacto" };
  const guia = leerGuiaPdf(p.notas);
  if (!guia) return { enviado: false, motivo: "El pedido no tiene guía PDF" };
  if (guiaYaEnviada(p.notas, guia.imagenId)) return { enviado: false, motivo: "Esta guía ya se le envió" };

  const tags = (p.tags ?? []).map((t) => t.toLowerCase().trim());
  if ((p.notas ?? "").toUpperCase().includes("[SHALOM_AUTO_EXCLUIDO]") || tags.some((t) => ["shalom manual", "sin auto shalom", "shalom excluido", TAG_NO_REACTIVAR].includes(t))) {
    return { enviado: false, motivo: "Cliente excluido del envío automático (lo atiende una persona)" };
  }

  const [conv] = await db
    .select({ id: conversations.id, aiEnabled: conversations.aiEnabled })
    .from(conversations)
    .where(and(eq(conversations.contactId, p.contactId), eq(conversations.channel, "whatsapp")))
    .orderBy(desc(conversations.updatedAt))
    .limit(1);
  if (!conv) return { enviado: false, motivo: "El cliente no tiene chat de WhatsApp" };
  if (!conv.aiEnabled) return { enviado: false, motivo: "El bot está apagado en este chat: envíala a mano" };

  const texto = mensajeGuia({ nombre: p.cliente, numeroGuia: p.numeroGuia, codigo: p.codigo, agencia: p.agencia });
  const res = await deliverMessage(
    conv.id,
    { text: texto, attachments: [{ type: "image", url: urlPublicaImagenGuia(guia.token), name: "Guía Shalom.jpg", mimeType: "image/jpeg" }] },
    "agent"
  );
  if (!res.ok) {
    const motivo = res.error === "fuera_de_ventana_24h" ? "El cliente no escribe hace más de 24 h (WhatsApp no deja enviar la imagen)" : res.error || "No se pudo enviar";
    await db.insert(activities).values({ type: "note", description: `📄 [GUIA PDF] No se envió la imagen de la guía de ${p.numeroOrden}: ${motivo}`, contactId: p.contactId });
    return { enviado: false, motivo };
  }
  const marca = `${MARCA_GUIA_ENVIADA}${guia.imagenId}|${new Date().toISOString().slice(0, 16)}]`;
  await db.update(pedidosOrdenes).set({ notas: `${p.notas ?? ""}\n${marca}` }).where(eq(pedidosOrdenes.id, p.id));
  return { enviado: true };
}

/** Imagen para el enlace público (lo pide WhatsApp al enviar). Busca el pedido por el token. */
export async function imagenPorToken(token: string): Promise<Buffer | null> {
  if (!/^[a-f0-9]{40}$/.test(token)) return null;
  const { sql } = await import("drizzle-orm");
  const [p] = await db
    .select({ notas: pedidosOrdenes.notas })
    .from(pedidosOrdenes)
    .where(sql`position(${`|t:${token}]`} in coalesce(${pedidosOrdenes.notas}, '')) > 0`)
    .limit(1);
  const guia = leerGuiaPdf(p?.notas);
  if (!guia || guia.token !== token) return null;
  const archivo = await descargarArchivo(guia.imagenId);
  return archivo?.datos ?? null;
}
