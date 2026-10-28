import type { ItemPedido } from "./tabla";

export const API_PEDIDOS = "/api/m/pedidos";

export const ESTADOS_PEDIDO = [
  "por_confirmar_cod",
  "confirmado",
  "preparando",
  "enviado",
  "entregado",
  "cancelado",
] as const;

export type EstadoPedido = (typeof ESTADOS_PEDIDO)[number];

export const ETIQUETA_ESTADO_PEDIDO: Record<EstadoPedido, string> = {
  por_confirmar_cod: "Por confirmar COD",
  confirmado: "Confirmado",
  preparando: "En preparación",
  enviado: "En camino / Despachado",
  entregado: "Entregado y Cobrado",
  cancelado: "Cancelado / Rechazado",
};

export const TRANSPORTADORAS_PERU = [
  "Motorizado Aliv (Lima)",
  "Shalom Empresarial",
  "Olva Courier",
  "Marvisur",
  " Urbano Express",
] as const;

export const MODALIDADES_PAGO = [
  { valor: "contraentrega", etiqueta: "Contraentrega (Efectivo / Yape / Plin al recibir)" },
  { valor: "yape", etiqueta: "Yape (Adelanto / Pago total)" },
  { valor: "plin", etiqueta: "Plin (Adelanto / Pago total)" },
  { valor: "adelanto_agencia", etiqueta: "Adelanto Envío + Saldo en Agencia Shalom/Olva" },
  { valor: "tarjeta", etiqueta: "Tarjeta / Checkout Web (alivstore.shop)" },
] as const;

export interface PedidoConContacto {
  id: string;
  numeroOrden: string;
  shopifyOrderId: string | null;
  contactId: string;
  dealId: string | null;
  estado: EstadoPedido;
  modalidadPago: string;
  items: ItemPedido[];
  total: string;
  moneda: string;
  dniCliente: string | null;
  ciudad: string | null;
  distrito: string | null;
  direccionEnvio: string | null;
  transportadora: string | null;
  numeroGuia: string | null;
  claveRecojo: string | null;
  notas: string | null;
  createdAt: string | Date;
  updatedAt: string | Date;
  contactName: string | null;
  contactPhone: string | null;
}
