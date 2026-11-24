/**
 * Centro de Control ecommerce (mejora 1 del informe CRM Driven, 24/11). Reglas puras.
 *
 * Cada pedido cae en uno o más «cubos». Mismas definiciones que la matriz AG/CE
 * (metricas-operacion.ts): confirmados incluye a los cancelados ya despachados.
 */
import { tipoEnvio, type TipoEnvio } from "@/lib/metricas-operacion";

export interface PedidoCentro {
  id: string;
  numero: string;
  fecha: string; // YYYY-MM-DD (Lima)
  estado: string;
  total: number;
  modalidadPago: string | null;
  transportadora: string | null;
  numeroGuia: string | null;
  notas: string | null;
  contactId: string;
  nombre: string;
  telefono: string | null;
  asesor: string | null;
}

export const CUBOS_EMBUDO = [
  ["recibidos", "Recibidos"],
  ["seguimiento", "En seguimiento"],
  ["confirmados", "Confirmados"],
  ["entregados", "Entregados"],
  ["desc_confirmacion", "Descartados en confirmación"],
  ["desc_entrega", "Descartados en entrega"],
] as const;

export const CUBOS_LOGISTICA = [
  ["ag_despachados", "Despachados"],
  ["ag_transito", "En tránsito"],
  ["ag_agencia", "En agencia destino"],
  ["ag_entregados", "Entregados"],
  ["ag_descartados", "Descartados"],
] as const;

export type CuboEmbudo = (typeof CUBOS_EMBUDO)[number][0];
export type CuboLogistica = (typeof CUBOS_LOGISTICA)[number][0];
export type Cubo = CuboEmbudo | CuboLogistica;

const CONFIRMADOS = new Set(["confirmado", "preparando", "enviado", "entregado"]);

/** Igual que «despachado» en metricas.ts: guía, enviado/entregado, orden AliClik o aviso de llegada. */
export function estaDespachado(p: Pick<PedidoCentro, "estado" | "numeroGuia" | "notas">): boolean {
  const notas = p.notas ?? "";
  return (
    !!p.numeroGuia ||
    p.estado === "enviado" ||
    p.estado === "entregado" ||
    notas.includes("[ALICLIK_ORDEN") ||
    notas.includes("[AVISO_LLEGADA_ENVIADO")
  );
}

export function tipoPedido(p: Pick<PedidoCentro, "modalidadPago" | "transportadora">): TipoEnvio {
  return tipoEnvio({ modalidad_pago: p.modalidadPago, transportadora: p.transportadora });
}

export function cubosDePedido(p: PedidoCentro): Cubo[] {
  const estado = (p.estado ?? "").toLowerCase();
  const despachado = estaDespachado(p);
  const cubos: Cubo[] = ["recibidos"];

  if (estado === "cancelado") {
    if (despachado) cubos.push("confirmados", "desc_entrega");
    else cubos.push("desc_confirmacion");
  } else if (estado === "por_confirmar_cod") {
    cubos.push("seguimiento");
  } else if (CONFIRMADOS.has(estado)) {
    cubos.push("confirmados");
    if (estado === "entregado") cubos.push("entregados");
  }

  if (tipoPedido(p) === "AG" && despachado) {
    cubos.push("ag_despachados");
    if (estado === "entregado") cubos.push("ag_entregados");
    else if (estado === "cancelado") cubos.push("ag_descartados");
    else if ((p.notas ?? "").includes("[AVISO_LLEGADA_ENVIADO")) cubos.push("ag_agencia");
    else cubos.push("ag_transito");
  }
  return cubos;
}

export type Matriz = Record<"TOTAL" | TipoEnvio, Record<Cubo, PedidoCentro[]>>;

function vacio(): Record<Cubo, PedidoCentro[]> {
  const r = {} as Record<Cubo, PedidoCentro[]>;
  for (const [k] of CUBOS_EMBUDO) r[k] = [];
  for (const [k] of CUBOS_LOGISTICA) r[k] = [];
  return r;
}

export function armarMatriz(pedidos: PedidoCentro[]): Matriz {
  const m: Matriz = { TOTAL: vacio(), AG: vacio(), CE: vacio() };
  for (const p of pedidos) {
    const tipo = tipoPedido(p);
    for (const c of cubosDePedido(p)) {
      m.TOTAL[c].push(p);
      m[tipo][c].push(p);
    }
  }
  return m;
}
