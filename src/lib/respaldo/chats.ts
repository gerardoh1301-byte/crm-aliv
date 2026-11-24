import "server-only";
import { gzipSync } from "node:zlib";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { contacts, conversations, crmSettings, messages } from "@/db/schema";
import {
  carpetaRespaldoChats,
  enviarAPapelera,
  estadoDrive,
  listarArchivos,
  subirArchivo,
} from "@/lib/google/drive";
import { fechaLima, nombresArchivoRespaldo, respaldosVencidos, textoLegibleChats } from "./chats-formato";

const CLAVE_ULTIMO = "respaldo_chats_ultimo";
const DIAS_CONSERVAR = 60;

/**
 * Copia completa de los chats: contactos, conversaciones y mensajes (con el payload crudo del
 * proveedor, que trae los enlaces de fotos y audios). Va en dos archivos: un JSON comprimido
 * para restaurar y un .txt legible para leer desde el celular.
 */
export async function generarRespaldoChats(ahora = new Date()) {
  const [contactos, conversaciones, mensajes] = await Promise.all([
    db.select().from(contacts),
    db.select().from(conversations),
    db.select().from(messages),
  ]);
  const fecha = fechaLima(ahora);
  const json = gzipSync(
    Buffer.from(
      JSON.stringify({ version: 1, generadoEn: ahora.toISOString(), contactos, conversaciones, mensajes }),
      "utf8"
    )
  );
  const texto = Buffer.from(textoLegibleChats({ contactos, conversaciones, mensajes, generadoEn: ahora }), "utf8");
  return { fecha, json, texto, totales: { contactos: contactos.length, chats: conversaciones.length, mensajes: mensajes.length } };
}

/**
 * Una vez por día de Lima (lo llama barridos.ts): sube la copia a «Respaldo chats (CRM)» y
 * manda a la papelera las de más de 60 días. `forzar` la sube aunque ya haya una de hoy.
 */
export async function respaldoDiarioChats(opciones: { forzar?: boolean; ahora?: Date } = {}) {
  const ahora = opciones.ahora ?? new Date();
  const hoy = fechaLima(ahora);
  const [ultimo] = await db.select({ value: crmSettings.value }).from(crmSettings).where(eq(crmSettings.key, CLAVE_ULTIMO)).limit(1);
  if (!opciones.forzar && ultimo?.value === hoy) return { hecho: false, motivo: "ya hay respaldo de hoy", fecha: hoy };

  const drive = await estadoDrive();
  if (!drive.conectado) return { hecho: false, motivo: "Drive no está conectado", fecha: hoy };

  const r = await generarRespaldoChats(ahora);
  const carpeta = await carpetaRespaldoChats();
  const nombres = nombresArchivoRespaldo(r.fecha);
  const [archivoJson, archivoTexto] = await Promise.all([
    subirArchivo({ nombre: nombres.json, mime: "application/gzip", datos: r.json, carpetaId: carpeta }),
    subirArchivo({ nombre: nombres.texto, mime: "text/plain; charset=UTF-8", datos: r.texto, carpetaId: carpeta }),
  ]);
  await db
    .insert(crmSettings)
    .values({ key: CLAVE_ULTIMO, value: hoy })
    .onConflictDoUpdate({ target: crmSettings.key, set: { value: hoy } });

  let enPapelera = 0;
  try {
    const archivos = await listarArchivos(carpeta);
    const vencidos = new Set(respaldosVencidos(archivos.map((a) => a.name), hoy, DIAS_CONSERVAR));
    for (const a of archivos) {
      if (!vencidos.has(a.name)) continue;
      await enviarAPapelera(a.id);
      enPapelera++;
    }
  } catch (err) {
    console.warn("[respaldo-chats] limpieza:", err instanceof Error ? err.message : err);
  }

  return {
    hecho: true,
    fecha: hoy,
    totales: r.totales,
    archivos: [archivoJson.webViewLink, archivoTexto.webViewLink],
    enPapelera,
  };
}
