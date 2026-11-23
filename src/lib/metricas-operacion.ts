/**
 * Matriz operativa (clase CRM Driven, 22/11): confirmación y entrega por semana, producto y
 * tipo de envío — AG (agencia Shalom, con adelanto) vs CE (contra entrega / domicilio).
 * Funciones puras; la consulta vive en metricas.ts.
 *
 * Definiciones (iguales a las de la clase):
 *  - recibidos: todos los pedidos creados en la semana.
 *  - confirmados: pasaron a confirmado/preparando/enviado/entregado, o se cancelaron ya despachados.
 *  - entregados: estado entregado.
 *  - desc_confirmacion: cancelados antes de despachar. desc_entrega: cancelados ya despachados.
 *  - en_curso: aún sin resolver (por confirmar, confirmados sin entregar).
 */

export type TipoEnvio = "AG" | "CE";
export type ProductoOperacion = "NAC600" | "TERMIX" | "OTRO";

export interface PedidoOperacion {
  fecha: string; // YYYY-MM-DD (Lima)
  estado: string;
  total: number;
  unidades: number;
  producto: string | null;
  modalidad_pago: string | null;
  transportadora: string | null;
  despachado: boolean;
  flete_shalom: number | null;
}

export interface FilaOperacion {
  semana: string; // lunes de la semana, YYYY-MM-DD
  producto: ProductoOperacion;
  tipo: TipoEnvio;
  recibidos: number;
  confirmados: number;
  entregados: number;
  desc_confirmacion: number;
  desc_entrega: number;
  en_curso: number;
  ingresos_entregados: number;
  unidades_entregadas: number;
  flete_shalom_real: number;
}

export function tipoEnvio(p: Pick<PedidoOperacion, "modalidad_pago" | "transportadora">): TipoEnvio {
  if (p.modalidad_pago === "adelanto_agencia" || /shalom|olva/i.test(p.transportadora ?? "")) return "AG";
  return "CE";
}

export function productoOperacion(titulo: string | null): ProductoOperacion {
  const t = (titulo ?? "").toLowerCase();
  if (/termix|tobiller/.test(t)) return "TERMIX";
  if (/nac\s?600|nad\+?|cápsul|capsul/.test(t)) return "NAC600";
  return "OTRO";
}

/** Lunes (Lima) de la semana de una fecha YYYY-MM-DD. */
export function lunesDeSemana(fecha: string): string {
  const d = new Date(`${fecha}T12:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7; // 0 = lunes
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}

const CONFIRMADOS = new Set(["confirmado", "preparando", "enviado", "entregado"]);

export function matrizOperacion(pedidos: PedidoOperacion[]): FilaOperacion[] {
  const filas = new Map<string, FilaOperacion>();
  for (const p of pedidos) {
    const semana = lunesDeSemana(p.fecha);
    const producto = productoOperacion(p.producto);
    const tipo = tipoEnvio(p);
    const clave = `${semana}|${producto}|${tipo}`;
    let f = filas.get(clave);
    if (!f) {
      f = {
        semana, producto, tipo,
        recibidos: 0, confirmados: 0, entregados: 0, desc_confirmacion: 0, desc_entrega: 0, en_curso: 0,
        ingresos_entregados: 0, unidades_entregadas: 0, flete_shalom_real: 0,
      };
      filas.set(clave, f);
    }
    f.recibidos++;
    const estado = (p.estado ?? "").toLowerCase();
    if (estado === "cancelado") {
      if (p.despachado) {
        f.confirmados++;
        f.desc_entrega++;
      } else {
        f.desc_confirmacion++;
      }
      continue;
    }
    if (CONFIRMADOS.has(estado)) f.confirmados++;
    if (estado === "entregado") {
      f.entregados++;
      f.ingresos_entregados += p.total || 0;
      f.unidades_entregadas += p.unidades || 0;
      if (tipo === "AG" && p.flete_shalom) f.flete_shalom_real += p.flete_shalom;
    } else {
      f.en_curso++;
    }
  }
  return [...filas.values()].sort(
    (a, b) => a.semana.localeCompare(b.semana) || a.producto.localeCompare(b.producto) || a.tipo.localeCompare(b.tipo)
  );
}

/** Flete Shalom registrado en las notas del pedido ([SHALOM_FLETE:8.00|...]). */
export function fleteShalomDeNotas(notas: string | null | undefined): number | null {
  const m = /\[SHALOM_FLETE:(\d+(?:\.\d+)?)/.exec(notas ?? "");
  return m ? Number(m[1]) : null;
}
