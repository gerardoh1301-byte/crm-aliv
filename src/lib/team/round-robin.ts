/**
 * Reparto por turnos con pesos (mejora 10 del informe CRM Driven, 24/11). Reglas puras.
 *
 * Round-robin ponderado «suave» (el de nginx): con pesos A=2, B=1 el orden es A, B, A, A, B, A…
 * sin rachas largas para nadie. El estado (peso acumulado por asesor) se guarda en crm_settings.
 */

export type Pesos = Record<string, number>;
export type EstadoTurnos = Record<string, number>;

/** Limpia pesos: solo enteros 1–10 de asesores activos. */
export function normalizarPesos(pesos: unknown, activos: string[]): Pesos {
  const out: Pesos = {};
  const src = (pesos && typeof pesos === "object" ? pesos : {}) as Record<string, unknown>;
  for (const id of activos) {
    const n = Math.round(Number(src[id]));
    if (Number.isFinite(n) && n > 0) out[id] = Math.min(10, n);
  }
  return out;
}

export function siguienteTurno(pesos: Pesos, estado: EstadoTurnos): { memberId: string | null; estado: EstadoTurnos } {
  const ids = Object.keys(pesos).filter((id) => pesos[id] > 0).sort();
  if (ids.length === 0) return { memberId: null, estado: {} };
  const total = ids.reduce((s, id) => s + pesos[id], 0);
  const nuevo: EstadoTurnos = {};
  let elegido = ids[0];
  for (const id of ids) {
    nuevo[id] = (Number(estado[id]) || 0) + pesos[id];
    if (nuevo[id] > nuevo[elegido]) elegido = id;
  }
  nuevo[elegido] -= total;
  return { memberId: elegido, estado: nuevo };
}

/**
 * Con reparto por turnos un contacto que ya tiene asesor de la rueda se queda con él
 * (si no, cada mensaje entrante lo pasaría al siguiente). Solo se reparte si no tiene
 * dueño o su dueño ya no está en la rueda.
 */
export function debeRepartir(ownerId: string | null, pesos: Pesos): boolean {
  return !ownerId || !(ownerId in pesos);
}

export function parsearJson<T>(valor: string | null | undefined, porDefecto: T): T {
  if (!valor) return porDefecto;
  try {
    const v = JSON.parse(valor);
    return v && typeof v === "object" ? (v as T) : porDefecto;
  } catch {
    return porDefecto;
  }
}
