/**
 * Reportes AG | CE | TOTAL y calculadora UBU (mejoras 7 y 8 del informe CRM Driven, 24/11). Reglas puras.
 *
 * Mismas definiciones que la matriz de la hoja (metricas-operacion.ts) y los mismos costos de
 * Config (panel-crecimiento/references/hoja.md): NAC600 S/18 por frasco, Termix S/38,42,
 * flete Shalom 10 si no se registró, AliClik agencia 5, logística CE 16,5.
 */
import { lunesDeSemana, productoOperacion, tipoEnvio, type TipoEnvio } from "@/lib/metricas-operacion";

export interface PedidoReporte {
  fecha: string; // YYYY-MM-DD (Lima)
  estado: string;
  total: number;
  unidades: number;
  producto: string | null;
  modalidad_pago: string | null;
  transportadora: string | null;
  despachado: boolean;
  flete_shalom: number | null;
  canal: string; // "Web", "Bot" o el nombre del asesor
}

export interface Conteo {
  recibidos: number;
  confirmados: number;
  entregados: number;
  desc_confirmacion: number;
  desc_entrega: number;
  en_curso: number;
  ingresos_entregados: number;
  unidades_entregadas: number;
  costo_producto: number;
  logistica: number;
}

export type Columnas = Record<TipoEnvio | "TOTAL", Conteo>;
export interface FilaReporte {
  clave: string;
  columnas: Columnas;
}

export const COSTOS = {
  NAC600: 18,
  TERMIX: 38.42,
  OTRO: 18,
  fleteShalom: 10,
  aliclikAgencia: 5,
  logisticaCE: 16.5,
} as const;

export const METAS: Record<TipoEnvio, { confirmacion: number; entrega: number }> = {
  AG: { confirmacion: 0.4, entrega: 0.9 },
  CE: { confirmacion: 0.8, entrega: 0.65 },
};

const CONFIRMADOS = new Set(["confirmado", "preparando", "enviado", "entregado"]);

function vacio(): Conteo {
  return {
    recibidos: 0, confirmados: 0, entregados: 0, desc_confirmacion: 0, desc_entrega: 0, en_curso: 0,
    ingresos_entregados: 0, unidades_entregadas: 0, costo_producto: 0, logistica: 0,
  };
}

function sumar(c: Conteo, p: PedidoReporte, tipo: TipoEnvio) {
  c.recibidos++;
  const estado = (p.estado ?? "").toLowerCase();
  if (estado === "cancelado") {
    if (p.despachado) {
      c.confirmados++;
      c.desc_entrega++;
    } else c.desc_confirmacion++;
    return;
  }
  if (CONFIRMADOS.has(estado)) c.confirmados++;
  if (estado !== "entregado") {
    c.en_curso++;
    return;
  }
  c.entregados++;
  c.ingresos_entregados += p.total || 0;
  c.unidades_entregadas += p.unidades || 0;
  c.costo_producto += (p.unidades || 0) * COSTOS[productoOperacion(p.producto)];
  c.logistica += tipo === "AG" ? (p.flete_shalom ?? COSTOS.fleteShalom) + COSTOS.aliclikAgencia : COSTOS.logisticaCE;
}

export function agrupar(pedidos: PedidoReporte[], clave: (p: PedidoReporte) => string): FilaReporte[] {
  const m = new Map<string, Columnas>();
  for (const p of pedidos) {
    const k = clave(p);
    const tipo = tipoEnvio(p);
    let cols = m.get(k);
    if (!cols) {
      cols = { AG: vacio(), CE: vacio(), TOTAL: vacio() };
      m.set(k, cols);
    }
    sumar(cols[tipo], p, tipo);
    sumar(cols.TOTAL, p, tipo);
  }
  return [...m.entries()].map(([k, columnas]) => ({ clave: k, columnas }));
}

export const porMes = (ps: PedidoReporte[]) =>
  agrupar(ps, (p) => p.fecha.slice(0, 7)).sort((a, b) => b.clave.localeCompare(a.clave));

export const porSemanaProducto = (ps: PedidoReporte[]) =>
  agrupar(ps, (p) => `${lunesDeSemana(p.fecha)} · ${productoOperacion(p.producto)}`).sort((a, b) =>
    b.clave.localeCompare(a.clave)
  );

export const porCanal = (ps: PedidoReporte[]) =>
  agrupar(ps, (p) => p.canal).sort((a, b) => b.columnas.TOTAL.recibidos - a.columnas.TOTAL.recibidos);

export function tasas(c: Conteo) {
  return {
    confirmacion: c.recibidos ? c.confirmados / c.recibidos : null,
    entrega: c.confirmados ? c.entregados / c.confirmados : null,
  };
}

/**
 * UBU (utilidad bruta unitaria) por pedido entregado:
 * UP (ticket − costo de producto) − logística − CPA por entregado.
 */
export function calcularUbu(c: Conteo, gasto: number) {
  const cpa = (n: number) => (n > 0 && gasto > 0 ? gasto / n : null);
  const e = c.entregados;
  const up = e ? (c.ingresos_entregados - c.costo_producto) / e : null;
  const flete = e ? c.logistica / e : null;
  const cpaEntregado = cpa(e);
  const ubu = up !== null && flete !== null ? up - flete - (cpaEntregado ?? 0) : null;
  return {
    cpaRecibido: cpa(c.recibidos),
    cpaConfirmado: cpa(c.confirmados),
    cpaEntregado,
    up,
    flete,
    ubu,
    ubuTotal: ubu !== null ? ubu * e : null,
  };
}
