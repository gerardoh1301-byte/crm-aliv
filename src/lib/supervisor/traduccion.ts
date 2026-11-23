import { interpretarComando, type Comando } from "./parser";
import { pedidoParaRegistroAliclik } from "@/lib/aliclik/registrar-orden";

/**
 * Resultado de traducir con IA un mensaje del supervisor. Puro (sin IA ni base) para probarlo.
 */
export type TraduccionOrden =
  | { tipo: "orden"; orden: string; comando: Comando; descripcion: string }
  /** «registra <pedido> en aliclik»: propuesta de registro contra entrega en AliClik. */
  | { tipo: "aliclik"; orden: string; pedido: string; descripcion: string }
  | { tipo: "no_soportada"; descripcion: string }
  /** Pregunta o pedido de información que no es una orden estándar: lo contesta el asistente. */
  | { tipo: "consulta"; descripcion: string }
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
  if (r.tipo === "consulta") return { tipo: "consulta", descripcion };
  if (r.tipo === "no_soportada") return { tipo: "no_soportada", descripcion: descripcion || "esa acción" };
  if (r.tipo !== "orden" || typeof r.orden !== "string") return null;
  const orden = r.orden.replace(/[`"*]/g, "").replace(/\s+/g, " ").trim();
  if (!orden || orden.length > 120) return null;
  if (/\bali\s*cli(c|k)k?\b/i.test(orden)) {
    // Número, guía o celular; si la IA puso el nombre («registra juan carlos en aliclik»), el nombre.
    const pedido =
      pedidoParaRegistroAliclik(orden) ?? orden.match(/^registra\s+(.+?)\s+en\s+ali\s*cli(?:c|k)k?$/i)?.[1]?.trim() ?? null;
    return pedido ? { tipo: "aliclik", orden, pedido, descripcion } : null;
  }
  const comando = interpretarComando(orden);
  if (!comando) return null;
  return { tipo: "orden", orden, comando, descripcion };
}
