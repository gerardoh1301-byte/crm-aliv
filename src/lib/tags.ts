export interface EtiquetaConfig {
  id: string;
  nombre: string;
  color: string;
  badge: string;
  dot?: string;
}

/**
 * 5 Etiquetas principales solicitadas para clasificar y dar seguimiento
 * rápido a cada conversación en el CRM de Aliv Perú.
 */
export const ETIQUETAS_PRINCIPALES: EtiquetaConfig[] = [
  {
    id: "compra-exitosa",
    nombre: "Compra exitosa",
    color: "bg-emerald-500/15 text-emerald-800 dark:text-emerald-300 border-emerald-500/40 hover:bg-emerald-500/25",
    badge: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 border-emerald-300/80 dark:border-emerald-700 font-semibold",
    dot: "bg-emerald-500",
  },
  {
    id: "orden-en-camino",
    nombre: "Orden en camino",
    color: "bg-blue-500/15 text-blue-800 dark:text-blue-300 border-blue-500/40 hover:bg-blue-500/25",
    badge: "bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300 border-blue-300/80 dark:border-blue-700 font-semibold",
    dot: "bg-blue-500",
  },
  {
    id: "pendiente-adelanto",
    nombre: "Pendiente de adelanto",
    color: "bg-amber-500/15 text-amber-800 dark:text-amber-300 border-amber-500/40 hover:bg-amber-500/25",
    badge: "bg-amber-50 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 border-amber-300/80 dark:border-amber-700 font-semibold",
    dot: "bg-amber-500",
  },
  {
    id: "agendar-entrega",
    nombre: "Agendar entrega",
    color: "bg-purple-500/15 text-purple-800 dark:text-purple-300 border-purple-500/40 hover:bg-purple-500/25",
    badge: "bg-purple-50 text-purple-700 dark:bg-purple-950/60 dark:text-purple-300 border-purple-300/80 dark:border-purple-700 font-semibold",
    dot: "bg-purple-500",
  },
  {
    id: "informativo",
    nombre: "Informativo",
    color: "bg-sky-500/15 text-sky-800 dark:text-sky-300 border-sky-500/40 hover:bg-sky-500/25",
    badge: "bg-sky-50 text-sky-700 dark:bg-sky-950/60 dark:text-sky-300 border-sky-300/80 dark:border-sky-700 font-semibold",
    dot: "bg-sky-500",
  },
];

export const ETIQUETAS_SECUNDARIAS: EtiquetaConfig[] = [
  {
    id: "pendiente-courier",
    nombre: "pendiente de courier",
    color: "bg-orange-500/10 text-orange-700 dark:text-orange-300 border-orange-500/30 hover:bg-orange-500/20",
    badge: "bg-orange-50 text-orange-700 dark:bg-orange-950/50 dark:text-orange-300 border-orange-300/60",
    dot: "bg-orange-500",
  },
  {
    id: "pendiente-envio",
    nombre: "pendiente de envío",
    color: "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30 hover:bg-amber-500/20",
    badge: "bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300 border-amber-300/60",
    dot: "bg-amber-500",
  },
  {
    id: "pendiente-cobro",
    nombre: "pendiente de cobro",
    color: "bg-purple-500/10 text-purple-700 dark:text-purple-300 border-purple-500/30 hover:bg-purple-500/20",
    badge: "bg-purple-50 text-purple-700 dark:bg-purple-950/50 dark:text-purple-300 border-purple-300/60",
    dot: "bg-purple-500",
  },
  {
    id: "adelanto-pagado",
    nombre: "adelanto pagado",
    color: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30 hover:bg-emerald-500/20",
    badge: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300 border-emerald-300/60",
    dot: "bg-emerald-500",
  },
  {
    id: "pedido-confirmado",
    nombre: "pedido confirmado",
    color: "bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-500/30 hover:bg-blue-500/20",
    badge: "bg-blue-50 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300 border-blue-300/60",
    dot: "bg-blue-500",
  },
  {
    id: "en-agencia-shalom",
    nombre: "en agencia shalom",
    color: "bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/30 hover:bg-rose-500/20",
    badge: "bg-rose-50 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300 border-rose-300/60",
    dot: "bg-rose-500",
  },
  {
    id: "motorizado-lima",
    nombre: "motorizado lima",
    color: "bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 border-indigo-500/30 hover:bg-indigo-500/20",
    badge: "bg-indigo-50 text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300 border-indigo-300/60",
    dot: "bg-indigo-500",
  },
  {
    id: "esperando-respuesta",
    nombre: "esperando respuesta",
    color: "bg-slate-500/10 text-slate-700 dark:text-slate-300 border-slate-500/30 hover:bg-slate-500/20",
    badge: "bg-slate-50 text-slate-700 dark:bg-slate-950/50 dark:text-slate-300 border-slate-300/60",
    dot: "bg-slate-500",
  },
  {
    id: "cancelado",
    nombre: "Cancelado",
    color: "bg-red-500/10 text-red-700 dark:text-red-300 border-red-500/30 hover:bg-red-500/20",
    badge: "bg-red-50 text-red-700 dark:bg-red-950/50 dark:text-red-300 border-red-300/60 font-semibold",
    dot: "bg-red-500",
  },
];

