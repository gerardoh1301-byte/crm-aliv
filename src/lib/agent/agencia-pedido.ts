import "server-only";
import { db } from "@/db";
import { activities } from "@/db/schema";
import { and, desc, eq, notInArray } from "drizzle-orm";
import { pedidosOrdenes } from "../../../modules/pedidos/tabla";
import { resolverAgenciaOficial, textoAgenciaOficial, type AgenciaShalom } from "@/lib/agencias/shalom-directorio";
import { esPedidoDeProvincia } from "@/lib/pedidos/adelanto";

/**
 * Cambio de agencia Shalom pedido por el cliente en el chat.
 *
 * Caso real (#LEG-1066, 17/11): el cliente pidió "Av. Centenario Km 6.800", el bot dijo
 * "ya actualicé" pero solo cambió la ficha; el pedido seguía con una agencia que no está en
 * el padrón oficial y la guía salió a otra sede. Ahora:
 *  - solo se acepta una sede del padrón OFICIAL (si no hay certeza, se pregunta con opciones);
 *  - se guarda con el nombre y la dirección oficiales, en la ficha Y en el pedido en curso;
 *  - si la guía ya está emitida, no se toca el pedido: se avisa a Gerardo para que coordine
 *    el cambio de destino con Shalom.
 */

const CAMPOS_AGENCIA = ["direccion_envio", "direccion", "agencia_shalom", "agencia"];

function opcionesTexto(opciones: AgenciaShalom[]): string {
  return opciones
    .slice(0, 5)
    .map((a) => `${a.nombre} — ${a.direccion.trim()}${a.referencia ? ` (ref: ${a.referencia.replace(/^[\s:]+/, "")})` : ""}`)
    .join("; ");
}

export type ResultadoAgenciaChat =
  | { tipo: "no_aplica" }
  | { tipo: "rechazada"; error: string }
  | {
      tipo: "aceptada";
      campo: string;
      valor: string;
      agencia: AgenciaShalom;
      instruccion: string;
    };

function pareceAgencia(valor: string): boolean {
  return /shalom|agencia|sede/i.test(valor);
}

async function pedidoEnCurso(contactId: string) {
  const [p] = await db
    .select()
    .from(pedidosOrdenes)
    .where(and(eq(pedidosOrdenes.contactId, contactId), notInArray(pedidosOrdenes.estado, ["entregado", "cancelado"])))
    .orderBy(desc(pedidosOrdenes.createdAt))
    .limit(1);
  return p ?? null;
}

function esDeShalom(p: { modalidadPago: string | null; transportadora: string | null; direccionEnvio: string | null } | null) {
  if (!p) return false;
  return p.modalidadPago === "adelanto_agencia" || /shalom/i.test(`${p.transportadora || ""} ${p.direccionEnvio || ""}`);
}

/**
 * Pedido web de provincia (EasySell) con dirección de casa y sin courier: va por Shalom, así
 * que la agencia oficial que elige el cliente reemplaza esa dirección (caso #1153, Trujillo).
 * Con AliClik (contra entrega a domicilio) no se toca.
 */
function esProvinciaSinCourier(
  p: { transportadora: string | null; ciudad: string | null; distrito: string | null; direccionEnvio: string | null } | null
) {
  if (!p || /aliclik/i.test(p.transportadora || "")) return false;
  return esPedidoDeProvincia({ ciudad: p.ciudad, distrito: p.distrito, direccionEnvio: p.direccionEnvio });
}

/**
 * Revisa si `campos` trae una agencia Shalom. Devuelve "rechazada" (con las opciones
 * oficiales para preguntarle al cliente), "aceptada" (ya aplicada al pedido en curso si
 * correspondía) o "no_aplica".
 */
