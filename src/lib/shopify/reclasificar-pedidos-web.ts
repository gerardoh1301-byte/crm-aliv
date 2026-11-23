/**
 * Corrección de los pedidos web de las últimas 9 semanas que entraron todos como contra
 * entrega: los clasifica con la cobertura de AliClik (AG/CE) y les deja la marca
 * [ENTREGA_WEB:…] para no volver a tocarlos. Idempotente; lo llama barridos.ts.
 *
 * No toca pedidos que ya tienen courier (transportadora, guía, orden AliClik o aviso de
 * llegada a agencia): ahí el tipo de envío ya es un hecho, no una estimación.
 */

import { and, gte, isNotNull, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { pedidosOrdenes } from "../../../modules/pedidos/tabla";
import { esPedidoDeProvincia } from "@/lib/pedidos/adelanto";
import { clasificarEntregaWeb, MARCA_ENTREGA_WEB } from "./clasificar-entrega-web";

const DIAS_ATRAS = 63;
const LOTE = 25;

export interface ResultadoReclasificacion {
  revisados: number;
  aAgencia: string[];
  contraEntrega: number;
  pendientes: boolean;
}

export async function reclasificarPedidosWeb(opts: { aplicar: boolean }): Promise<ResultadoReclasificacion> {
  const desde = new Date(Date.now() - DIAS_ATRAS * 24 * 60 * 60 * 1000);
  const filas = await db
    .select({
      id: pedidosOrdenes.id,
      numeroOrden: pedidosOrdenes.numeroOrden,
      modalidadPago: pedidosOrdenes.modalidadPago,
      ciudad: pedidosOrdenes.ciudad,
      distrito: pedidosOrdenes.distrito,
      direccionEnvio: pedidosOrdenes.direccionEnvio,
      notas: pedidosOrdenes.notas,
    })
    .from(pedidosOrdenes)
    .where(
      and(
        isNotNull(pedidosOrdenes.shopifyOrderId),
        gte(pedidosOrdenes.createdAt, desde),
        sql`${pedidosOrdenes.modalidadPago} = 'contraentrega'`,
        isNull(pedidosOrdenes.transportadora),
        isNull(pedidosOrdenes.numeroGuia),
        sql`position(${MARCA_ENTREGA_WEB} in coalesce(${pedidosOrdenes.notas}, '')) = 0`,
        sql`position('[ALICLIK_ORDEN' in coalesce(${pedidosOrdenes.notas}, '')) = 0`,
        sql`position('[AVISO_LLEGADA_ENVIADO' in coalesce(${pedidosOrdenes.notas}, '')) = 0`
      )
    )
    .limit(LOTE + 1);

  const res: ResultadoReclasificacion = { revisados: 0, aAgencia: [], contraEntrega: 0, pendientes: filas.length > LOTE };
  for (const p of filas.slice(0, LOTE)) {
    res.revisados++;
    const c = await clasificarEntregaWeb({
      esProvincia: esPedidoDeProvincia({ ciudad: p.ciudad, distrito: p.distrito, direccionEnvio: p.direccionEnvio }),
      ciudad: p.ciudad,
      distrito: p.distrito,
      direccion: p.direccionEnvio,
    });
    if (c.esAgencia) res.aAgencia.push(p.numeroOrden);
    else res.contraEntrega++;
    if (!opts.aplicar) continue;
    await db
      .update(pedidosOrdenes)
      .set({
        modalidadPago: c.modalidadPago,
        notas: `${p.notas ? `${p.notas}\n` : ""}${c.marca.replace("]", "|corregido]")}`,
      })
      .where(sql`${pedidosOrdenes.id} = ${p.id}`);
  }
  return res;
}
