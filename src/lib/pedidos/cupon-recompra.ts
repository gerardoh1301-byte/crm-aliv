/**
 * Cupón de recompra (mejora 6 del informe CRM Driven, 24/11).
 * Reglas puras, sin base de datos.
 *
 * Al enviar la clave de retiro el cliente recibe S/ 15 de descuento para su próxima compra
 * por WhatsApp, válido 30 días. Se guarda en contacts.customFields.cupon_recompra; el bot lo
 * descuenta una sola vez al registrar el siguiente pedido (crear_pedido_chat).
 */

export const CUPON_MONTO = 15;
export const CUPON_DIAS = 30;
export const CAMPO_CUPON = "cupon_recompra";

export interface CuponRecompra {
  monto: number;
  otorgado: string; // ISO
  vence: string; // ISO
  usado: boolean;
  pedido_origen: string | null;
  usado_en?: string | null;
  usado_el?: string | null;
}

export function crearCupon(pedidoOrigen: string | null, ahora: Date = new Date()): CuponRecompra {
  const vence = new Date(ahora.getTime() + CUPON_DIAS * 24 * 60 * 60 * 1000);
  return {
    monto: CUPON_MONTO,
    otorgado: ahora.toISOString(),
    vence: vence.toISOString(),
    usado: false,
    pedido_origen: pedidoOrigen,
  };
}

function esCupon(v: unknown): v is CuponRecompra {
  if (!v || typeof v !== "object") return false;
  const c = v as Record<string, unknown>;
  return typeof c.monto === "number" && typeof c.vence === "string";
}

/** Cupón sin usar y sin vencer, o null. */
export function cuponVigente(customFields: unknown, ahora: Date = new Date()): CuponRecompra | null {
  const cf = (customFields as Record<string, unknown> | null) ?? {};
  const c = cf[CAMPO_CUPON];
  if (!esCupon(c) || c.usado || !(c.monto > 0)) return null;
  const vence = new Date(c.vence).getTime();
  if (!Number.isFinite(vence) || vence < ahora.getTime()) return null;
  return c;
}

/**
 * Cupón a guardar al enviar la clave. Si ya tiene uno vigente se conserva (no se
 * acumulan ni se alarga la fecha con cada clave).
 */
export function cuponParaOtorgar(
  customFields: unknown,
  pedidoOrigen: string | null,
  ahora: Date = new Date()
): CuponRecompra | null {
  if (cuponVigente(customFields, ahora)) return null;
  return crearCupon(pedidoOrigen, ahora);
}

/** Descuento aplicable: nunca deja el total en menos de S/ 1. */
export function aplicarCupon(total: number, cupon: CuponRecompra | null): { total: number; descuento: number } {
  if (!cupon || !(total > 0)) return { total, descuento: 0 };
  const descuento = Math.min(cupon.monto, Math.max(0, total - 1));
  return { total: Math.round((total - descuento) * 100) / 100, descuento };
}

export function marcarUsado(c: CuponRecompra, numeroOrden: string, ahora: Date = new Date()): CuponRecompra {
  return { ...c, usado: true, usado_en: numeroOrden, usado_el: ahora.toISOString() };
}

export function fechaCorta(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("es-PE", { day: "numeric", month: "long", timeZone: "America/Lima" });
}

/** Cierre del mensaje de la clave. */
export function lineaCupon(c: CuponRecompra): string {
  return `🎁 Por ser cliente Aliv tienes *S/ ${c.monto} de descuento* en tu próxima compra, válido hasta el ${fechaCorta(
    c.vence
  )}. Solo escríbenos por aquí cuando quieras repetir tu pedido o probar otro producto y te lo aplicamos 🛍️`;
}

/** Bloque para el prompt del bot cuando el cliente tiene cupón vigente. */
export function bloqueCuponParaBot(c: CuponRecompra): string {
  return (
    `🎁 CUPÓN DE RECOMPRA VIGENTE: este cliente tiene S/ ${c.monto} de descuento en su próxima compra (vence el ${fechaCorta(c.vence)}). ` +
    "Recuérdaselo al ofrecerle la recompra. Al registrar el pedido con `crear_pedido_chat` el descuento se aplica SOLO (no restes nada tú): " +
    "dile el total que devuelva la herramienta. Es de un solo uso y no se suma a otros cupones."
  );
}
