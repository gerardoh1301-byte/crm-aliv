import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { contacts, deals, pipelineStages } from "@/db/schema";
import { pedidosOrdenes } from "../../../../../modules/pedidos/tabla";
import { and, desc, eq, isNull } from "drizzle-orm";
import { autorizadoPorSecreto } from "@/lib/secreto-worker";
import { requireAdmin } from "@/lib/api-auth";
import {
  construirNombreArchivoPreguia,
  generarClaveRetiroShalomUnica,
  SHALOM_PREGUIAS_DRIVE_FOLDER_ID,
  SHALOM_PRO_ORIGEN_FIJO,
  validarDatosIndispensablesShalomPro,
} from "@/lib/shalom-pro/clave-retiro";

export const dynamic = "force-dynamic";

async function autorizar(req: NextRequest): Promise<NextResponse | null> {
  if (autorizadoPorSecreto(req)) return null;
  const auth = await requireAdmin();
  if ("response" in auth) return auth.response;
  return null;
}

/**
 * GET /api/shalom-pro/pendientes
 *
 * Lista los pedidos listos para autogeneración de preguía en Shalom PRO + AliClik:
 * 1. Adelanto S/ 20 confirmado por humano ([ADELANTO VERIFICADO] en notas)
 * 2. Deal en etapa `adelanto_pagado`
 * 3. Cuenta con información indispensable: nombre, DNI (8 dígitos) y agencia Shalom localizada
 * 4. Aún sin número de guía ni excluido manualmente ([SHALOM_AUTO_EXCLUIDO])
 */
export async function GET(req: NextRequest) {
  const denied = await autorizar(req);
  if (denied) return denied;

  try {
    const rows = await db
      .select({
        pedidoId: pedidosOrdenes.id,
        numeroOrden: pedidosOrdenes.numeroOrden,
        dniCliente: pedidosOrdenes.dniCliente,
        ciudad: pedidosOrdenes.ciudad,
        distrito: pedidosOrdenes.distrito,
        direccionEnvio: pedidosOrdenes.direccionEnvio,
        items: pedidosOrdenes.items,
        total: pedidosOrdenes.total,
        notas: pedidosOrdenes.notas,
        numeroGuia: pedidosOrdenes.numeroGuia,
        dealId: pedidosOrdenes.dealId,
        stageKey: pipelineStages.key,
        contactId: contacts.id,
        contactName: contacts.name,
        contactPhone: contacts.phone,
        contactTags: contacts.tags,
      })
      .from(pedidosOrdenes)
      .innerJoin(contacts, eq(pedidosOrdenes.contactId, contacts.id))
      .innerJoin(deals, eq(deals.id, pedidosOrdenes.dealId))
      .innerJoin(pipelineStages, eq(pipelineStages.id, deals.stageId))
      .where(
        and(
          eq(pipelineStages.key, "adelanto_pagado"),
          isNull(pedidosOrdenes.numeroGuia)
        )
      )
      .orderBy(desc(pedidosOrdenes.updatedAt));

    const listos = [];
    const incompletos = [];

    for (const r of rows) {
      const notas = r.notas || "";
      if (notas.toUpperCase().includes("[SHALOM_AUTO_EXCLUIDO]")) continue;
      // Exigir confirmación humana del adelanto de S/ 20
      if (!notas.includes("[ADELANTO VERIFICADO]")) {
        incompletos.push({
          pedidoId: r.pedidoId,
          numeroOrden: r.numeroOrden,
          cliente: r.contactName,
          faltantes: ["confirmación humana de adelanto S/ 20"],
        });
        continue;
      }

      const agenciaLocalizada = (r.direccionEnvio || r.ciudad || "").trim();
      const validacion = validarDatosIndispensablesShalomPro({
        clienteNombre: r.contactName,
        dni: r.dniCliente,
        agenciaShalom: agenciaLocalizada,
      });

      if (!validacion.completo) {
        incompletos.push({
          pedidoId: r.pedidoId,
          numeroOrden: r.numeroOrden,
          cliente: r.contactName,
          faltantes: validacion.faltantes,
        });
        continue;
      }

      const claveSugerida = await generarClaveRetiroShalomUnica(7);
      const rawItems = Array.isArray(r.items) ? (r.items as unknown as Array<Record<string, unknown>>) : [];
      const productos = rawItems.length
        ? rawItems.map((it) => ({
            nombre: String(it.titulo || it.nombre || it.producto || "NAC600"),
            cantidad: Number(it.cantidad || 1),
            precioUnitario: Number(it.precio || it.precioUnitario || 0),
          }))
        : [{ nombre: "NAC600", cantidad: 1, precioUnitario: Number(r.total) || 199 }];

      const nombreArchivo = construirNombreArchivoPreguia({
        clienteNombre: r.contactName,
        numeroOrden: r.numeroOrden,
        clave4Digitos: claveSugerida,
      });

      listos.push({
        pedidoId: r.pedidoId,
        dealId: r.dealId,
        contactId: r.contactId,
        numeroOrden: r.numeroOrden,
        clienteNombre: r.contactName,
        clienteTelefono: (r.contactPhone || "").replace(/\D/g, ""),
        clienteDni: (r.dniCliente || "").replace(/\D/g, ""),
        ciudad: r.ciudad || "",
        distrito: r.distrito || "",
        agenciaShalomDestino: agenciaLocalizada,
        origenShalom: SHALOM_PRO_ORIGEN_FIJO,
        tipoMercancia: "Caja Paquete XS",
        claveRetiroSugerida: claveSugerida,
        nombreArchivoDrive: nombreArchivo,
        driveFolderId: SHALOM_PREGUIAS_DRIVE_FOLDER_ID,
        productos,
        total: Number(r.total) || 0,
      });
    }

    return NextResponse.json({
      ok: true,
      driveFolderId: SHALOM_PREGUIAS_DRIVE_FOLDER_ID,
      origenFijo: SHALOM_PRO_ORIGEN_FIJO,
      listos,
      incompletos,
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Error consultando pendientes Shalom PRO" },
      { status: 500 }
    );
  }
}
