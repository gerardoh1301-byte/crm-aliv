/**
 * Botón de teléfono del CRM: abre el chat del cliente en WhatsApp Web
 * (en vez de `tel:`), para llamar desde ahí con el ícono de llamada y que
 * la llamada quede en el registro de WhatsApp.
 *
 * WhatsApp no tiene un enlace público que inicie la llamada sola: el enlace
 * abre el chat y la persona toca el ícono del teléfono.
 */

/** Deja solo dígitos y antepone 51 a un celular peruano de 9 dígitos. */
export function telefonoParaWhatsApp(phone: string): string {
  const digitos = phone.replace(/\D/g, "");
  if (digitos.length === 9 && digitos.startsWith("9")) return `51${digitos}`;
  return digitos;
}

export function enlaceLlamadaWhatsApp(phone: string): string {
  return `https://web.whatsapp.com/send?phone=${telefonoParaWhatsApp(phone)}`;
}

/** Nombre de pestaña fijo: reusa la misma pestaña de WhatsApp Web. */
export const PESTANA_WHATSAPP_WEB = "whatsapp-web";