export async function aplicarAgenciaDelChat(params: {
  contactId: string;
  campos: Record<string, unknown>;
  camposActuales: Record<string, unknown>;
}): Promise<ResultadoAgenciaChat> {
  const campo = CAMPOS_AGENCIA.find((k) => typeof params.campos[k] === "string" && String(params.campos[k]).trim());
  if (!campo) return { tipo: "no_aplica" };
  const valor = String(params.campos[campo]).trim();

  const pedido = await pedidoEnCurso(params.contactId);
  if (!pareceAgencia(valor) && !esDeShalom(pedido)) {
    if (!esProvinciaSinCourier(pedido)) return { tipo: "no_aplica" };
    // Si nombra una sede oficial ("la de Av Larco 865") se toma como agencia. Si no, y su zona
    // tiene contra entrega de AliClik, es una dirección de casa válida: no es Shalom.
    const sede = resolverAgenciaOficial({ texto: valor, ciudad: pedido!.ciudad });
    if (!sede.agencia) {
      try {
        const { decidirEntrega } = await import("@/lib/aliclik/cobertura-cod");
        const d = await decidirEntrega({ ciudad: pedido!.ciudad, distrito: pedido!.distrito, direccion: valor });
        if (d.zona === "provincia_cod") return { tipo: "no_aplica" };
      } catch {
        return { tipo: "no_aplica" };
      }
    }
  }

  const ciudad =
    (typeof params.campos.departamento_ciudad === "string" && params.campos.departamento_ciudad) ||
    (typeof params.camposActuales.departamento_ciudad === "string" && params.camposActuales.departamento_ciudad) ||
    pedido?.ciudad ||
    null;

  const r = resolverAgenciaOficial({ texto: valor, ciudad });
  if (!r.agencia) {
    const porque =
      r.motivo === "km_distinto"
        ? "el kilómetro no coincide con ninguna sede oficial"
        : r.motivo === "ambigua"
          ? "coincide con más de una sede"
          : "no figura en el padrón oficial de Shalom";
    return {
      tipo: "rechazada",
      error:
        `NO se guardó la agencia «${valor}»: ${porque}. NO le digas al cliente que la registraste ni inventes otra. ` +
        (r.opciones.length
          ? `Pregúntale a cuál de estas sedes oficiales se refiere (dale nombre y dirección exactos): ${opcionesTexto(r.opciones)}. `
          : "Pídele la ciudad y la dirección o referencia de la agencia Shalom y vuelve a buscar con buscar_agencia_shalom. ") +
        "Cuando confirme una, vuelve a llamar a actualizar_contacto con esa sede.",
    };
  }

  const oficial = textoAgenciaOficial(r.agencia);
  let instruccion = `Agencia oficial confirmada: ${oficial}. Repítele al cliente el nombre y la dirección exactos para que confirme.`;

  if (pedido && (esDeShalom(pedido) || esProvinciaSinCourier(pedido))) {
    const mismaAgencia = (pedido.direccionEnvio || "").trim() === oficial;
    if (!pedido.numeroGuia) {
      if (!mismaAgencia) {
        await db
          .update(pedidosOrdenes)
          .set({ direccionEnvio: oficial, updatedAt: new Date() })
          .where(eq(pedidosOrdenes.id, pedido.id));
        await db.insert(activities).values({
          type: "note",
          description: `[AGENCIA] ${pedido.numeroOrden}: agencia cambiada a ${oficial} (antes: ${pedido.direccionEnvio || "-"}), confirmada contra el padrón oficial de Shalom.`,
          contactId: params.contactId,
          dealId: pedido.dealId,
        });
      }
      instruccion += ` El pedido ${pedido.numeroOrden} ya quedó con esta agencia.`;
    } else if (!mismaAgencia) {
      // La guía ya salió: cambiar el pedido no mueve el paquete. Lo coordina una persona.
      const { notificarSupervisoresCritico } = await import("@/lib/alerts/supervisor-alerts");
      await notificarSupervisoresCritico({
        tipo: "cambio_agencia_con_guia",
        titulo: `Cambio de agencia ${pedido.numeroOrden}`,
        detalle:
          `El cliente pide recoger en ${oficial}, pero la guía ${pedido.numeroGuia}${pedido.codigoRastreo ? ` · código ${pedido.codigoRastreo}` : ""} ` +
          `ya salió hacia: ${pedido.direccionEnvio || "otra agencia"}. Coordina el cambio de destino con Shalom.`,
        contactId: params.contactId,
      }).catch((err) => console.warn("[agencia-pedido] aviso a supervisor:", err));
      await db.insert(activities).values({
        type: "note",
        description: `[AGENCIA] ${pedido.numeroOrden}: el cliente pide ${oficial}, pero la guía ${pedido.numeroGuia} ya fue emitida a otra agencia. Avisado a Gerardo.`,
        contactId: params.contactId,
        dealId: pedido.dealId,
      });
      instruccion +=
        ` OJO: la guía de ${pedido.numeroOrden} YA fue emitida a otra agencia. No le digas que ya cambió: ` +
        "dile que un asesor coordina el cambio de destino con Shalom y le confirma por aquí.";
    }
  }

  return { tipo: "aceptada", campo, valor: oficial, agencia: r.agencia, instruccion };
}
