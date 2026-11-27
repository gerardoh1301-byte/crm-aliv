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
export const MARCA_LLAMADA_IA_PENDIENTE_HORARIO = "[LLAMADA_IA_PENDIENTE_HORARIO]";

/** Horario comercial permitido para llamadas automáticas de IA en hora de Lima (07:00 a 21:59). */
export const HORARIO_LLAMADA_IA = { inicioHora: 7, finHora: 22 };

/**
 * Devuelve true si la hora actual en Perú (America/Lima) está dentro del horario comercial
 * de 7:00 a. m. a 10:00 p. m. (07:00 <= hora < 22:00).
 */
export function dentroHorarioLlamadaIA(ahora: Date = new Date()): boolean {
  const horaStr = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Lima",
    hour: "2-digit",
    hour12: false,
  }).format(ahora);
  const hora = Number(horaStr) % 24;
  return hora >= HORARIO_LLAMADA_IA.inicioHora && hora < HORARIO_LLAMADA_IA.finHora;
}

export function formatearProductoParaVoz(rawProds: string | null | undefined): string {
  const s = String(rawProds ?? "").trim();
  if (!s) return "tu pedido de Aliv Perú";

  const partes = s.split(/\s*,\s*/).map((item) => {
    const m = item.match(/^(\d+)\s*x?\s+(.+)$/i);
    const cant = m ? Number(m[1]) || 1 : 1;
    const nombre = m ? m[2] : item;
    if (/nac\s?600|nad/i.test(nombre)) {
      return cant === 1 ? "un frasco de NAC seiscientos" : `${cant} frascos de NAC seiscientos`;
    }
    if (/termix|tobill/i.test(nombre)) {
      return cant === 1 ? "una tobillera Termix" : `${cant} tobilleras Termix`;
    }
    const limpio = normalizarTextoParaVoz(nombre.replace(/\([^)]*\)/g, ""));
    return cant > 1 ? `${cant} unidades de ${limpio}` : limpio;
  });

  return partes.join(" y ");
}

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
  /** El cliente ya confirmó (regla de confirmación real): la llamada solo completa datos. */
  yaConfirmado?: boolean;
  /** Notas del pedido: si ya tiene «Horario:» no se vuelve a pedir. */
  notas?: string | null;
  /** Datos pendientes propios de este pedido, además de los que se detectan solos. */
  pendientesExtra?: string[];
  /** Contexto breve del chat para Sofía (lo que el cliente dijo o prometió). */
  contexto?: string;
}

/**
 * true si la dirección trae número de casa: «Av. Tomás Valle 917», «Mz D Lt 18», «Nro 121».
 * «Calle 11 San…» no cuenta: el 11 es el nombre de la calle, no el número de la casa.
 */
