import {
  buscarAgenciaShalomCercana,
  resolverAgenciaOficial,
  textoAgenciaOficial,
} from "@/lib/agencias/shalom-directorio";
import { adelantoRegistrado, esPedidoDeProvincia } from "@/lib/pedidos/adelanto";

/**
 * Datos indispensables para despachar por Shalom: DNI del cliente y una agencia del padrón
 * oficial. Caso #1153 (20/11): el cliente mandó el Yape del adelanto, el bot contestó
 * "un asesor te enviará tu clave de retiro" y se despidió; el pedido seguía con una
 * dirección de casa en Trujillo y sin DNI, así que no se podía emitir la guía.
 * Esto no depende del modelo: si faltan datos y la respuesta no los pide, se agregan.
 */

const ESTADOS_SIN_DESPACHAR = new Set(["por_confirmar_cod", "confirmado", "pendiente", "adelanto"]);

export interface PedidoParaEnvio {
  numeroOrden?: string | null;
  estado?: string | null;
  ciudad?: string | null;
  distrito?: string | null;
  direccionEnvio?: string | null;
  dniCliente?: string | null;
  transportadora?: string | null;
  numeroGuia?: string | null;
  modalidadPago?: string | null;
  notas?: string | null;
}

export interface RequisitosShalom {
  /** Hay una venta a provincia por Shalom en curso (pedido sin guía o intención de compra). */
  aplica: boolean;
  /** Hay pedido registrado sin despachar (no solo intención). */
  conPedido: boolean;
  faltaDni: boolean;
  faltaAgencia: boolean;
  ciudad: string | null;
  /** Hasta 3 sedes oficiales cercanas, en texto canónico, para proponer. */
  opciones: string[];
  numeroOrden: string | null;
}

export const SIN_REQUISITOS: RequisitosShalom = {
  aplica: false,
  conPedido: false,
  faltaDni: false,
  faltaAgencia: false,
  ciudad: null,
  opciones: [],
  numeroOrden: null,
};

export function dniValido(valor: unknown): string | null {
  const solo = String(valor ?? "").replace(/\D/g, "");
  return solo.length === 8 ? solo : null;
}

/** Una agencia vale solo si ya quedó guardada como sede oficial ("Agencia Shalom ..."). */
export function agenciaConfirmada(texto: string | null | undefined, ciudad: string | null | undefined): boolean {
  const t = String(texto ?? "").trim();
  if (!/^agencia\s+shalom\b/i.test(t)) return false;
  return resolverAgenciaOficial({ texto: t, ciudad }).motivo === "exacta";
}

