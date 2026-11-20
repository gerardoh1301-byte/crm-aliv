import "server-only";

export interface InfoGuiaShalom {
  oseId: number;
  numeroOrden: string;
  codigoOrden: string;
  fechaTraslado?: string;
  fechaEmision?: string;
  entregado: boolean;
  direccionEntrega?: string;
  tiempoLlegada?: string;
  origen?: {
    nombre: string;
    departamento: string;
    distrito: string;
  };
  destino?: {
    nombre: string;
    departamento: string;
    distrito: string;
    provincia?: string;
  };
  destinatario?: {
    documento: string;
    nombre: string;
  };
}

export interface DetalleEstadosShalom {
  registrado?: { fecha: string };
  origen?: { fecha: string };
  transito?: { fecha: string; completo?: boolean };
  destino?: { fecha: string; completo?: boolean };
  entregado?: { fecha: string; completo?: boolean; cliente?: { nombre: string; documento: string } } | null;
}

export interface ResultadoRastreoShalom {
  ok: boolean;
  mensaje?: string;
  estadoGeneral: "en_destino" | "en_transito" | "entregado" | "no_encontrado" | "error";
  enDestinoListoParaRecojo: boolean;
  yaEntregado: boolean;
  /**
   * La guía se cerró por un CAMBIO DE DESTINO (Shalom la marca "entregada" a un cliente
   * llamado "CAMBIO DE DESTINO" y emite una guía nueva). NO es una entrega real.
   */
  cambioDeDestino?: boolean;
  /**
   * true cuando la agencia de origen ya recibió el paquete (el almacén lo dejó y Shalom lo
   * confirmó). Mientras es solo preguía, Shalom devuelve `origen: null` y Págalo responde
   * "Su envío aún no ha sido confirmado".
   */
  confirmadoEnOrigen?: boolean;
  fechaConfirmacion?: string;
  tipoPago?: string;
  estadoPago?: string;
  montoFlete?: string;
  agenciaOrigen?: string;
  agenciaDestino?: string;
  ciudadDestino?: string;
  fechaLlegadaDestino?: string;
  guia?: InfoGuiaShalom;
  rawEstados?: DetalleEstadosShalom;
}

/**
 * Consulta en tiempo real los servidores de Shalom Oficial para conocer
 * la ubicación exacta y estado de entrega de un paquete.
 */
