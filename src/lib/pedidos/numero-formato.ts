/** Funciones puras de numeración de pedidos (sin base de datos). Ver numeracion.ts. */
export const PREFIJO_CHAT = "CHAT-";

export function esNumeroChat(numeroOrden: string | null | undefined): boolean {
  return /^CHAT-\d+$/i.test(String(numeroOrden ?? "").trim());
}

/** Formatea el correlativo: 1 -> "CHAT-0001". */
export function formatearNumeroChat(n: number): string {
  return `${PREFIJO_CHAT}${String(Math.max(1, Math.trunc(n))).padStart(4, "0")}`;
}

/** Siguiente número a partir de los existentes (función pura, para pruebas). */
export function siguienteNumeroChat(existentes: Array<string | null | undefined>): string {
  let max = 0;
  for (const raw of existentes) {
    const m = String(raw ?? "").trim().match(/^CHAT-(\d+)$/i);
    if (m) {
      const n = parseInt(m[1], 10);
      if (Number.isFinite(n) && n > max) max = n;
    }
  }
  return formatearNumeroChat(max + 1);
}

/** Número para mostrar al cliente: "#1148" y "CHAT-0001" tal cual; "1148" -> "#1148". */
export function mostrarNumeroOrden(numeroOrden: string | null | undefined): string {
  const n = String(numeroOrden ?? "").trim();
  if (!n) return "";
  if (n.startsWith("#") || esNumeroChat(n) || /^[A-Z]+-/i.test(n)) return n;
  return `#${n}`;
}

/** Horas máximas para que un pedido traído por sincronización reciba el mensaje de pedido nuevo. */
export const HORAS_AVISO_PEDIDO_IMPORTADO = 3;

/**
 * La sincronización con Shopify recupera pedidos que el webhook no registró. Si el pedido es
 * reciente, el cliente todavía espera el mensaje de confirmación; si es antiguo, lo más probable
 * es que alguien ya le escribió a mano y repetirlo confunde (caso #1148 del 19/11).
 */
export function debeAvisarPedidoImportado(
  creadoEn: string | Date | null | undefined,
  ahora: Date = new Date(),
  horas: number = HORAS_AVISO_PEDIDO_IMPORTADO
): boolean {
  if (!creadoEn) return false;
  const t = new Date(creadoEn).getTime();
  if (!Number.isFinite(t)) return false;
  return ahora.getTime() - t <= horas * 3_600_000;
}
