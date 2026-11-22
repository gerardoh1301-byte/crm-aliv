/**
 * Fotos que manda el equipo (auditoría 21/11, E7).
 *
 * Desde R10 (18/11) las imágenes salientes ya no pasan por visión ni se etiquetan como del
 * cliente. Pero del 16 al 18/11 quedaron guardados 16 mensajes del teléfono con
 * «📷 [Imagen enviada por el cliente — …]» (fotos del producto, capturas de Shalom), y el bot
 * los sigue leyendo en el historial como si el cliente hubiera mandado esa foto. Al leer el
 * historial se corrige la etiqueta: lo saliente siempre es nuestro.
 */
const ETIQUETA_CLIENTE = "📷 [Imagen enviada por el cliente — ";
const ETIQUETA_NUESTRA = "📷 [Imagen que enviamos nosotros — ";

export function corregirImagenSaliente(direction: string | null | undefined, body: string | null): string | null {
  if (direction !== "out" || !body || !body.includes(ETIQUETA_CLIENTE)) return body;
  return body.split(ETIQUETA_CLIENTE).join(ETIQUETA_NUESTRA);
}