export async function consultarEstadoShalom(
  numeroGuia: string,
  codigoRastreo: string
): Promise<ResultadoRastreoShalom> {
  const guiaLimpia = (numeroGuia || "").trim();
  const codigoLimpio = (codigoRastreo || "").trim().toUpperCase();

  if (!guiaLimpia || !codigoLimpio) {
    return {
      ok: false,
      mensaje: "Número de guía o código de rastreo no proporcionado.",
      estadoGeneral: "error",
      enDestinoListoParaRecojo: false,
      yaEntregado: false,
    };
  }

  try {
    const resBuscar = await fetch("https://newwebservices.shalomcontrol.com/api/v1/web/rastrea/buscar", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AlivPeru/CRM",
      },
      body: JSON.stringify({ numero: guiaLimpia, codigo: codigoLimpio }),
      cache: "no-store",
    });

    if (!resBuscar.ok) {
      return {
        ok: false,
        mensaje: `Error HTTP ${resBuscar.status} en Shalom`,
        estadoGeneral: "error",
        enDestinoListoParaRecojo: false,
        yaEntregado: false,
      };
    }

    const dataBuscar = await resBuscar.json();
    if (!dataBuscar.success || !dataBuscar.data?.ose_id) {
      return {
        ok: false,
        mensaje: dataBuscar.message || "Guía no encontrada en Shalom.",
        estadoGeneral: "no_encontrado",
        enDestinoListoParaRecojo: false,
        yaEntregado: false,
      };
    }

    const rawGuia = dataBuscar.data;
    const oseId = rawGuia.ose_id;

    // Consultar el detalle de estados (tránsito, llegada a destino, entrega)
    const resEstados = await fetch("https://newwebservices.shalomcontrol.com/api/v1/web/rastrea/estados", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AlivPeru/CRM",
      },
      body: JSON.stringify({ ose_id: oseId }),
      cache: "no-store",
    });

    const dataEstados = await resEstados.json();
    const rawEst: DetalleEstadosShalom = dataEstados.data || {};

    const destinoLlego = Boolean(rawEst.destino?.completo);
    const cambioDeDestino = esCambioDeDestino(rawEst);
    const entregado = !cambioDeDestino && Boolean(rawGuia.entregado || rawEst.entregado);
    const enDestinoListo = destinoLlego && !entregado;

    let estadoGeneral: ResultadoRastreoShalom["estadoGeneral"] = "en_transito";
    if (entregado) {
      estadoGeneral = "entregado";
    } else if (enDestinoListo) {
      estadoGeneral = "en_destino";
    }

    const agenciaDestino = rawGuia.destino?.nombre || "";
    const ciudadDestino = [rawGuia.destino?.distrito, rawGuia.destino?.departamento].filter(Boolean).join(", ");
    const fechaLlegada = rawEst.destino?.fecha || undefined;

    return {
      ok: true,
      estadoGeneral,
      enDestinoListoParaRecojo: enDestinoListo,
      yaEntregado: entregado,
      cambioDeDestino,
      confirmadoEnOrigen: Boolean(rawEst.origen || rawEst.transito || rawEst.destino || entregado),
      fechaConfirmacion: rawEst.origen?.fecha,
      tipoPago: rawGuia.tipo_pago,
      estadoPago: rawGuia.estado_pago,
      montoFlete: rawGuia.monto,
      agenciaOrigen: rawGuia.origen?.nombre,
      agenciaDestino,
      ciudadDestino,
      fechaLlegadaDestino: fechaLlegada,
      guia: {
        oseId,
        numeroOrden: rawGuia.numero_orden,
        codigoOrden: rawGuia.codigo_orden,
        fechaTraslado: rawGuia.fecha_traslado,
        fechaEmision: rawGuia.fecha_emision,
        entregado,
        direccionEntrega: rawGuia.direccion_entrega,
        tiempoLlegada: rawGuia.tiempo_llegada,
        origen: rawGuia.origen
          ? {
              nombre: rawGuia.origen.nombre,
              departamento: rawGuia.origen.departamento,
              distrito: rawGuia.origen.distrito,
            }
          : undefined,
        destino: rawGuia.destino
          ? {
              nombre: rawGuia.destino.nombre,
              departamento: rawGuia.destino.departamento,
              distrito: rawGuia.destino.distrito,
              provincia: rawGuia.destino.provincia,
            }
          : undefined,
        destinatario: rawGuia.destinatario
          ? {
              documento: rawGuia.destinatario.documento,
              nombre: rawGuia.destinatario.nombre,
            }
          : undefined,
      },
      rawEstados: rawEst,
    };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error("[shalom-rastreo] Error al consultar Shalom:", errorMsg);
    return {
      ok: false,
      mensaje: errorMsg,
      estadoGeneral: "error",
      enDestinoListoParaRecojo: false,
      yaEntregado: false,
    };
  }
}


export const MARCA_ENVIO_CONFIRMADO = "[ENVIO_CONFIRMADO_AVISADO";

/**
 * Aviso a Gerardo de que el almacén ya dejó el paquete en la agencia de origen y el envío
 * se puede pagar en Págalo. Una sola vez por pedido y solo mientras el paquete no ha
 * llegado a destino (después ya no sirve).
 */
export function debeAvisarEnvioConfirmado(
  rastro: Pick<ResultadoRastreoShalom, "ok" | "confirmadoEnOrigen" | "enDestinoListoParaRecojo" | "yaEntregado">,
  notasPedido: string | null | undefined
): boolean {
  if (!rastro.ok || !rastro.confirmadoEnOrigen) return false;
  if (rastro.enDestinoListoParaRecojo || rastro.yaEntregado) return false;
  return !(notasPedido || "").includes(MARCA_ENVIO_CONFIRMADO);
}

/**
 * Instruccion de rastreo para el bot. Shalom pide N° de orden + codigo
 * alfanumerico (no la clave de recojo de 4 digitos, que es secreta).
 */
export function textoRastreoShalom(numeroGuia: string | null, codigoRastreo: string | null): string {
  if (!numeroGuia) return "Aun no tiene N° de orden: el pedido sigue en preparacion.";
  if (!codigoRastreo) {
    return `N° de orden ${numeroGuia}, pero falta el codigo de seguimiento: no lo inventes; di que un asesor se lo envia y deriva.`;
  }
  return `Dale AMBOS datos: N° de orden ${numeroGuia} y codigo ${codigoRastreo}, para rastrear en https://shalom.com.pe/rastrea/ o la app de Shalom. La clave de recojo de 4 digitos NO se entrega aqui.`;
}

/**
 * Shalom cierra la guía original como "entregada" al redirigir el paquete a otra agencia:
 * el receptor figura como "CAMBIO DE DESTINO" (DNI ficticio) y la entrega no queda
 * completa. Visto el 20/11 con la guía 104169133 (#LEG-1066).
 */
export function esCambioDeDestino(estados: DetalleEstadosShalom | null | undefined): boolean {
  const nombre = estados?.entregado?.cliente?.nombre || "";
  return /cambio\s+de\s+destino/i.test(nombre);
}
