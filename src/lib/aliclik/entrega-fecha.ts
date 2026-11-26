/**
 * Fecha más pronta de una entrega contra entrega de AliClik en provincia (26/11, #1183):
 * Huaraz tiene contra entrega pero AliClik tarda unos 2 días hábiles, y el bot le prometió a
 * Alfredo (miércoles 25/11 de noche) «mañana al mediodía (de 12:00 a 2:00 p. m.)». Ni el día ni la hora se pueden cumplir.
 */

const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

/** Fecha de hoy en Lima (UTC−5, sin horario de verano) como Date a medianoche UTC. */
function hoyLima(ahora: Date): Date {
  const lima = new Date(ahora.getTime() - 5 * 3600_000);
  return new Date(Date.UTC(lima.getUTCFullYear(), lima.getUTCMonth(), lima.getUTCDate()));
}

export interface FechaEntrega {
  /** Días hábiles que informa AliClik (diasExtra + 1). */
  diasHabiles: number;
  /** YYYY-MM-DD */
  iso: string;
  /** «jueves 27/11» */
  etiqueta: string;
  /** true si la primera fecha posible es pasado mañana o después. */
  despuesDeManana: boolean;
}

/** Suma días hábiles (lunes a sábado; el domingo no reparte) desde hoy en Lima. */
export function fechaMinimaCod(diasExtra: number | null | undefined, ahora: Date = new Date()): FechaEntrega | null {
  if (diasExtra == null || !Number.isFinite(diasExtra)) return null;
  const diasHabiles = Math.max(1, Math.round(diasExtra) + 1);
  const hoy = hoyLima(ahora);
  const d = new Date(hoy);
  let n = 0;
  while (n < diasHabiles) {
    d.setUTCDate(d.getUTCDate() + 1);
    if (d.getUTCDay() !== 0) n++;
  }
  const manana = new Date(hoy);
  manana.setUTCDate(manana.getUTCDate() + 1);
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  return {
    diasHabiles,
    iso: d.toISOString().slice(0, 10),
    etiqueta: `${DIAS[d.getUTCDay()]} ${dd}/${mm}`,
    despuesDeManana: d.getTime() > manana.getTime(),
  };
}

export interface EntregaCodProvincia {
  lugar: string;
  fecha: FechaEntrega;
}

/** Instrucción para el bot (va dentro del bloque de contra entrega en provincia). */
export function lineasFechaCod(e: EntregaCodProvincia): string {
  return (
    `- FECHA: AliClik tarda unos ${e.fecha.diasHabiles} días hábiles hasta ${e.lugar}. La entrega MÁS PRONTA es el ${e.fecha.etiqueta}. ` +
    "PROHIBIDO prometer hoy, mañana o cualquier fecha anterior; si el cliente pide antes, dile con amabilidad que lo más pronto es esa fecha.\n" +
    "- HORA: en provincia NO se agenda hora ni rango horario: el courier reparte durante el día y llama al cliente antes de llegar."
  );
}

const PROMESA_CERCANA =
  /[^.!?\n]*\b(?:hoy|ma[ñn]ana)\b[^.!?\n]*\b(?:entreg|program|agend|lleg|recib|despach|motorizado|courier)[^.!?\n]*[.!?]?|[^.!?\n]*\b(?:entreg|program|agend|lleg|recib|despach)[^.!?\n]*\b(?:hoy|ma[ñn]ana)\b[^.!?\n]*[.!?]?/gi;
const RANGO_HORA = /\s*\(?\s*(?:de\s+)?\d{1,2}(?::\d{2})?\s*(?:a\.?\s?m\.?|p\.?\s?m\.?)?\s*(?:a|-|–)\s*\d{1,2}(?::\d{2})?\s*(?:a\.?\s?m\.?|p\.?\s?m\.?)\s*\)?/gi;

/**
 * Si la respuesta promete la entrega para hoy o mañana (o con rango de horas) en una ciudad
 * de provincia con contra entrega más lenta, se cambia esa frase por la fecha real.
 */
export function corregirPromesaEntregaCod(reply: string, e: EntregaCodProvincia | null): { texto: string; corregido: boolean } {
  if (!e || !e.fecha.despuesDeManana) return { texto: reply, corregido: false };
  let corregido = false;
  // Primero el rango de horas: sus «p. m.» cortarían la frase en dos.
  const sinHoras = reply.replace(RANGO_HORA, "");
  if (sinHoras !== reply) corregido = true;
  const real =
    `En ${e.lugar} la entrega contra entrega toma unos ${e.fecha.diasHabiles} días hábiles: lo más pronto es el *${e.fecha.etiqueta}*. ` +
    "El courier te llama antes de llegar y pagas al recibir.";
  let texto = sinHoras.replace(PROMESA_CERCANA, (frase) => {
    corregido = true;
    return ` ${real} `;
  });
  // Si quedó más de una vez la frase real, se deja una sola.
  const primera = texto.indexOf(real);
  if (primera >= 0) texto = texto.slice(0, primera + real.length) + texto.slice(primera + real.length).split(real).join("");
  texto = texto.replace(/[ \t]{2,}/g, " ").replace(/ +\n/g, "\n").replace(/\n /g, "\n").trim();
  return { texto, corregido };
}
