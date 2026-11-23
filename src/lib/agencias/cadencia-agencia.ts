/**
 * Cadencia de avisos cuando el paquete ya está en la agencia Shalom (clase CRM Driven, 22/11).
 * Reglas puras, sin base de datos.
 *
 * Antes: un aviso al llegar y luego el mismo recordatorio cada 20 h. Ahora:
 *  1. «llegada»: aviso al detectar que llegó (con saldo y Yape).
 *  2. «tarde»: 4 h después, el MISMO día y antes de las 18:00 de Lima, si el cliente no
 *     respondió: toque corto para que recoja hoy, mientras la agencia sigue abierta.
 *  3. «diario»: cada ~20 h, con texto distinto según los días en agencia.
 *  4. «riesgo»: desde el día 4, aviso de posible devolución + tarea de llamada para Gerardo.
 */

export type ToqueAgencia = "llegada" | "tarde" | "diario" | "riesgo";

const RE_MARCA = /\[AVISO_LLEGADA_ENVIADO:(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})/g;

/** Fechas (UTC) de los avisos ya enviados, según las marcas en las notas del pedido. */
export function avisosEnviados(notas: string | null | undefined): Date[] {
  const fechas: Date[] = [];
  for (const m of String(notas ?? "").matchAll(RE_MARCA)) {
    const d = new Date(`${m[1]}:00Z`);
    if (Number.isFinite(d.getTime())) fechas.push(d);
  }
  return fechas.sort((a, b) => a.getTime() - b.getTime());
}

function fechaLima(d: Date): string {
  return new Date(d.getTime() - 5 * 3_600_000).toISOString().slice(0, 10);
}

function horaLima(d: Date): number {
  const l = new Date(d.getTime() - 5 * 3_600_000);
  return l.getUTCHours() + l.getUTCMinutes() / 60;
}

export interface EntradaCadencia {
  ahora: Date;
  notasPedido: string | null;
  /** Horas desde que Shalom registró la llegada (null si no la informó). */
  horasEnAgencia: number | null;
  /** Último mensaje del cliente en el chat. */
  ultimoEntranteEn: Date | null;
  /** Último mensaje de la conversación (cualquier dirección). */
  ultimoMensajeEn: Date | null;
  forzar?: boolean;
  /** Pedido avisado antes de que existieran las marcas en notas (solo tiene la etiqueta). */
  avisadoSinMarca?: boolean;
}

export type DecisionCadencia =
  | { accion: "enviar"; toque: ToqueAgencia; diasEnAgencia: number }
  | { accion: "esperar"; motivo: string };

/** Días en agencia (1 = el día que llegó). Si Shalom no da la fecha, se cuenta desde el primer aviso. */
export function diasEnAgencia(horasEnAgencia: number | null, primerAviso: Date | null, ahora: Date): number {
  const horas =
    horasEnAgencia ?? (primerAviso ? (ahora.getTime() - primerAviso.getTime()) / 3_600_000 : 0);
  return Math.floor(Math.max(0, horas) / 24) + 1;
}

