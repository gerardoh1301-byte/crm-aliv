/**
 * Rescate con algo nuevo (auditoría 21/11, V3).
 *
 * Antes: 42 rescates «te escribo por última vez» con la misma oferta (3 por S/199) y 2
 * respuestas; además le llegaban a quien ya había dicho «gracias, por ahora no» o «no tengo
 * dinero, yo le aviso».
 *
 * Ahora:
 * - Quien cerró la puerta (por ahora no, yo le aviso, no me escriban) no recibe rescate.
 * - Quien solo frenó por plata («está caro», «no me alcanza») recibe el pack de entrada.
 * - Cada toque aporta un valor que el cliente aún no tenía, y el segundo no repite el del
 *   primero. La variante queda en la nota [RESCATE VENTAS] para medir respuestas por valor.
 * Puro para poder probarlo.
 */
import type { TipoEscenarioRescate } from "./rescate";

export type ValorRescate = "dato_pendiente" | "pago_al_recibir" | "garantia_confianza" | "pack_entrada";

export type ObjecionCliente = "rechazo" | "dinero" | null;

function sinTildes(t: string): string {
  return t.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/** Cerró la puerta: no se le vuelve a escribir para vender. */
const RE_RECHAZO_FIRME =
  /\b(por ahora no|ahora no|no gracias|no me interesa|no estoy interesad[oa]|ya no (deseo|quiero|me interesa)|no deseo|no voy a querer|cancelalo|compre en otro|no por el momento|mas adelante|despues le aviso|yo le aviso|yo te aviso|le aviso|te aviso|no me escriban|no me esten escribiendo|dejen de escribir|deja no mas|no insistan)\b/;

/** Frenó solo por plata: se le puede ofrecer algo más chico. */
const RE_DINERO =
  /\b(caro|carisimo|costoso|no tengo (dinero|plata)|no me alcanza|sin plata|ando (corto|misio)|estoy (corto|misio)|no cuento con (el )?dinero|descuento|rebaja)\b/;

/**
 * Mira los últimos mensajes del cliente (del más nuevo al más viejo). Un rechazo firme en
 * cualquiera de los 3 últimos manda sobre todo; si no, una objeción de plata.
 */
export function clasificarObjecionCliente(mensajesCliente: string[]): ObjecionCliente {
  const recientes = mensajesCliente.slice(0, 3).map(sinTildes);
  if (recientes.some((t) => RE_RECHAZO_FIRME.test(t))) return "rechazo";
  if (recientes.some((t) => RE_DINERO.test(t))) return "dinero";
  return null;
}

/**
 * Valor de cada toque. El primero responde a lo que frenó al cliente; el segundo trae otra
 * cosa. `packEntradaYa`: ya eligió el pack más chico, así que el pack de entrada no es nuevo.
 */
export function elegirValorRescate(e: {
  escenario: TipoEscenarioRescate;
  objecion: ObjecionCliente;
  toque: 1 | 2;
  packEntradaYa?: boolean;
}): ValorRescate {
  if (e.escenario === "direccion_incompleta") return "dato_pendiente";
  const respaldo: ValorRescate = e.escenario === "adelanto_provincia" ? "garantia_confianza" : "pago_al_recibir";
  const primero: ValorRescate = e.objecion === "dinero" && !e.packEntradaYa ? "pack_entrada" : respaldo;
  if (e.toque === 1) return primero;
  if (primero === "pack_entrada") return respaldo === "pago_al_recibir" ? "garantia_confianza" : respaldo;
  return e.packEntradaYa ? (respaldo === "pago_al_recibir" ? "garantia_confianza" : "pago_al_recibir") : "pack_entrada";
}

type Producto = "nac600" | "termix";

function packEntrada(producto: Producto): string {
  return producto === "termix" ? "1 Tobillera Termix a *S/79*" : "1 frasco de NAC600 + NAD+ a *S/119*";
}

/** Instrucción para la IA del primer toque: qué tiene que traer de nuevo el mensaje. */
export function instruccionValor(valor: ValorRescate, producto: Producto, esProvincia: boolean): string {
  switch (valor) {
    case "pack_entrada":
      return `el cliente frenó por el precio: ofrécele empezar con algo más chico, ${packEntrada(producto)} con envío gratis${
        esProvincia ? " (adelanto de S/20 y el saldo al llegar a la agencia)" : " y pago al recibir"
      }. No vuelvas a ofrecer el pack grande.`;
    case "garantia_confianza":
      return "dale confianza con datos concretos: somos Aliv Perú (RUC 20612283134), el envío sale con guía oficial de Shalom que puede rastrear y tiene garantía de 30 días por fallas de fábrica.";
    case "pago_al_recibir":
      return "recuérdale que en Lima no paga nada por adelantado: el motorizado se lo lleva y paga al recibir por Yape, Plin o transferencia, con envío gratis. Cierra con una alternativa («¿Te lo agendo para esta semana o prefieres la próxima?»).";
    default:
      return "solo falta su dato (dirección o ubicación) para despachar; pídelo en una línea.";
  }
}

/** Segundo y último toque: corto, con el valor nuevo y una pregunta que se contesta con «sí». */
export function textoSegundoToque(
  escenario: TipoEscenarioRescate,
  valor: ValorRescate,
  nombre: string | null,
  producto: Producto
): string {
  const saludo = nombre ? `${nombre}, ` : "";
  if (escenario === "direccion_incompleta" || valor === "dato_pendiente") {
    return `${saludo}tu pedido sigue separado 📦. Solo respóndeme con tu dirección o tu ubicación y lo dejo en ruta para la próxima entrega.`;
  }
  if (valor === "pack_entrada") {
    const resto =
      escenario === "adelanto_provincia"
        ? "con el adelanto de S/20 al Yape *951365418* (Gerardo Huaynalaya) y el saldo cuando llegue a tu agencia Shalom"
        : "con envío gratis y pagas al recibir";
    return `${saludo}si prefieres probar primero, puedes empezar con ${packEntrada(producto)}, ${resto}. ¿Te lo separo?`;
  }
  if (valor === "garantia_confianza") {
    return `${saludo}por si te quedó alguna duda: somos Aliv Perú (RUC 20612283134), tu envío sale con guía oficial de Shalom que puedes rastrear y tiene garantía de 30 días por fallas de fábrica. ¿Te lo separo? 🙂`;
  }
  return `${saludo}en Lima no pagas nada por adelantado: el motorizado te lo lleva y pagas al recibir, con envío gratis. ¿Te lo agendo para esta semana? Responde «sí» y lo dejo listo 🙂`;
}

/** Texto del primer toque sin IA cuando el valor es el pack de entrada. */
export function textoPrimerToquePackEntrada(saludo: string, producto: Producto, esProvincia: boolean): string {
  return `${saludo} Te entiendo, a veces conviene probar primero 🙂. Puedes empezar con ${packEntrada(producto)} con envío gratis${
    esProvincia ? ": solo S/20 de adelanto y el saldo cuando llegue a tu agencia Shalom" : " y pagas recién al recibir"
  }. ¿Te lo separo?`;
}

/** Marca para la nota [RESCATE VENTAS]; /api/metricas la lee para medir respuestas por valor. */
export function marcaValor(valor: ValorRescate): string {
  return `valor=${valor}`;
}
