/**
 * Plantillas de WhatsApp enviadas por día, para que el ERP calcule cuánto cobra Meta
 * (25/11, pedido de Gerardo). Módulo puro: agrupa filas ya leídas de la base.
 *
 * Meta cobra cada plantilla ENTREGADA según su categoría. Las fallidas no se cobran, y una
 * de utilidad enviada dentro de la ventana de 24 h del cliente es gratis.
 */

export interface EnvioPlantilla {
  plantilla: string;
  categoria: string | null;
  estado: string;
  enviadoEn: Date | string;
  /** El cliente escribió en las 24 h previas al envío. */
  enVentana: boolean;
}

export interface DiaPlantillas {
  fecha: string;
  plantillas: {
    plantilla: string;
    categoria: string;
    entregadas: number;
    enVentana: number;
    fallidas: number;
  }[];
}

const FALLIDAS = new Set(["failed", "error", "rejected"]);

export function fechaLima(d: Date | string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Lima" }).format(new Date(d));
}

export function agruparPorDia(envios: EnvioPlantilla[]): DiaPlantillas[] {
  const dias = new Map<string, Map<string, DiaPlantillas["plantillas"][number]>>();
  for (const e of envios) {
    const fecha = fechaLima(e.enviadoEn);
    const porPlantilla = dias.get(fecha) ?? new Map();
    dias.set(fecha, porPlantilla);
    const fila =
      porPlantilla.get(e.plantilla) ??
      { plantilla: e.plantilla, categoria: (e.categoria || "SIN_CATEGORIA").toUpperCase(), entregadas: 0, enVentana: 0, fallidas: 0 };
    porPlantilla.set(e.plantilla, fila);
    if (FALLIDAS.has(e.estado)) fila.fallidas++;
    else {
      fila.entregadas++;
      if (e.enVentana) fila.enVentana++;
    }
  }
  return [...dias.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([fecha, m]) => ({ fecha, plantillas: [...m.values()].sort((a, b) => b.entregadas - a.entregadas) }));
}
