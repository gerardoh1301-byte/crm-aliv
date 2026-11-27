/**
 * Contactos bloqueados por spam o por hacer perder el tiempo (orden de Gerardo).
 *
 * Un contacto con esta etiqueta no recibe nada automático: ni llamadas de IA
 * (aunque se fuercen), ni la secuencia de abandono. El bot se apaga aparte con
 * ai_enabled = false en el contacto y en sus chats.
 * Para desbloquear basta con quitar la etiqueta de la ficha.
 */
export const TAG_BLOQUEADO = "bloqueado_spam";

export function contactoBloqueado(tags: readonly string[] | null | undefined): boolean {
  return (tags ?? []).some((t) => t.trim().toLowerCase() === TAG_BLOQUEADO);
}
