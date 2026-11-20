/**
 * Primer nombre apto para saludar ("¡Hola, Rosa!"), o null si el nombre guardado no sirve.
 *
 * Muchos contactos guardan el usuario de WhatsApp pegado ("chambearevalocarlosalbert",
 * "rodriguezruizlita") o textos que no son nombres. Saludar con eso suena a robot, así que
 * en esos casos es mejor un "¡Hola!" sin nombre.
 */
const NO_SON_NOMBRES =
  /^(whatsapp|web|cliente|lead|desconocido|usuario|sin|hola|estimad[oa]|amig[oa]|se[nñ]or[a]?|sr|sra|don|do[nñ]a|mi|el|la|aliv|tienda|bodega|centro|ventas)$/i;

export function nombreParaSaludo(nombre: string | null | undefined): string | null {
  const limpio = String(nombre ?? "").trim();
  if (!limpio || /\d|@|_/.test(limpio)) return null;
  const primero = limpio.split(/\s+/)[0].replace(/[^a-zA-ZáéíóúÁÉÍÓÚñÑüÜ'-]/g, "");
  if (primero.length < 2 || primero.length > 12) return null;
  if (NO_SON_NOMBRES.test(primero)) return null;
  // Usuario pegado sin espacios y todo en minúsculas: "lita123" ya cayó por los dígitos;
  // "rodriguezruizlita" cae por largo; "jose" sí pasa.
  return primero.charAt(0).toUpperCase() + primero.slice(1).toLowerCase();
}