export function evaluarRequisitosShalom(params: {
  pedido: PedidoParaEnvio | null | undefined;
  campos: Record<string, unknown>;
  notasContacto?: string | null;
  /** La cobertura de AliClik dice contra entrega a domicilio en su ciudad. */
  zonaContraEntrega: boolean;
  /** En el chat ya se habló de agencia Shalom o de adelanto (la venta va por Shalom). */
  chatVaPorShalom: boolean;
  /** Sin pedido: el contacto está en intención de compra / pendiente de adelanto en provincia. */
  intencionProvincia: boolean;
}): RequisitosShalom {
  const { pedido, campos } = params;
  const activo =
    pedido &&
    !pedido.numeroGuia &&
    ESTADOS_SIN_DESPACHAR.has(String(pedido.estado ?? "").toLowerCase()) &&
    !/aliclik/i.test(String(pedido.transportadora ?? ""));

  let conPedido = false;
  let ciudad: string | null = null;
  let direccion: string | null = null;

  if (activo) {
    const provincia = esPedidoDeProvincia({
      ciudad: pedido.ciudad ?? null,
      distrito: pedido.distrito ?? null,
      direccionEnvio: pedido.direccionEnvio ?? null,
    });
    const porShalom =
      pedido.modalidadPago === "adelanto_agencia" ||
      /shalom/i.test(String(pedido.transportadora ?? "")) ||
      /^agencia\s+shalom/i.test(String(pedido.direccionEnvio ?? "")) ||
      adelantoRegistrado(pedido.notas) ||
      params.chatVaPorShalom ||
      !params.zonaContraEntrega;
    if (provincia && porShalom) {
      conPedido = true;
      ciudad = pedido.ciudad || pedido.distrito || null;
      direccion = pedido.direccionEnvio ?? null;
    }
  }

  if (!conPedido && !(params.intencionProvincia && !params.zonaContraEntrega)) return SIN_REQUISITOS;

  const campoCiudad = campos.departamento_ciudad || campos.ciudad;
  ciudad = ciudad || (campoCiudad ? String(campoCiudad) : null);
  const direccionCampo = campos.agencia_shalom || campos.direccion_envio;
  direccion = direccion || (direccionCampo ? String(direccionCampo) : null);

  const dni =
    dniValido(pedido?.dniCliente) ||
    dniValido(campos.dni_ruc) ||
    dniValido(campos.dni) ||
    dniValido(campos.documento) ||
    dniValido(/dni[:\s]*(\d{8})/i.exec(params.notasContacto ?? "")?.[1]);

  const faltaAgencia = !(
    agenciaConfirmada(direccion, ciudad) ||
    agenciaConfirmada(String(campos.agencia_shalom ?? ""), ciudad) ||
    agenciaConfirmada(String(campos.direccion_envio ?? ""), ciudad)
  );

  let opciones: string[] = [];
  if (faltaAgencia && (ciudad || direccion)) {
    // Las cercanas salen del buscador (ordena por cercanía), pero se proponen con su sede del
    // padrón OFICIAL: es la que acepta actualizar_contacto y la que sale en la guía.
    const r = buscarAgenciaShalomCercana({ ciudad, direccion });
    const cercanas = [r.mejorOpcion, ...(r.otrasOpciones ?? []), ...(r.todasDeCiudad ?? [])].filter(
      (a): a is NonNullable<typeof a> => Boolean(a)
    );
    const oficiales = cercanas
      .map((ag) => resolverAgenciaOficial({ texto: textoAgenciaOficial(ag), ciudad }))
      .filter((res) => res.motivo === "exacta" && res.agencia)
      .map((res) => res.agencia!);
    const respaldo = resolverAgenciaOficial({ texto: direccion, ciudad }).opciones;
    const vistos = new Set<string>();
    for (const ag of [...oficiales, ...respaldo]) {
      if (vistos.has(ag.id)) continue;
      vistos.add(ag.id);
      opciones.push(textoAgenciaOficial(ag).replace(/^Agencia\s+/i, ""));
      if (opciones.length >= 3) break;
    }
  }

  return {
    aplica: true,
    conPedido,
    faltaDni: !dni,
    faltaAgencia,
    ciudad,
    opciones,
    numeroOrden: conPedido ? pedido?.numeroOrden ?? null : null,
  };
}

const PIDE_DNI = /\bdni\b/i;
const PIDE_AGENCIA_FRASE = /\b(agencias?|sedes?)\b/i;
const VERBO_PEDIDO = /\?|conf[ií]rm|eleg|elig|prefier|ind[ií]ca|dime|cu[aá]l|escoge|te\s+queda/i;
/** Alguna oración habla de la agencia/sede y la pide (pregunta, "confírmame", "prefieres"...). */
function pideAgencia(texto: string): boolean {
  return texto
    .split(/(?<=[.!?\n])/)
    .some((o) => PIDE_AGENCIA_FRASE.test(o) && VERBO_PEDIDO.test(o));
}
/**
 * El modelo ya mostró las sedes y preguntó (25/11, #1181: «¿Cuál de estas es la que te queda
 * mejor?» sin repetir la palabra agencia): no se vuelve a pegar la misma lista debajo.
 */
function listaAgencias(texto: string, opciones: string[]): boolean {
  if (!texto.includes("?") || !/(agencias?|sedes?|shalom)/i.test(texto)) return false;
  const t = texto.toLowerCase();
  return opciones.some((o) => t.includes(o.split("(")[0].trim().toLowerCase()));
}

