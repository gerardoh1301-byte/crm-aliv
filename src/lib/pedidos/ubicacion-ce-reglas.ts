/**
 * Mejora 9b (informe CRM Driven, 24/11): en contra entrega (CE) el bot pide la REFERENCIA de
 * la casa y la UBICACIÓN de WhatsApp. Si a los 10 min del pedido falta algo, un recordatorio;
 * si 10 min después sigue sin pin, plan B: Google ubica la dirección escrita y el punto queda
 * en las notas del pedido para quien valida y para el motorizado. Reglas puras.
 */

export const MARCA_UBICACION_RECORDATORIO = "[UBICACION_RECORDATORIO]";
export const MARCA_UBICACION_OK = "[UBICACION_OK]";
export const MARCA_UBICACION_GOOGLE = "[UBICACION_GOOGLE]";

export const MIN_RECORDATORIO_UBICACION = 10;
export const MIN_PLAN_B_UBICACION = 10;
/** Pedidos más viejos ya no se tocan (el equipo los ve al validar). */
export const HORAS_MAX_UBICACION = 6;

export type DecisionUbicacion =
  | { accion: "nada" | "esperar" }
  | { accion: "recordar"; faltaPin: boolean; faltaReferencia: boolean }
  | { accion: "pin_ok" }
  | { accion: "plan_b" };

export function ubicacionResuelta(notas: string | null | undefined): boolean {
  const n = notas ?? "";
  return n.includes(MARCA_UBICACION_OK) || n.includes(MARCA_UBICACION_GOOGLE);
}

/** Hora del recordatorio que quedó en las notas ("[UBICACION_RECORDATORIO] 2026-11-24T…Z"). */
export function recordatorioEnviadoEn(notas: string | null | undefined): Date | null {
  const m = (notas ?? "").match(/\[UBICACION_RECORDATORIO\]\s*(\d{4}-\d{2}-\d{2}T[\d:.]+Z)/);
  const d = m ? new Date(m[1]) : null;
  return d && !Number.isNaN(d.getTime()) ? d : null;
}

export function decidirUbicacionCE(i: {
  ahora: Date;
  creadoEn: Date;
  notas: string | null;
  tienePin: boolean;
  tieneReferencia: boolean;
}): DecisionUbicacion {
  if (ubicacionResuelta(i.notas)) return { accion: "nada" };
  const min = (d: Date) => (i.ahora.getTime() - d.getTime()) / 60_000;
  if (min(i.creadoEn) > HORAS_MAX_UBICACION * 60) return { accion: "nada" };
  if (i.tienePin && i.tieneReferencia) return { accion: "pin_ok" };
  if (min(i.creadoEn) < MIN_RECORDATORIO_UBICACION) return { accion: "esperar" };
  const recordado =
    recordatorioEnviadoEn(i.notas) ?? ((i.notas ?? "").includes(MARCA_UBICACION_RECORDATORIO) ? i.creadoEn : null);
  if (!recordado) return { accion: "recordar", faltaPin: !i.tienePin, faltaReferencia: !i.tieneReferencia };
  if (min(recordado) < MIN_PLAN_B_UBICACION) return { accion: "esperar" };
  // Con pin y sin referencia, el pin basta para el motorizado.
  return i.tienePin ? { accion: "pin_ok" } : { accion: "plan_b" };
}

export function mensajeRecordatorioUbicacion(o: {
  nombre: string | null;
  numeroVisible: string;
  faltaPin: boolean;
  faltaReferencia: boolean;
}): string {
  const primer = (o.nombre ?? "").trim().split(/\s+/)[0];
  const saludo =
    primer && /^[a-záéíóúñ]{2,}$/i.test(primer) ? `${primer[0].toUpperCase()}${primer.slice(1).toLowerCase()}, ` : "";
  const pedido = o.numeroVisible ? ` con tu pedido ${o.numeroVisible}` : "";
  const intro = `${saludo}para que el motorizado llegue sin perderse${pedido} 🛵`;
  if (o.faltaPin && o.faltaReferencia) {
    return `${intro}, ¿nos compartes tu ubicación por aquí (📎 → Ubicación) y una referencia de tu casa? Por ejemplo: «frente al parque, puerta negra» 📍`;
  }
  if (o.faltaPin) return `${intro}, ¿nos compartes tu ubicación por aquí (📎 → Ubicación)? Así llega directo a tu puerta 📍`;
  return `${intro}, ¿nos das una referencia de tu casa? Por ejemplo: «frente al parque», «al costado de la bodega» o el color de la puerta 🏠`;
}
