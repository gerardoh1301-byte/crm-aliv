import { interpretarComando, type Comando } from "./parser";

/**
 * Resultado de traducir con IA un mensaje del supervisor. Puro (sin IA ni base) para probarlo.
 */
export type TraduccionOrden =
  | { tipo: "orden"; orden: string; comando: Comando; descripcion: string }
  | { tipo: "no_soportada"; descripcion: string }
  | { tipo: "no_es_orden" };

/**
 * Valida lo que devolvió la IA. Una «orden» solo se acepta si el intérprete fijo la
 * entiende: así la IA no puede saltarse las reglas (confirmación con número, montos, etc.).
 */
export function normalizarTraduccion(raw: unknown): TraduccionOrden | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as { tipo?: unknown; orden?: unknown; descripcion?: unknown };
  const descripcion = typeof r.descripcion === "string" ? r.descripcion.trim().slice(0, 200) : "";
  if (r.tipo === "no_es_orden") return { tipo: "no_es_orden" };
  if (r.tipo === "no_soportada") return { tipo: "no_soportada", descripcion: descripcion || "esa acción" };
  if (r.tipo !== "orden" || typeof r.orden !== "string") return null;
  const orden = r.orden.replace(/[`"*]/g, "").replace(/\s+/g, " ").trim();
  if (!orden || orden.length > 120) return null;
  const comando = interpretarComando(orden);
  if (!comando) return null;
  return { tipo: "orden", orden, comando, descripcion };
}
