/**
 * Clasifica un pedido web (Shopify / EasySell) en AG (agencia Shalom con adelanto) o CE
 * (contra entrega a domicilio) usando la cobertura de AliClik, igual que hace el bot en el chat.
 *
 * - Lima / Callao: CE, sin consultar a AliClik.
 * - Provincia con contra entrega de AliClik: CE (sin adelanto ni agencia).
 * - Provincia sin cobertura, ubicación que no se reconoce o AliClik caído: AG (lo de siempre).
 *
 * Deja una marca en las notas para que el barrido de corrección no lo vuelva a evaluar.
 */

import type { DecisionEntrega } from "@/lib/aliclik/cobertura-cod";

export const MARCA_ENTREGA_WEB = "[ENTREGA_WEB:";

export interface ClasificacionEntregaWeb {
  modalidadPago: "contraentrega" | "adelanto_agencia";
  /** true = agencia Shalom con adelanto de S/20. */
  esAgencia: boolean;
  zona: DecisionEntrega["zona"] | "lima_formulario";
  lugar?: string;
  /** Texto para customFields.modalidad_entrega del contacto. */
  modalidadEntrega: string;
  /** Marca para las notas del pedido. */
  marca: string;
}

type Decidir = (p: { ciudad?: string | null; distrito?: string | null; direccion?: string | null }) => Promise<DecisionEntrega>;

async function decidirPorDefecto(p: Parameters<Decidir>[0]): Promise<DecisionEntrega> {
  const { decidirEntrega } = await import("@/lib/aliclik/cobertura-cod");
  return decidirEntrega(p);
}

export async function clasificarEntregaWeb(
  datos: { esProvincia: boolean; ciudad?: string | null; distrito?: string | null; direccion?: string | null },
  decidir: Decidir = decidirPorDefecto,
  timeoutMs = 3000
): Promise<ClasificacionEntregaWeb> {
  const fecha = new Date().toISOString().slice(0, 10);
  const ce = (zona: ClasificacionEntregaWeb["zona"], lugar?: string, etiqueta = "Contraentrega Domicilio (Lima)"): ClasificacionEntregaWeb => ({
    modalidadPago: "contraentrega",
    esAgencia: false,
    zona,
    lugar,
    modalidadEntrega: etiqueta,
    marca: `${MARCA_ENTREGA_WEB}CE|${zona}${lugar ? `|${lugar}` : ""}|${fecha}]`,
  });
  const ag = (zona: ClasificacionEntregaWeb["zona"], lugar?: string, motivo?: string): ClasificacionEntregaWeb => ({
    modalidadPago: "adelanto_agencia",
    esAgencia: true,
    zona,
    lugar,
    modalidadEntrega: "Agencia Shalom / Olva (Provincia)",
    marca: `${MARCA_ENTREGA_WEB}AG|${zona}${lugar ? `|${lugar}` : ""}${motivo ? `|${motivo}` : ""}|${fecha}]`,
  });

  if (!datos.esProvincia) return ce("lima_formulario");

  let d: DecisionEntrega;
  try {
    // Shopify corta el webhook a los 5 s: si AliClik tarda más de 3 s, queda en agencia (lo de antes).
    d = await Promise.race([
      decidir({ ciudad: datos.ciudad, distrito: datos.distrito, direccion: datos.direccion }),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error("AliClik tardó más de 3 s")), timeoutMs)),
    ]);
  } catch (err) {
    return ag("desconocida", undefined, `error ${err instanceof Error ? err.message.slice(0, 60) : "AliClik"}`);
  }
  if (d.zona === "lima") return ce("lima", d.lugar);
  if (d.zona === "provincia_cod") return ce("provincia_cod", d.lugar, `Contraentrega Domicilio AliClik (${d.lugar || "Provincia"})`);
  if (d.zona === "provincia_shalom") {
    const motivo = d.cobertura?.estado === "desconocido" ? "AliClik no respondió" : undefined;
    return ag("provincia_shalom", d.lugar, motivo);
  }
  return ag("desconocida", undefined, "ciudad no reconocida");
}

/** Una línea legible para las notas del pedido y el aviso al equipo. */
export function textoClasificacion(c: ClasificacionEntregaWeb): string {
  if (c.zona === "provincia_cod") return `contra entrega AliClik en ${c.lugar || "provincia"} (sin adelanto)`;
  if (c.esAgencia) return "provincia: agencia Shalom, falta adelanto S/20";
  return "contra entrega en Lima";
}
