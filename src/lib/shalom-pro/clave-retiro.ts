import "server-only";
import crypto from "node:crypto";
import { db } from "@/db";
import { pedidosOrdenes } from "../../../modules/pedidos/tabla";
import { and, gt, isNotNull, sql } from "drizzle-orm";

/** ID oficial de la carpeta "preguias shalom" en Google Drive */
export const SHALOM_PREGUIAS_DRIVE_FOLDER_ID =
  process.env.SHALOM_PREGUIAS_DRIVE_FOLDER_ID || "1nh0aCCxClBGBaB4Z1NNEmBQVp-hKa1nH";

/** Origen fijo en Shalom PRO para todos los despachos de WANKLIC GROUP 2 */
export const SHALOM_PRO_ORIGEN_FIJO = {
  departamento: "Lima",
  provincia: "Lima",
  distrito: "La Victoria",
  agencia: "Raymondi",
  etiquetaCompleta: "Lima, Lima, La Victoria, Raymondi",
};

const CLAVES_PROHIBIDAS = new Set([
  "0000", "1111", "2222", "3333", "4444", "5555", "6666", "7777", "8888", "9999",
  "1234", "4321", "0123", "3210", "2025", "2026",
]);

/**
 * Genera una clave numérica de 4 dígitos evitando claves triviales y cualquier clave
 * usada en los últimos `diasExclusion` días (Shalom PRO rechaza claves del día anterior).
 */
export function elegirClave4DigitosUnica(clavesRecientes: Iterable<string>): string {
  const usadas = new Set<string>(CLAVES_PROHIBIDAS);
  for (const c of clavesRecientes) {
    const clean = String(c || "").replace(/\D/g, "");
    if (clean.length === 4) usadas.add(clean);
  }
  for (let intento = 0; intento < 200; intento++) {
    const n = crypto.randomInt(1000, 10000);
    const cand = String(n).padStart(4, "0");
    if (!usadas.has(cand)) return cand;
  }
  // Fallback determinista de último recurso
  for (let n = 1000; n < 10000; n++) {
    const cand = String(n);
    if (!usadas.has(cand)) return cand;
  }
  return String(crypto.randomInt(1000, 10000));
}

export async function generarClaveRetiroShalomUnica(diasExclusion = 7): Promise<string> {
  const rows = await db
    .select({ claveRecojo: pedidosOrdenes.claveRecojo })
    .from(pedidosOrdenes)
    .where(
      and(
        isNotNull(pedidosOrdenes.claveRecojo),
        gt(pedidosOrdenes.updatedAt, sql`now() - make_interval(days => ${diasExclusion}::int)`)
      )
    );
  const recientes = rows
    .map((r) => (r.claveRecojo || "").replace(/\D/g, ""))
    .filter((c) => c.length === 4);
  return elegirClave4DigitosUnica(recientes);
}

/**
 * Construye el nombre estandarizado del PDF de preguía para Google Drive:
 * "<NombreCliente> - #<NumeroOrden> - <YYYY-MM-DD> - Clave <4digitos>.pdf"
 */
export function construirNombreArchivoPreguia(params: {
  clienteNombre: string;
  numeroOrden: string;
  clave4Digitos: string;
  fechaRegistro?: Date | string;
}): string {
  const nombreLimpio = (params.clienteNombre || "Cliente")
    .normalize("NFC")
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);

  const ordenLimpia = (params.numeroOrden || "SIN-ORDEN")
    .replace(/^#+/, "")
    .replace(/[\\/:*?"<>|]+/g, "")
    .trim();

  let fechaStr: string;
  if (typeof params.fechaRegistro === "string" && /^\d{4}-\d{2}-\d{2}$/.test(params.fechaRegistro)) {
    fechaStr = params.fechaRegistro;
  } else {
    const d = params.fechaRegistro ? new Date(params.fechaRegistro) : new Date();
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Lima",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(d);
    const y = parts.find((p) => p.type === "year")?.value ?? "2026";
    const m = parts.find((p) => p.type === "month")?.value ?? "01";
    const day = parts.find((p) => p.type === "day")?.value ?? "01";
    fechaStr = `${y}-${m}-${day}`;
  }

  const clave = String(params.clave4Digitos || "").replace(/\D/g, "").slice(0, 4);
  return `${nombreLimpio} - #${ordenLimpia} - ${fechaStr} - Clave ${clave}.pdf`;
}

/**
 * Valida que el pedido tenga toda la información indispensable para autogenerar
 * la preguía en Shalom PRO: nombre, DNI válido (8 dígitos) y agencia Shalom localizada.
 */
export function validarDatosIndispensablesShalomPro(input: {
  clienteNombre?: string | null;
  dni?: string | null;
  agenciaShalom?: string | null;
}): { completo: boolean; faltantes: string[] } {
  const faltantes: string[] = [];
  const nombre = (input.clienteNombre || "").trim();
  if (nombre.length < 3 || /^cliente\b/i.test(nombre)) {
    faltantes.push("nombre completo");
  }
  const dni = (input.dni || "").replace(/\D/g, "");
  if (dni.length !== 8) {
    faltantes.push("DNI (8 dígitos)");
  }
  const agencia = (input.agenciaShalom || "").trim();
  if (agencia.length < 4) {
    faltantes.push("agencia Shalom localizada");
  }
  return { completo: faltantes.length === 0, faltantes };
}
