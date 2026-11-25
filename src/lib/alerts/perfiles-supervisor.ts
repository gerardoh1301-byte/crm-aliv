/**
 * Perfiles de supervisor y a quién va cada aviso por WhatsApp. ÚNICO lugar donde
 * viven los números de los supervisores: el resto del código los toma de aquí.
 *
 * - Administrador (Gerardo): recibe todo.
 * - Vendedor (Lourdes; Stephano desde el 25/11 en su número 977126462): solo lo comercial y la atención al cliente; nada de lo
 *   logístico ni del dinero (Shalom, guías, fletes, claves, saldos, AliClik, ERP).
 *
 * Ambos están en la lista blanca (`esNumeroEntrenador`): el bot no les crea pedidos,
 * no los rescata ni los cuenta en métricas.
 *
 * Módulo puro (sin base de datos) para poder probarlo sin servidor.
 */

export type PerfilSupervisor = "administrador" | "vendedor";

/** logistica incluye el dinero: pagos, fletes, saldos, adelantos, claves, ERP. */
export type CategoriaAviso = "logistica" | "atencion" | "comercial";

export interface Supervisor {
  nombre: string;
  /** Últimos 9 dígitos (Perú). */
  digitos: string;
  perfil: PerfilSupervisor;
  /** team_members.id: a este número le llega el resumen diario de sus clientes. */
  miembroId?: string;
}

export const SUPERVISORES: readonly Supervisor[] = [
  { nombre: "Gerardo", digitos: "951365418", perfil: "administrador", miembroId: "f3e73eac-683d-4624-98c3-c8cc3eeef824" },
  { nombre: "Lourdes", digitos: "945226853", perfil: "vendedor", miembroId: "b1480004-8861-4275-8b3b-6b5b1c74e014" },
  // Su número de vendedor (WhatsApp Business en coexistencia): recibe los avisos del 944 ahí.
  { nombre: "Stephano", digitos: "977126462", perfil: "vendedor", miembroId: "9ba60ead-998d-4e37-bcfa-2129fc346b20" },
];

export const CATEGORIAS_POR_PERFIL: Record<PerfilSupervisor, readonly CategoriaAviso[]> = {
  administrador: ["logistica", "atencion", "comercial"],
  vendedor: ["atencion", "comercial"],
};

export type TipoSituacionCritica =
  | "comprobante_pago"
  | "reclamo_medico"
  | "pide_humano_llamada"
  | "shalom_24h_retraso"
  | "shalom_preguia_pago_almacen"
  | "pedido_chat"
  | "pedido_shopify"
  | "guardrail_bloqueo"
  | "bot_sin_respuesta"
  | "shalom_envio_confirmado"
  | "cambio_agencia_con_guia"
  | "shalom_cambio_destino"
  | "aliclik_entregado";

/** Categoría de cada aviso. Un tipo nuevo no compila hasta que se le asigne una. */
export const CATEGORIA_AVISO: Record<TipoSituacionCritica, CategoriaAviso> = {
  // Logística y dinero: solo el Administrador.
  comprobante_pago: "logistica",
  shalom_24h_retraso: "logistica",
  shalom_preguia_pago_almacen: "logistica",
  shalom_envio_confirmado: "logistica",
  cambio_agencia_con_guia: "logistica",
  shalom_cambio_destino: "logistica",
  aliclik_entregado: "logistica",
  // Atención al cliente: Administrador y Vendedor.
  reclamo_medico: "atencion",
  pide_humano_llamada: "atencion",
  guardrail_bloqueo: "atencion",
  bot_sin_respuesta: "atencion",
  // Comercial: Administrador y Vendedor.
  pedido_chat: "comercial",
  pedido_shopify: "comercial",
};

/** Últimos 9 dígitos de cada supervisor (para consultas SQL y comparaciones). */
export const SUPERVISORES_DIGITOS: readonly string[] = SUPERVISORES.map((s) => s.digitos);

/** El Administrador: único que puede dar órdenes por WhatsApp (pago, flete, clave, entregado, adelanto). */
export const SUPERVISOR_ADMINISTRADOR: string = SUPERVISORES.find((s) => s.perfil === "administrador")!.digitos;

/** Supervisores (9 dígitos) que deben recibir un aviso de este tipo. */
export function destinatariosAviso(tipo: TipoSituacionCritica): string[] {
  const categoria = CATEGORIA_AVISO[tipo];
  return SUPERVISORES.filter((s) => CATEGORIAS_POR_PERFIL[s.perfil].includes(categoria)).map((s) => s.digitos);
}
