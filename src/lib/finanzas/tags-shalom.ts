/**
 * Datos de dinero reales de un pedido a provincia (Shalom), guardados como etiquetas
 * en las notas del pedido y del deal (mismo patrón que [ALICLIK_LIQUIDADO_BCP:...]).
 * El ERP lee estas etiquetas para registrar el flete Shalom pagado, el adelanto y el
 * saldo que el cliente pagó antes de recibir la clave.
 *
 *   [SHALOM_FLETE:12.00|CUENTA:BCP|FECHA:2026-11-19]
 *   [ADELANTO_MONTO:20.00|OP:123456|FECHA:2026-11-18|CUENTA:BCP]
 *   [SALDO_COBRADO:179.00|OP:654321|FECHA:2026-11-20|CUENTA:BCP]
 */

export interface FinanzasShalom {
  fleteShalom: number | null;
  fleteCuenta: string;
  fleteFecha: string;
  adelantoMonto: number | null;
  adelantoOp: string;
  adelantoFecha: string;
  saldoMonto: number | null;
  saldoOp: string;
  saldoFecha: string;
  saldoCuenta: string;
}

type NombreTag = "SHALOM_FLETE" | "ADELANTO_MONTO" | "SALDO_COBRADO";

function leerTag(
  notas: string,
  nombre: NombreTag
): { monto: number; kv: Record<string, string> } | null {
  const m = notas.match(new RegExp(`\\[${nombre}:([^\\]]+)\\]`, "i"));
  if (!m) return null;
  const partes = m[1].split("|");
  const monto = parseFloat(partes[0]);
  if (!Number.isFinite(monto)) return null;
  const kv: Record<string, string> = {};
  for (let i = 1; i < partes.length; i++) {
    const ix = partes[i].indexOf(":");
    if (ix > 0) kv[partes[i].slice(0, ix).toUpperCase().trim()] = partes[i].slice(ix + 1).trim();
  }
  return { monto, kv };
}

export function extraerFinanzasShalom(notas?: string | null): FinanzasShalom | null {
  if (!notas) return null;
  const flete = leerTag(notas, "SHALOM_FLETE");
  const adelanto = leerTag(notas, "ADELANTO_MONTO");
  const saldo = leerTag(notas, "SALDO_COBRADO");
  if (!flete && !adelanto && !saldo) return null;
  return {
    fleteShalom: flete ? flete.monto : null,
    fleteCuenta: flete?.kv.CUENTA || "BCP",
    fleteFecha: flete?.kv.FECHA || "",
    adelantoMonto: adelanto ? adelanto.monto : null,
    adelantoOp: adelanto?.kv.OP || "",
    adelantoFecha: adelanto?.kv.FECHA || "",
    saldoMonto: saldo ? saldo.monto : null,
    saldoOp: saldo?.kv.OP || "",
    saldoFecha: saldo?.kv.FECHA || "",
    saldoCuenta: saldo?.kv.CUENTA || "BCP",
  };
}

const limpiarValor = (v: string) => v.replace(/[|\]\[]/g, "").trim();

export function construirTag(
  nombre: NombreTag,
  monto: number,
  campos: Record<string, string>
): string {
  const extra = Object.entries(campos)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => `|${k}:${limpiarValor(String(v))}`)
    .join("");
  return `[${nombre}:${monto.toFixed(2)}${extra}]`;
}

/** Reemplaza (o quita, si `tag` es null) la etiqueta `nombre` dentro de las notas. */
export function reemplazarTag(
  notas: string | null | undefined,
  nombre: NombreTag,
  tag: string | null
): string {
  const limpio = (notas || "").replace(new RegExp(`\\[${nombre}:[^\\]]+\\]\\n?`, "gi"), "").trim();
  return [limpio, tag].filter(Boolean).join("\n");
}

/** Operación con la que se marca el saldo puesto por la regla "clave entregada". */
export const OP_CLAVE_ENTREGADA = "Clave entregada";

/**
 * Regla (20/11): la clave de retiro de 4 dígitos solo se entrega cuando el cliente ya depositó
 * el saldo, así que un pedido Shalom en "Entregado y Cobrado" tiene el saldo cobrado:
 * total del pedido menos el adelanto (S/ 20 si no se registró otro monto).
 */
export function saldoPorClaveEntregada(totalSoles: number, finanzas: FinanzasShalom | null): number {
  const adelanto = finanzas?.adelantoMonto ?? 20;
  return Math.max(0, Math.round((totalSoles - adelanto) * 100) / 100);
}
