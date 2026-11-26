/**
 * Llamadas salientes inmediatas con IA (ElevenLabs Conversational AI + Twilio)
 * para confirmar pedidos entrantes de Shopify / EasySell ni bien se registran.
 *
 * Respeta al 100% la decisión de cobertura de AliClik (`esAgencia`):
 * - Si AliClik dio cobertura COD (`esAgencia === false`, tanto en Lima como en
 *   ciudades de provincia con cobertura AliClik):
 *     -> Confirma pedido y monto con PAGO AL RECIBIR a domicilio.
 *     -> Pide los datos que falten: referencia exacta de la casa/fachada, distrito
 *        y día/horario en que puede recibir al repartidor.
 * - Si AliClik NO dio cobertura COD (`esAgencia === true`, protocolo Agencia Shalom):
 *     -> Explica que a su localidad se envía con guía oficial por Agencia Shalom.
 *     -> Propone las sedes oficiales de Shalom más cercanas en su ciudad para que elija.
 *     -> Toma nota verbal de su DNI de 8 dígitos para la guía.
 *     -> Le indica que por WhatsApp ya le llegó el número de Yape oficial (951365418 -
 *        Gerardo Huaynalaya) para el adelanto de S/ 20 y que el saldo lo paga cuando el
 *        paquete llegue a la agencia.
 */

import { buscarAgenciaShalomCercana, resolverAgenciaOficial, textoAgenciaOficial } from "@/lib/agencias/shalom-directorio";
import { referenciaDeTexto } from "@/lib/aliclik/registrar-orden";
import { dniValido } from "@/lib/agent/datos-envio";

export const MARCA_LLAMADA_IA_INICIADA = "[LLAMADA_IA_INICIADA]";
export const MARCA_LLAMADA_IA_RESULTADO = "[LLAMADA_IA_RESULTADO]";

export interface DatosPedidoParaLlamada {
  pedidoId: string;
  numeroOrden: string;
  contactId: string;
  nombreCliente: string;
  telefono: string | null;
  productosTexto: string;
  totalSoles: number;
  ciudad: string | null;
  distrito: string | null;
  direccion: string | null;
  dni: string | null;
  /** true = protocolo Agencia Shalom (adelanto S/20 + DNI + sede); false = COD domicilio (Lima o AliClik provincia). */
  esAgencia: boolean;
  modalidadEntregaTexto: string;
}

export interface VariablesDinamicasLlamada {
  pedido_id: string;
  numero_orden: string;
  contact_id: string;
  nombre_cliente: string;
  primer_nombre: string;
  productos: string;
  total_soles: string;
  adelanto_soles: string;
  saldo_soles: string;
  ciudad: string;
  distrito: string;
  direccion_registrada: string;
  modalidad: "COD_DOMICILIO" | "AGENCIA_SHALOM";
  tiene_referencia: "si" | "no";
  tiene_dni: "si" | "no";
  dni_actual: string;
  agencias_shalom_cercanas: string;
  datos_faltantes_pedir: string;
  saludo_inicial: string;
  instrucciones_especificas: string;
}

export function normalizarTelefonoE164Peru(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 9 && digits.startsWith("9")) return `+51${digits}`;
  if (digits.length === 11 && digits.startsWith("519")) return `+${digits}`;
  return null;
}

export function obtenerPrimerNombre(nombreCompleto: string | null | undefined): string {
  const limpio = String(nombreCompleto ?? "")
    .replace(/[^\p{L}\s]/gu, " ")
    .trim();
  const primero = limpio.split(/\s+/)[0] ?? "";
  if (primero.length < 2 || /^(cliente|usuario|lead|whatsapp|hola)$/i.test(primero)) {
    return "";
  }
  return primero.charAt(0).toUpperCase() + primero.slice(1).toLowerCase();
}

