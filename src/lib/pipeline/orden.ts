/**
 * Orden de las tarjetas dentro de cada etapa del pipeline: la de fecha más reciente va arriba.
 * La fecha de una tarjeta es la más nueva entre su última actualización (mover de etapa la actualiza)
 * y las fechas de dinero registradas (flete, adelanto y saldo Shalom, liquidación AliClik).
 */
type FechaTexto = string | Date | null | undefined;

export interface DealConFechas {
  updatedAt?: FechaTexto;
  createdAt?: FechaTexto;
  finanzasShalom?: { fleteFecha?: string | null; adelantoFecha?: string | null; saldoFecha?: string | null } | null;
  liquidacionAliclik?: { fecha?: string | null } | null;
}

function aMs(v: FechaTexto): number {
  if (!v) return 0;
  const ms = v instanceof Date ? v.getTime() : Date.parse(v);
  return Number.isFinite(ms) ? ms : 0;
}

export function fechaRecienteDeal(d: DealConFechas): number {
  const f = d.finanzasShalom;
  return Math.max(
    aMs(d.updatedAt),
    aMs(d.createdAt),
    aMs(f?.saldoFecha),
    aMs(f?.adelantoFecha),
    aMs(f?.fleteFecha),
    aMs(d.liquidacionAliclik?.fecha)
  );
}

export function ordenarPorFechaReciente<T extends DealConFechas>(deals: T[]): T[] {
  return deals
    .map((d, i) => ({ d, i, t: fechaRecienteDeal(d) }))
    .sort((a, b) => b.t - a.t || a.i - b.i)
    .map((x) => x.d);
}
