/**
 * Cambiar un pedido de contra entrega (AliClik) a agencia Shalom y viceversa (26/11).
 *
 * El tipo de entrega se lee en varios lados: el pipeline (transportadora, modalidad, guía,
 * marcas), el bot (modalidad + marca [ENTREGA_WEB:…]) y la sincronización con AliClik
 * ([ALICLIK_ORDEN:…]). Aquí se calcula, sin tocar la base, cómo quedan esos campos.
 */

export type DestinoEntrega = "shalom" | "cod";

export interface PedidoCambioEntrega {
  numeroOrden: string;
  estado: string;
  transportadora: string | null;
  modalidadPago: string | null;
  notas: string | null;
  numeroGuia: string | null;
  claveRecojo: string | null;
  ciudad: string | null;
  distrito: string | null;
}

export interface PlanCambioEntrega {
  transportadora: string;
  modalidadPago: "contraentrega" | "adelanto_agencia";
  notas: string;
  /** Texto para customFields.modalidad_entrega del contacto (lo lee el bot). */
  modalidadEntrega: string;
  /** Línea para la actividad del contacto. */
  resumen: string;
  /** Al pasar a contra entrega se vacían los datos de la guía Shalom anulada (quedan en notas). */
  limpiarGuia: boolean;
}

export type ResultadoPlan =
  | { ok: true; plan: PlanCambioEntrega }
  /** `confirmar`: se puede seguir si el usuario confirma (orden o guía ya creadas). */
  | { ok: false; error: string; confirmar?: boolean };

const ESTADOS_CERRADOS = new Set(["entregado", "cancelado", "devuelto", "anulado"]);
const MARCA_ENTREGA = /\[ENTREGA_WEB:[^\]]*\]\n?/g;
const MARCA_ORDEN = /\[ALICLIK_ORDEN:([^\]]+)\]/i;

export function esLimaPedido(p: { ciudad: string | null; distrito: string | null }): boolean {
  return /lima|callao/i.test(`${p.ciudad ?? ""} ${p.distrito ?? ""}`);
}

export function tipoEntregaActual(p: PedidoCambioEntrega): DestinoEntrega {
  return /shalom/i.test(p.transportadora ?? "") || p.modalidadPago === "adelanto_agencia" ? "shalom" : "cod";
}

export function planCambioEntrega(
  p: PedidoCambioEntrega,
  destino: DestinoEntrega,
  opts: { confirmado?: boolean; ahora?: Date } = {}
): ResultadoPlan {
  if (ESTADOS_CERRADOS.has(p.estado)) {
    return { ok: false, error: `${p.numeroOrden} está ${p.estado}: ya no se cambia el tipo de entrega.` };
  }
  // Un pedido de provincia con «contraentrega» pero sin marca CE se ve como Shalom en el
  // pipeline: pasarlo a contra entrega solo le pone la marca.
  const yaMarcadoCod = /\[ENTREGA_WEB:CE\|/.test(p.notas ?? "") || /aliclik/i.test(p.transportadora ?? "");
  if (tipoEntregaActual(p) === destino && (destino === "shalom" || yaMarcadoCod)) {
    return { ok: false, error: `${p.numeroOrden} ya es ${destino === "shalom" ? "agencia Shalom" : "contra entrega"}.` };
  }

  const fecha = (opts.ahora ?? new Date()).toISOString().slice(0, 10);
  const lugar = [p.distrito, p.ciudad].filter(Boolean).join(", ");
  let notas = (p.notas ?? "").replace(MARCA_ENTREGA, "").trimEnd();

  if (destino === "shalom") {
    const orden = MARCA_ORDEN.exec(notas)?.[1]?.trim();
    if (orden && !opts.confirmado) {
      return {
        ok: false,
        confirmar: true,
        error: `${p.numeroOrden} ya está registrado en AliClik contra entrega (orden ${orden}). Anúlala en AliClik y luego confirma el cambio.`,
      };
    }
    // La orden COD anulada queda como «anterior»: la sincronización ya no la sigue ni la vuelve a cruzar.
    if (orden) notas = notas.replace(MARCA_ORDEN, `[ALICLIK_ORDEN_ANTERIOR:${orden}]`);
    notas = `${notas ? `${notas}\n` : ""}[ENTREGA_WEB:AG|manual${lugar ? `|${lugar}` : ""}|${fecha}]`;
    return {
      ok: true,
      plan: {
        transportadora: "Shalom",
        modalidadPago: "adelanto_agencia",
        notas,
        modalidadEntrega: "Agencia Shalom / Olva (Provincia)",
        resumen: `cambiado de contra entrega a agencia Shalom (adelanto S/20)${orden ? `; orden AliClik ${orden} anulada` : ""}`,
        limpiarGuia: false,
      },
    };
  }

  if ((p.numeroGuia || p.claveRecojo) && !opts.confirmado) {
    return {
      ok: false,
      confirmar: true,
      error: `${p.numeroOrden} ya tiene guía Shalom${p.numeroGuia ? ` (N° ${p.numeroGuia})` : ""}. Anúlala en Shalom y luego confirma el cambio.`,
    };
  }
  const lima = esLimaPedido(p);
  if (p.numeroGuia || p.claveRecojo) {
    notas = `${notas ? `${notas}\n` : ""}[GUIA_SHALOM_ANTERIOR:${p.numeroGuia ?? "-"}|clave ${p.claveRecojo ?? "-"}]`;
  }
  notas = `${notas ? `${notas}\n` : ""}[ENTREGA_WEB:CE|${lima ? "lima" : "provincia_cod"}${lugar ? `|${lugar}` : ""}|${fecha}]`;
  return {
    ok: true,
    plan: {
      transportadora: "AliClik",
      modalidadPago: "contraentrega",
      notas,
      modalidadEntrega: lima ? "Contraentrega Domicilio (Lima)" : `Contraentrega Domicilio AliClik (${p.ciudad || "Provincia"})`,
      resumen: `cambiado de agencia Shalom a contra entrega AliClik${p.numeroGuia ? `; guía Shalom ${p.numeroGuia} anulada` : ""}`,
      limpiarGuia: Boolean(p.numeroGuia || p.claveRecojo),
    },
  };
}