export const TODAS_LAS_ETIQUETAS: EtiquetaConfig[] = [
  ...ETIQUETAS_PRINCIPALES,
  ...ETIQUETAS_SECUNDARIAS,
];

/**
 * Normaliza nombres para coincidencias exactas o parciales sin importar tildes/mayúsculas.
 */
export function cleanStr(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

/**
 * Etiquetas que corresponden directamente a etapas operativas del pipeline / funnel.
 * Cuando un deal cambia de etapa en el pipeline, la etiqueta previa de etapa se reemplaza
 * por la nueva para que el chat siempre refleje el estado real de la operación.
 */
export const ETIQUETAS_DE_ETAPA: string[] = [
  "Compra exitosa",
  "Orden en camino",
  "Pendiente de adelanto",
  "Agendar entrega",
  "Informativo",
  "pedido confirmado",
  "Cancelado",
  "cancelado",
];

export function esEtiquetaDeEtapa(tag: string): boolean {
  const norm = cleanStr(tag);
  return ETIQUETAS_DE_ETAPA.some((e) => cleanStr(e) === norm);
}

/**
 * Determina la etiqueta de chat correspondiente a una etapa del pipeline.
 */
export function obtenerEtiquetaDeEtapa(stage: {
  key?: string | null;
  name?: string | null;
  isWon?: boolean | null;
  isLost?: boolean | null;
}): string | null {
  const k = (stage.key || "").toLowerCase().trim();
  const n = cleanStr(stage.name || "");

  // 1. Ganada / Entregado y Cobrado
  if (
    stage.isWon ||
    k === "entregado" ||
    n.includes("entregado") ||
    n.includes("cobrado") ||
    n.includes("exitosa")
  ) {
    return "Compra exitosa";
  }

  // 2. En camino / Despachado
  if (
    k === "en_reparto" ||
    n.includes("camino") ||
    n.includes("despachado") ||
    n.includes("reparto") ||
    n.includes("enviado") ||
    n.includes("ruta")
  ) {
    return "Orden en camino";
  }

  // 3. Agendar entrega / Pedido confirmado
  if (
    k === "agendar_entrega" ||
    k === "pedido_confirmado" ||
    n.includes("pedido confirmado") ||
    n.includes("confirmado") ||
    n.includes("agendar") ||
    n.includes("agendado")
  ) {
    return "Agendar entrega";
  }

  // 4. Por confirmar COD / Adelanto
  if (
    k === "por_confirmar_cod" ||
    n.includes("por confirmar") ||
    n.includes("adelanto") ||
    n.includes("contraentrega")
  ) {
    return "Pendiente de adelanto";
  }

  // 5. Consulta de producto / Intención de compra / Catálogo / Inicial
  if (
    k === "consulta_catalogo" ||
    k === "carrito_armado" ||
    n.includes("consulta") ||
    n.includes("intencion") ||
    n.includes("catalogo") ||
    n.includes("informativo")
  ) {
    return "Informativo";
  }

  // 6. Cancelado / Rechazado / Perdida
  if (
    stage.isLost ||
    k === "cancelado_rechazado" ||
    n.includes("cancel") ||
    n.includes("rechaz")
  ) {
    return "Cancelado";
  }

  // 7. Si coincide exactamente con alguna otra etiqueta del catálogo
  const exacta = TODAS_LAS_ETIQUETAS.find((e) => cleanStr(e.nombre) === n);
  if (exacta) return exacta.nombre;

  return null;
}

export function getTagStyle(tag: string): { label: string; color: string; badge: string; dot?: string } {
  const norm = cleanStr(tag);
  const found = TODAS_LAS_ETIQUETAS.find((e) => cleanStr(e.nombre) === norm);
  if (found) {
    return {
      label: found.nombre,
      color: found.color,
      badge: found.badge,
      dot: found.dot,
    };
  }
  return {
    label: tag,
    color: "bg-muted text-muted-foreground border-border",
    badge: "bg-muted/80 text-foreground/80 border-border/60",
    dot: "bg-muted-foreground",
  };
}
