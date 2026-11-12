/** Etiqueta que impide que el CRM reactive solo el bot de un contacto (casos como Giovanni). */
export const TAG_NO_REACTIVAR = "no-reactivar";

/**
 * Motivos de baja ("no me escriban"): el unico caso en que el propio bot se apaga.
 * Con limites de palabra para que "bajar de peso" o "trabaja" no apaguen el bot.
 */
export function esMotivoDeBaja(motivo: string): boolean {
  const t = motivo.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  return (
    /\bno (me |nos |le |les |lo |la )?(escriban|escribas|escribir|contacten|contactes|contactar|molesten|llamen)\b/.test(t) ||
    /\b(dar(me|lo|la)?|darse) de baja\b/.test(t) ||
    /\bno contactar\b/.test(t)
  );
}