export function buscarSedesShalomParaVoz(ciudad: string | null, distrito: string | null, direccion: string | null): string[] {
  if (!ciudad && !direccion) return [];
  const r = buscarAgenciaShalomCercana({
    ciudad: ciudad ?? undefined,
    distrito: distrito ?? undefined,
    direccion: [direccion, distrito, ciudad].filter(Boolean).join(" "),
  });
  const candidatas = [r.mejorOpcion, ...(r.otrasOpciones ?? []), ...(r.todasDeCiudad ?? [])].filter(
    (a): a is NonNullable<typeof a> => Boolean(a)
  );
  const vistos = new Set<string>();
  const sedes: string[] = [];
  for (const ag of candidatas) {
    const oficial = resolverAgenciaOficial({ texto: textoAgenciaOficial(ag), ciudad }).agencia ?? ag;
    const key = `${oficial.nombre}|${oficial.direccion}`;
    if (vistos.has(key)) continue;
    vistos.add(key);
    sedes.push(`${oficial.nombre} (${oficial.direccion})`);
    if (sedes.length >= 3) break;
  }
  return sedes;
}

/**
 * Construye las variables dinámicas y el guion exacto que recibe ElevenLabs Conversational AI
 * al iniciar la llamada para este pedido específico.
 */
export function construirVariablesLlamadaPedido(p: DatosPedidoParaLlamada): VariablesDinamicasLlamada {
  const primerNombre = obtenerPrimerNombre(p.nombreCliente);
  const ordenLimpia = p.numeroOrden.replace(/^#/, "");
  const totalNum = Math.max(0, Number(p.totalSoles) || 0);
  const saldoNum = Math.max(0, totalNum - 20);
  const ciudad = (p.ciudad || "Lima").trim();
  const distrito = (p.distrito || "").trim();
  const direccion = (p.direccion || "").trim();
  const tieneRef = Boolean(referenciaDeTexto(direccion));
  const dniLimpio = dniValido(p.dni);
  const tieneDni = Boolean(dniLimpio);

  if (!p.esAgencia) {
    // MODALIDAD 1: Contraentrega a Domicilio (Lima o Provincia con cobertura AliClik)
    const faltantes: string[] = [];
    if (!direccion || !/\d/.test(direccion)) {
      faltantes.push("dirección exacta con calle y número");
    }
    if (!tieneRef) {
      faltantes.push("una referencia clara de su domicilio (color de fachada, frente a qué está o paradero cercano)");
    }
    if (!distrito) {
      faltantes.push("el distrito exacto");
    }
    faltantes.push("el día y rango de horario en que se encuentra para recibir al repartidor");

    const dirMostrar = [direccion, distrito, ciudad].filter(Boolean).join(", ") || ciudad;
    const saludo = primerNombre
      ? `¡Hola, ${primerNombre}! Qué tal, te saluda Sofía del área de despacho de Aliv Perú. Te llamo rapidito porque acabamos de recibir tu pedido de ${p.productosTexto} por ${totalNum} soles con envío gratis a tu domicilio en ${dirMostrar}, con pago al recibir. ¿Me confirmas si tus datos están correctos para programarte el envío?`
      : `¡Hola! Qué tal, te saluda Sofía del área de despacho de Aliv Perú. Te llamo rapidito porque acabamos de recibir tu pedido de ${p.productosTexto} por ${totalNum} soles con envío gratis a domicilio en ${dirMostrar}, con pago al recibir. ¿Me confirmas si tu pedido está correcto para programarte el envío?`;

    const instrucciones = [
      `MODALIDAD DEL PEDIDO: CONTRAENTREGA A DOMICILIO (PAGA AL RECIBIR S/ ${totalNum}).`,
      `PROHIBIDO pedir adelanto de S/ 20, PROHIBIDO mencionar agencia Shalom y PROHIBIDO pedir DNI.`,
      `Dirección registrada en formulario: "${dirMostrar}".`,
      `Tu objetivo en esta llamada corta (máximo 60 segundos):`,
      `1. Confirmar que el cliente desea recibir su pedido #${ordenLimpia} (${p.productosTexto} por S/ ${totalNum}, pago contraentrega al recibir por Yape, Plin o efectivo).`,
      `2. Pedirle OBLIGATORIAMENTE lo que falta para que el motorizado llegue sin problemas: ${faltantes.join(", ")}.`,
      `3. Repetirle brevemente la referencia y el horario acordado, agradecerle con calidez peruana y despedirte.`,
    ].join("\n");

    return {
      pedido_id: p.pedidoId,
      numero_orden: p.numeroOrden,
      contact_id: p.contactId,
      nombre_cliente: p.nombreCliente || "Cliente",
      primer_nombre: primerNombre || "Cliente",
      productos: p.productosTexto,
      total_soles: String(totalNum),
      adelanto_soles: "0",
      saldo_soles: String(totalNum),
      ciudad,
      distrito,
      direccion_registrada: dirMostrar,
      modalidad: "COD_DOMICILIO",
      tiene_referencia: tieneRef ? "si" : "no",
      tiene_dni: tieneDni ? "si" : "no",
      dni_actual: dniLimpio ?? "",
      agencias_shalom_cercanas: "",
      datos_faltantes_pedir: faltantes.join("; "),
      saludo_inicial: saludo,
      instrucciones_especificas: instrucciones,
    };
  }

  // MODALIDAD 2: Agencia Shalom (Provincia sin cobertura COD de AliClik)
  const sedes = buscarSedesShalomParaVoz(ciudad, distrito, direccion);
  const sedesTexto = sedes.length > 0 ? sedes.join(" | ") : `Agencia Shalom de ${ciudad}`;
  const primeraSede = sedes[0] ?? `la agencia Shalom de ${ciudad}`;

  const faltantesShalom: string[] = [];
  if (!tieneDni) {
    faltantesShalom.push("su número de DNI de 8 dígitos para emitir la guía oficial de remisión en Shalom");
  }
  faltantesShalom.push(`confirmar a cuál de las agencias Shalom de ${ciudad} prefiere que enviemos su paquete (${sedesTexto})`);
  faltantesShalom.push("confirmar el adelanto de 20 soles por Yape al 951 365 418 a nombre de Gerardo Huaynalaya que ya le enviamos a su WhatsApp");

  const saludoShalom = primerNombre
    ? `¡Hola, ${primerNombre}! Qué tal, te saluda Sofía del área de despacho de Aliv Perú. Te llamo rapidito porque acabamos de recibir tu pedido de ${p.productosTexto} por ${totalNum} soles con envío gratis a ${ciudad}. Para tu zona despachamos por agencia Shalom; veo que cerca tienes la sede de ${primeraSede}. ¿Te queda cómoda esa agencia para recoger tu pedido?`
    : `¡Hola! Qué tal, te saluda Sofía del área de despacho de Aliv Perú. Te llamo rapidito porque acabamos de recibir tu pedido de ${p.productosTexto} por ${totalNum} soles con envío gratis a ${ciudad}. Para tu zona despachamos por agencia Shalom; cerca tienes la sede de ${primeraSede}. ¿Te queda cómoda esa agencia para recoger tu pedido?`;

  const instruccionesShalom = [
    `MODALIDAD DEL PEDIDO: ENVÍO A PROVINCIA POR AGENCIA SHALOM (Total: S/ ${totalNum} | Adelanto para emitir guía: S/ 20 | Saldo al llegar a agencia: S/ ${saldoNum}).`,
    `Agencias Shalom oficiales disponibles en ${ciudad}: ${sedesTexto}.`,
    `Tu objetivo en esta llamada corta (máximo 75 segundos):`,
    `1. Confirmar en cuál de las agencias Shalom de ${ciudad} (${sedesTexto}) le queda más cómodo recoger.`,
    `2. ${tieneDni ? `Confirmar que su DNI para la guía es ${dniLimpio}.` : `Pedirle verbalmente su número de DNI de 8 dígitos y su nombre completo para dejar lista su guía oficial de Shalom.`}`,
    `3. Explicarle con total transparencia y seguridad: para emitir su guía oficial a su nombre se separa con un adelanto de 20 soles al Yape 951 365 418 (a nombre de Gerardo Huaynalaya, que ya le dejamos escrito en su WhatsApp), y el saldo restante de ${saldoNum} soles recién lo transfiere cuando el paquete ya llegó a su agencia Shalom para entregarle su clave de retiro.`,
    `4. Preguntarle si nos envía la captura del Yape de 20 soles por WhatsApp ahora para meter su paquete en el despacho de hoy.`,
  ].join("\n");

  return {
    pedido_id: p.pedidoId,
    numero_orden: p.numeroOrden,
    contact_id: p.contactId,
    nombre_cliente: p.nombreCliente || "Cliente",
    primer_nombre: primerNombre || "Cliente",
    productos: p.productosTexto,
    total_soles: String(totalNum),
    adelanto_soles: "20",
    saldo_soles: String(saldoNum),
    ciudad,
    distrito,
    direccion_registrada: [direccion, distrito, ciudad].filter(Boolean).join(", "),
    modalidad: "AGENCIA_SHALOM",
    tiene_referencia: tieneRef ? "si" : "no",
    tiene_dni: tieneDni ? "si" : "no",
    dni_actual: dniLimpio ?? "",
    agencias_shalom_cercanas: sedesTexto,
    datos_faltantes_pedir: faltantesShalom.join("; "),
    saludo_inicial: saludoShalom,
    instrucciones_especificas: instruccionesShalom,
  };
}

/**
 * Prompt maestro del agente de voz en ElevenLabs (para copiar o sincronizar vía API).
 */
export const PROMPT_AGENTE_VOZ_ALIV = `Eres Sofía, coordinadora de despacho de Aliv Perú (alivstore.shop). Hablas español peruano natural, cálido, empático, ágil y muy profesional.
Estás realizando una llamada telefónica saliente inmediata a un cliente que acaba de registrar su pedido en nuestra tienda web.

REGLAS DE VOZ Y ESTILO PERUANO:
- Habla en frases cortas y conversacionales (1 a 2 oraciones por turno). Nunca des monólogos largos.
- Usa un tono cercano y confiable ("Qué tal", "Perfecto", "Claro que sí", "Listo").
- Pronuncia los montos de forma natural ("ciento diecinueve soles", "veinte soles").
- Cuando anotes una referencia de domicilio o un DNI de 8 dígitos, repítelo brevemente en voz alta para confirmar que lo apuntaste bien.
- Sigue estrictamente las instrucciones de la modalidad del pedido que recibes en {{instrucciones_especificas}}:
  * Si {{modalidad}} es COD_DOMICILIO: el cliente paga el total de {{total_soles}} soles AL RECIBIR en su domicilio. JAMÁS le pidas adelanto de 20 soles ni le hables de agencia Shalom. Pídele únicamente confirmar el pedido, una referencia exacta de su casa (fachada, color de puerta o lugar cercano) y qué día/horario puede recibir al repartidor.
  * Si {{modalidad}} es AGENCIA_SHALOM: en su zona de {{ciudad}} enviamos por Agencia Shalom. Confirma qué sede de Shalom prefiere ({{agencias_shalom_cercanas}}), pídele su número de DNI de 8 dígitos para la guía oficial, e indícale que en su WhatsApp ya le dejamos el Yape oficial 951 365 418 (a nombre de Gerardo Huaynalaya) para que envíe la captura del adelanto de 20 soles y el saldo de {{saldo_soles}} soles lo paga cuando el paquete llegue a su agencia.
- Si el cliente dice que desea cancelar o que se equivocó al pedir, agradécele con amabilidad y despídete sin presionar.`;