export function tieneNumeroDeCasa(direccion: string | null | undefined): boolean {
  const d = String(direccion ?? "");
  if (/(?:^|[^\p{L}])(n[°ºo]\.?|nro\.?|num\.?|#)\s*\d+/iu.test(d)) return true;
  if (/(?:^|[^\p{L}])(mz|mza|manzana)(?!\p{L})[\s\S]*?(?:^|[^\p{L}])(lt|lote)(?!\p{L})/iu.test(d)) return true;
  return /(?:^|[^\p{L}])(av|avenida|jr|jir[oó]n|calle|ca|cl|psje?|pasaje|prolongaci[oó]n|prol|carretera|urb)\.?\s+\p{L}[\p{L}.\s]*?\s\d{1,5}(?!\d)/iu.test(d);
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

export function normalizarTextoParaVoz(texto: string | null | undefined): string {
  return String(texto ?? "")
    .replace(/\bAv\.?\s+/gi, "Avenida ")
    .replace(/\bJr\.?\s+/gi, "Jirón ")
    .replace(/\bCl\.?\s+/gi, "Calle ")
    .replace(/\bPsj\.?\s+/gi, "Pasaje ")
    .replace(/\bUrb\.?\s+/gi, "Urbanización ")
    .replace(/\bMz\.?\s*/gi, "Manzana ")
    .replace(/\bLt\.?\s*/gi, "Lote ")
    .replace(/\bNro\.?\s*/gi, "número ")
    .replace(/\bN°\s*/gi, "número ")
    .replace(/\bDpto\.?\s*/gi, "Departamento ")
    .replace(/\bInt\.?\s*/gi, "Interior ")
    .replace(/\bNAC\s?600\b/gi, "NAC seiscientos")
    .replace(/\bNAD\+/gi, "NAD plus")
    .replace(/S\/\s?(\d+(?:\.\d+)?)/gi, "$1 soles")
    .replace(/\.+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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
    const faltantes: string[] = [...(p.pendientesExtra ?? [])];
    if (!direccion || !tieneNumeroDeCasa(direccion)) {
      faltantes.push("la dirección exacta con calle y número de casa (o manzana y lote)");
    }
    if (!tieneRef) {
      faltantes.push("una referencia clara de su domicilio (color de fachada, frente a qué está o paradero cercano)");
    }
    if (!distrito) {
      faltantes.push("el distrito exacto");
    }
    if (!/Horario:/i.test(p.notas ?? "")) {
      faltantes.push("el día y rango de horario en que se encuentra para recibir al repartidor");
    }
    if (/Sin pin del cliente/i.test(p.notas ?? "")) {
      faltantes.push("que al colgar te mande su ubicación por WhatsApp (clip → Ubicación)");
    }

    const dirMostrar = [direccion, distrito, ciudad].filter(Boolean).join(", ") || ciudad;
    const dirVoz = normalizarTextoParaVoz(dirMostrar);
    const prodVoz = formatearProductoParaVoz(p.productosTexto);
    const saludo = primerNombre
      ? `¡Hola, ${primerNombre}! Qué tal, te saluda Sofía de Aliv Perú. Te llamo rapidito porque recibimos tu pedido de ${prodVoz} por ${totalNum} soles con envío gratis a ${dirVoz}, pagas al recibir. ¿Me confirmas si todo está correcto para programarte la entrega?`
      : `¡Hola! Qué tal, te saluda Sofía de Aliv Perú. Te llamo rapidito porque recibimos tu pedido de ${prodVoz} por ${totalNum} soles con envío gratis a ${dirVoz}, pagas al recibir. ¿Me confirmas si todo está correcto para programarte la entrega?`;

    const primerFaltante = faltantes[0] ?? "el día y horario de entrega";
    const saludoFinal = p.yaConfirmado
      ? `¡Hola${primerNombre ? `, ${primerNombre}` : ""}! Qué tal, te saluda Sofía de Aliv Perú. Tu pedido de ${prodVoz} ya está confirmado. Te llamo rapidito solo para completar un dato y programar tu entrega: ${primerFaltante}.`
      : saludo;

    const instrucciones = [
      ...(p.yaConfirmado
        ? [
            `EL CLIENTE YA CONFIRMÓ SU PEDIDO. NO le preguntes si lo desea ni le repitas todo el pedido: tu único objetivo es completar los datos pendientes.`,
          ]
        : []),
      ...(p.contexto ? [`CONTEXTO DEL CHAT: ${p.contexto}`] : []),
      `MODALIDAD DEL PEDIDO: CONTRAENTREGA A DOMICILIO (PAGA AL RECIBIR S/ ${totalNum}).`,
      `PROHIBIDO pedir adelanto de S/ 20, PROHIBIDO mencionar agencia Shalom y PROHIBIDO pedir DNI.`,
      `Dirección registrada en formulario: "${dirMostrar}".`,
      `Tu objetivo en esta llamada corta (máximo 60 segundos):`,
      p.yaConfirmado
        ? `1. Recordarle en una frase que paga S/ ${totalNum} al recibir (Yape, Plin o efectivo), sin adelantos.`
        : `1. Confirmar que el cliente desea recibir su pedido #${ordenLimpia} (${p.productosTexto} por S/ ${totalNum}, pago contraentrega al recibir por Yape, Plin o efectivo).`,
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
      saludo_inicial: saludoFinal,
      instrucciones_especificas: instrucciones,
    };
  }

  // MODALIDAD 2: Agencia Shalom (Provincia sin cobertura COD de AliClik)
  const sedes = buscarSedesShalomParaVoz(ciudad, distrito, direccion);
  const sedesTexto = sedes.length > 0 ? sedes.join(" | ") : `Agencia Shalom de ${ciudad}`;
  const primeraSede = sedes[0] ?? `la agencia Shalom de ${ciudad}`;

  const faltantesShalom: string[] = [...(p.pendientesExtra ?? [])];
  if (!tieneDni) {
    faltantesShalom.push("su número de DNI de 8 dígitos para emitir la guía oficial de remisión en Shalom");
  }
  faltantesShalom.push(`confirmar a cuál de las agencias Shalom de ${ciudad} prefiere que enviemos su paquete (${sedesTexto})`);
  faltantesShalom.push("confirmar el adelanto de 20 soles por Yape al 951 365 418 a nombre de Gerardo Huaynalaya que ya le enviamos a su WhatsApp");

  const prodVozShalom = formatearProductoParaVoz(p.productosTexto);
  const sedeVozShalom = normalizarTextoParaVoz(primeraSede);
  const saludoShalom = primerNombre
    ? `¡Hola, ${primerNombre}! Qué tal, te saluda Sofía de Aliv Perú. Te llamo rapidito porque recibimos tu pedido de ${prodVozShalom} por ${totalNum} soles con envío gratis a ${ciudad}. Para tu zona despachamos por agencia Shalom y cerca tienes la sede de ${sedeVozShalom}. ¿Te queda cómoda esa agencia para recogerlo?`
    : `¡Hola! Qué tal, te saluda Sofía de Aliv Perú. Te llamo rapidito porque recibimos tu pedido de ${prodVozShalom} por ${totalNum} soles con envío gratis a ${ciudad}. Para tu zona despachamos por agencia Shalom y cerca tienes la sede de ${sedeVozShalom}. ¿Te queda cómoda esa agencia para recogerlo?`;

  const instruccionesShalom = [
    ...(p.contexto ? [`CONTEXTO DEL CHAT: ${p.contexto}`] : []),
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
export const PROMPT_AGENTE_VOZ_ALIV = `Eres Sofía, coordinadora de despacho de Aliv Perú (alivstore.shop, RUC 20612283134). Hablas español peruano natural, cálido, empático, ágil y muy profesional.
Estás realizando una llamada telefónica saliente inmediata a un cliente que acaba de registrar su pedido en nuestra tienda web.

DATOS DEL PEDIDO ACTUAL:
- Cliente: {{nombre_cliente}}
- Pedido: {{numero_orden}} ({{productos}})
- Monto Total: {{total_soles}} soles
- Ciudad / Distrito: {{ciudad}} / {{distrito}}
- Dirección registrada: {{direccion_registrada}}
- Modalidad determinada por cobertura: {{modalidad}}

INSTRUCCIONES ESPECÍFICAS PARA ESTE PEDIDO:
{{instrucciones_especificas}}

CONOCIMIENTO GENERAL DE PRODUCTOS (RESPONDE BREVE Y CON SEGURIDAD SI EL CLIENTE PREGUNTA):
1. NAC seiscientos + NAD plus (NAC600):
   - Qué es: Suplemento antioxidante importado de Estados Unidos (laboratorio The Modern Formula), 60 cápsulas por frasco en aceite de coco y MCT (suave para el estómago, sin olor ni sabor a azufre).
   - Para qué sirve: Aporta cisteína para que el cuerpo produzca glutatión (su principal antioxidante) y NAD plus que apoya la energía celular diaria.
   - Dosis y modo de uso: Se toman 2 cápsulas al día con agua, de preferencia junto con el desayuno. Un frasco de 60 cápsulas rinde exactamente 30 días.
   - Precios oficiales: 1 frasco 119 soles, 2 frascos 189 soles, 3 frascos 199 soles (el más elegido para 90 días).
   - Regla de salud: Es un complemento de bienestar, no es un medicamento ni cura enfermedades. Si el cliente menciona embarazo, lactancia o medicación específica, respóndele la dosis normal y recomiéndale comentarlo con su médico.
2. Tobillera Termix:
   - Qué es: Tobillera inalámbrica con calor de grafeno regulable hasta 60 grados y 3 niveles de masaje por vibración.
   - Características: Talla universal con velcro (18 a 34 centímetros), sirve para pie izquierdo o derecho, batería recargable por cable USB-C incluido.
   - Precios oficiales: 1 tobillera 79 soles, 2 tobilleras (el par) 139 soles, 3 tobilleras 189 soles.
3. Confianza y garantía:
   - Somos Aliv Perú, empresa formal con RUC 20612283134. Envíos gratis de lunes a sábado (domingos no hay reparto). Garantía de 30 días si el producto llega dañado o con falla de fábrica.

REGLAS DE VOZ Y ESTILO PERUANO:
- Habla en frases cortas y conversacionales (1 a 2 oraciones por turno, máximo 25 palabras por intervención). Nunca des monólogos largos.
- Usa un tono peruano cercano, amable y confiable ("Qué tal", "Perfecto", "Claro que sí", "Listo").
- Si el cliente hace una pregunta sobre cómo se toma, qué contiene o los precios, respóndele de forma natural en 1 o 2 frases y enseguida retoma el dato que te falta para programar su despacho.
- Cuando el cliente te dé una referencia de su casa, un horario o su DNI de 8 dígitos, repítelo brevemente para confirmar que lo anotaste bien.
- Si {{modalidad}} es COD_DOMICILIO: el cliente paga los {{total_soles}} soles AL RECIBIR en su domicilio. JAMÁS pidas adelanto de 20 soles ni menciones agencia Shalom. Solo confirma el pedido, pide una referencia clara de su casa o fachada y el día y horario en que puede recibir al repartidor.
- Si {{modalidad}} es AGENCIA_SHALOM: confirma en cuál de las agencias Shalom ({{agencias_shalom_cercanas}}) le queda más cómodo recoger, pídele su número de DNI de 8 dígitos para la guía oficial, e indícale que en su WhatsApp ya tiene nuestro número de Yape oficial 951 365 418 (a nombre de Gerardo Huaynalaya) para que envíe la captura del adelanto de 20 soles y el saldo de {{saldo_soles}} soles lo paga cuando el paquete llegue a su agencia.
- Si las INSTRUCCIONES ESPECÍFICAS dicen que el cliente YA CONFIRMÓ, no vuelvas a pedirle confirmación: ve directo a completar los datos pendientes. Si traen un CONTEXTO DEL CHAT, úsalo para no preguntar lo que el cliente ya dijo.
- Una vez que tengas los datos confirmados, agradécele con calidez y despídete.`;
