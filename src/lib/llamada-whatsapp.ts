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

/** Tipo de actividad que se guarda cuando alguien presiona «Llamar». */
export const TIPO_LLAMADA_WHATSAPP = "llamada_whatsapp";
const PREFIJO = "Presionó Llamar (WhatsApp Web) · ";

export function descripcionLlamadaWhatsApp(nombreMiembro: string): string {
  return `${PREFIJO}${nombreMiembro}`;
}

/** Nombre de quien llamó, sacado de la descripción guardada. */
export function quienLlamo(descripcion: string): string {
  return descripcion.startsWith(PREFIJO) ? descripcion.slice(PREFIJO.length).trim() || "—" : "—";
}

/** Se llama en el clic del botón: anota la llamada sin frenar la apertura de WhatsApp. */
export function registrarLlamadaWhatsApp(contactId: string | null | undefined, dealId?: string | null): void {
  if (!contactId || typeof window === "undefined") return;
  try {
    void fetch("/api/activities/llamada-whatsapp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contactId, dealId: dealId ?? null }),
      keepalive: true,
    }).catch(() => {});
  } catch {
    // sin registro, la llamada igual se abre
  }
}
