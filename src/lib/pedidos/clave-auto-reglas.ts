/**
 * Clave de retiro al arrastrar la tarjeta (mejora 6 del informe CRM Driven, 24/11).
 * Reglas puras, sin base de datos.
 *
 * Antes, arrastrar una tarjeta Shalom a «Entregado y Cobrado» registraba el saldo en el ERP
 * pero el cliente no recibía su clave: había que pulsar «Enviar Clave Auto» o escribir
 * «ENVIAR 1140». Ahora el arrastre la envía sola, una sola vez.
 */

export const TAG_CLAVE_ENVIADA = "CLAVE_ENVIADA_WHATSAPP";

/** Etapa «Entregado y Cobrado» (por clave o por nombre). La usa también la regla del saldo. */
export function esEtapaEntregado(stage: { key: string | null; name: string | null }): boolean {
  const nombre = (stage.name || "").toLowerCase();
  return stage.key === "entregado" || nombre.includes("entregado") || nombre.includes("cobrado");
}

export interface PedidoClaveAuto {
  modalidadPago: string | null;
  transportadora: string | null;
  notas: string | null;
  claveRecojo: string | null;
}

export function esPedidoShalom(p: Pick<PedidoClaveAuto, "modalidadPago" | "transportadora" | "notas">): boolean {
  return (
    p.modalidadPago === "adelanto_agencia" ||
    /shalom/i.test(p.transportadora || "") ||
    /shalom/i.test(p.notas || "")
  );
}

/** La clave ya salió: marca del CRM o un mensaje saliente del chat que la contiene. */
export function claveYaEnviada(p: PedidoClaveAuto, mensajesSalientes: (string | null)[]): boolean {
  if ((p.notas || "").includes(`[${TAG_CLAVE_ENVIADA}`)) return true;
  const clave = (p.claveRecojo || "").trim();
  if (!clave) return false;
  // La clave es corta (4 cifras): solo cuenta si el mensaje habla de la clave.
  const re = new RegExp(`(^|\\D)${clave.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\D|$)`);
  return mensajesSalientes.some((m) => !!m && /clave/i.test(m) && re.test(m));
}

export type MotivoNoEnvio = "no_shalom" | "sin_clave" | "ya_enviada";

export function motivoParaNoEnviar(p: PedidoClaveAuto, mensajesSalientes: (string | null)[]): MotivoNoEnvio | null {
  if (!esPedidoShalom(p)) return "no_shalom";
  if (!(p.claveRecojo || "").trim()) return "sin_clave";
  if (claveYaEnviada(p, mensajesSalientes)) return "ya_enviada";
  return null;
}

// El cierre del mensaje de la clave (cupón de S/ 15 para la recompra) está en cupon-recompra.ts.