export function decidirToqueAgencia(e: EntradaCadencia): DecisionCadencia {
  const avisos = avisosEnviados(e.notasPedido);
  const primero = avisos[0] ?? null;
  const ultimo = avisos[avisos.length - 1] ?? null;
  const dias = diasEnAgencia(e.horasEnAgencia, primero, e.ahora);

  const horasDesdeMensaje = e.ultimoMensajeEn ? (e.ahora.getTime() - e.ultimoMensajeEn.getTime()) / 3_600_000 : 999;

  if (!ultimo) {
    if (!e.avisadoSinMarca) return { accion: "enviar", toque: "llegada", diasEnAgencia: dias };
    // Avisado sin marca: se sigue con el recordatorio diario (como antes).
    if (!e.forzar && horasDesdeMensaje < 20) return { accion: "esperar", motivo: `hubo conversación hace ${horasDesdeMensaje.toFixed(1)} h` };
    return { accion: "enviar", toque: dias >= 4 ? "riesgo" : "diario", diasEnAgencia: dias };
  }

  const horasDesdeAviso = (e.ahora.getTime() - ultimo.getTime()) / 3_600_000;
  const respondioDespues = Boolean(e.ultimoEntranteEn && e.ultimoEntranteEn.getTime() > ultimo.getTime());

  // Toque de la tarde: solo después del primer aviso, el mismo día y con la agencia abierta.
  if (
    avisos.length === 1 &&
    horasDesdeAviso >= 4 &&
    fechaLima(ultimo) === fechaLima(e.ahora) &&
    horaLima(e.ahora) < 18
  ) {
    if (respondioDespues) return { accion: "esperar", motivo: "el cliente respondió tras el aviso (lo atiende el chat)" };
    // Fuera de la ventana de 24 h saldría otra vez la plantilla de llegada: no vale la pena.
    const enVentana = Boolean(e.ultimoEntranteEn && e.ahora.getTime() - e.ultimoEntranteEn.getTime() < 23 * 3_600_000);
    if (!enVentana) return { accion: "esperar", motivo: "fuera de la ventana de 24 h (sigue el recordatorio diario)" };
    return { accion: "enviar", toque: "tarde", diasEnAgencia: dias };
  }

  // Diario: ~20 h desde el último aviso y sin conversación en curso.
  if (!e.forzar) {
    if (horasDesdeAviso < 20) return { accion: "esperar", motivo: `último aviso hace ${horasDesdeAviso.toFixed(1)} h` };
    if (horasDesdeMensaje < 20) return { accion: "esperar", motivo: `hubo conversación hace ${horasDesdeMensaje.toFixed(1)} h` };
  }
  return { accion: "enviar", toque: dias >= 4 ? "riesgo" : "diario", diasEnAgencia: dias };
}

export interface DatosMensajeAgencia {
  nombre: string;
  agencia: string;
  guia: string;
  codigo: string | null;
  saldo: number;
  /** Texto con el medio de pago (Yape/Plin y titular), igual que en el primer aviso. */
  medioPago: string;
}

/** Texto del toque. «llegada» y «diario» mantienen el formato de los avisos anteriores. */
export function mensajeToqueAgencia(toque: ToqueAgencia, dias: number, d: DatosMensajeAgencia): string {
  const saldo = `S/ ${d.saldo.toFixed(2)}`;
  const datosGuia = `• *N° de Orden Shalom:* ${d.guia}\n• *Código:* ${d.codigo ?? ""}`;
  switch (toque) {
    case "llegada":
      return `¡Hola, ${d.nombre}! 👋 Te saludamos de Aliv Perú 🌿🚚.

¡Buenas noticias! Te confirmamos que tu paquete ya llegó y se encuentra listo para retirar en la *Agencia Shalom ${d.agencia}* 📦✨.

${datosGuia}

Para enviarte tu *clave secreta de recojo* y puedas retirarlo hoy mismo con tu DNI físico en ventanilla, confírmanos por aquí el abono del saldo restante de *${saldo}* a nuestro ${d.medioPago}.

¿Nos compartes tu constancia por aquí para liberarte tu clave secreta de inmediato? 🔑🙌`;
    case "tarde":
      return `${d.nombre}, tu paquete ya te espera en la *Agencia Shalom ${d.agencia}* 📦

Si nos envías ahora la captura del saldo de *${saldo}*, te pasamos tu clave al toque y puedes recogerlo hoy mismo antes de que cierre la agencia. ¿Te acercas hoy? 🙌`;
    case "diario":
      return `¡Hola, ${d.nombre}! Te saludamos de Aliv Perú 🌿📦.

Te recordamos que tu pedido sigue listo en ventanilla de la *Agencia Shalom ${d.agencia}* 🏢 (día ${dias} en agencia).

${datosGuia}

Para enviarte tu *clave secreta de recojo* confírmanos el abono del saldo de *${saldo}* a nuestro ${d.medioPago}.

¿Nos confirmas qué día te acercas a retirarlo? 🙌`;
    case "riesgo":
      return `${d.nombre}, te escribimos de Aliv Perú porque tu paquete ya lleva *${dias} días* en la *Agencia Shalom ${d.agencia}* ⏰

Shalom devuelve a su almacén central los paquetes que no se recogen a tiempo, y ahí ya no podríamos entregártelo. Para no perderlo, envíanos la captura del saldo de *${saldo}* (${d.medioPago}) y te pasamos tu clave de inmediato.

Si tuviste algún inconveniente para recogerlo, cuéntanos y lo resolvemos contigo. 🙏`;
  }
}

export const PREFIJO_LLAMADA_AGENCIA = "[LLAMAR SHALOM]";