/** Promesas de clave o despacho que no se pueden cumplir sin guía emitida. */
const PROMESA_SIN_GUIA =
  /[^.!?\n]*(?:te\s+enviar[áa]n?[^.!?\n]*clave|clave\s+de\s+(?:retiro|recojo)|ya\s+(?:est[áa]\s+)?(?:listo|despachado)\s+(?:para\s+)?(?:el\s+)?despacho|avis[ée]\s+(?:al\s+equipo\s+)?para\s+despachar)[^.!?\n]*[.!?]?\s*/gi;

export function textoPedirDatos(req: RequisitosShalom): string {
  const enCiudad = req.ciudad ? ` En ${req.ciudad.replace(/\s+/g, " ").trim()}` : "";
  const sedes = req.opciones.length
    ? `${enCiudad} estas agencias oficiales te quedan cerca:\n${req.opciones.map((o) => `• ${o}`).join("\n")}\n`
    : "";
  if (req.faltaDni && req.faltaAgencia) {
    return (
      "Para emitir tu guía en Shalom y despachar tu pedido me faltan 2 datos:\n" +
      "1️⃣ Tu número de DNI (8 dígitos) 🪪\n" +
      "2️⃣ La agencia Shalom donde lo recogerás." +
      (sedes ? `\n${sedes.trim()}` : "") +
      "\n¿Me compartes tu DNI y la agencia que prefieres?"
    );
  }
  if (req.faltaDni) {
    return "Para emitir tu guía oficial en Shalom, compárteme por favor tu número de DNI (8 dígitos) 🪪";
  }
  return (
    "Para emitir tu guía, confírmame en qué agencia Shalom lo recogerás." +
    (sedes ? `\n${sedes.trim()}` : "") +
    "\n¿Cuál te queda mejor?"
  );
}

/**
 * Si la venta a provincia va por Shalom y faltan DNI o agencia oficial, la respuesta tiene
 * que pedirlos. Quita además las promesas de clave/despacho que no aplican sin guía.
 */
export function exigirDatosEnvio(
  reply: string,
  req: RequisitosShalom
): { texto: string; agregado: boolean; promesaQuitada: boolean } {
  if (!req.aplica || (!req.faltaDni && !req.faltaAgencia)) {
    return { texto: reply, agregado: false, promesaQuitada: false };
  }
  let texto = reply;
  let promesaQuitada = false;
  if (req.conPedido) {
    const sinPromesa = texto.replace(PROMESA_SIN_GUIA, " ").replace(/[ \t]{2,}/g, " ").trim();
    if (sinPromesa !== texto.trim()) {
      promesaQuitada = true;
      texto = sinPromesa || "¡Gracias! 🙌 Ya registramos tu mensaje.";
    }
  }
  const yaPideDni = !req.faltaDni || PIDE_DNI.test(texto);
  const yaPideAgencia = !req.faltaAgencia || pideAgencia(texto) || listaAgencias(texto, req.opciones);
  if (yaPideDni && yaPideAgencia) return { texto, agregado: false, promesaQuitada };

  // Lo que falta se pide completo (aunque el modelo haya pedido una parte).
  const pedido = textoPedirDatos({
    ...req,
    faltaDni: req.faltaDni && !PIDE_DNI.test(texto),
    faltaAgencia: req.faltaAgencia && !pideAgencia(texto) && !listaAgencias(texto, req.opciones),
  });
  // Una despedida al final ya no tiene sentido si seguimos pidiendo datos.
  texto = texto
    .replace(/\s*(?:quedo\s+(?:a\s+tu\s+disposici[oó]n|atent[oa])|que\s+tengas\s+un\s+(?:excelente|buen)\s+d[ií]a)[^\n]*$/i, "")
    .trim();
  return { texto: texto ? `${texto}\n\n${pedido}` : pedido, agregado: true, promesaQuitada };
}
