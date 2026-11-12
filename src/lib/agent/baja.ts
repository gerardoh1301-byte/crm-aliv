/** Etiqueta que impide que el CRM reactive solo el bot de un contacto (casos como Giovanni). */
export const TAG_NO_REACTIVAR = "no-reactivar";

/** Despedida fija cuando el cliente pide no ser contactado (no pasa por el modelo). */
export const MENSAJE_BAJA = "Entendido, no te volveremos a escribir. Disculpa las molestias 🙏";

function normalizar(texto: string): string {
  return texto.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/**
 * Pedidos de baja ("no me escriban", "no deseo ser contactado"): el unico caso en que
 * el propio bot se apaga. Sirve tanto para el motivo que escribe el modelo como para el
 * mensaje del cliente. Con limites de palabra para que "bajar de peso" o "trabaja" no
 * apaguen el bot.
 */
export function esMotivoDeBaja(motivo: string): boolean {
  const t = normalizar(motivo);
  return (
    // "no me escriban", "no le contacten", "no molesten"
    /\bno (me |nos |le |les |lo |la )?(escriban|escribas|escribir|contacten|contactes|contactar|molesten|llamen)\b/.test(t) ||
    // "no ser contactado", "no desea ser contactada", "solicita no ser contactado mas"
    /\bno (\w+ )?(ser|seguir siendo) contactad[oa]s?\b/.test(t) ||
    // "no quiero recibir mas mensajes", "no desea recibir mensajes"
    /\bno (\w+ )?recibir (mas )?(mensajes|informacion|publicidad)\b/.test(t) ||
    // "no me manden/envien mas mensajes", "dejen de escribirme"
    /\bno (me |le )?(manden|envien|mandes|envies) (mas )?(mensajes|nada|informacion)\b/.test(t) ||
    /\bdej(en|a|ar) de (escribir|contactar|molestar|mandar|enviar)/.test(t) ||
    /\b(dar(me|lo|la)?|darse) de baja\b/.test(t) ||
    /\bbaja de (la )?(lista|difusion)\b/.test(t) ||
    /\bno contactar\b/.test(t)
  );
}
