/**
 * Estados de Shalom leídos fuera del servidor (27/11/2026).
 *
 * Shalom movió su rastreo a una API con sesión cifrada y reCAPTCHA v3, así que el CRM ya
 * no puede consultarla sola desde Render. La revisión diaria (10:00) la hace Claude en el
 * navegador de Gerardo con su sesión de Shalom Pro, como lo haría una persona, y envía aquí
 * lo que ve en la página de Rastrea. Este módulo convierte ese reporte al mismo formato
 * que devolvía `consultarEstadoShalom`, para reutilizar intacta la cadencia de avisos.
 *
 * Módulo puro (sin base de datos) para poder probarlo.
 */
import type { ResultadoRastreoShalom } from "./shalom-rastreo";

export const ESTADOS_WEB_SHALOM = [
  "no_confirmado",
  "en_origen",
  "en_transito",
  "demora",
  "en_destino",
  "entregado",
] as const;
export type EstadoWebShalom = (typeof ESTADOS_WEB_SHALOM)[number];

export interface EstadoReportadoShalom {
  /** N° de orden de Shalom (la guía). */
  guia: string;
  estado: EstadoWebShalom;
  /** "Desde el 16/11/26 a las 07:00" → "2026-11-16 07:00" (hora de Lima). */
  desde?: string | null;
  /** Agencia de destino que muestra Rastrea, si se ve. */
  agenciaDestino?: string | null;
}

/** Texto del encabezado de Rastrea ("En destino", "Envío no confirmado"…) → estado. */
export function estadoDesdeTextoRastrea(texto: string): EstadoWebShalom | null {
  const t = texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim();
  if (t.includes("no confirmado")) return "no_confirmado";
  if (t.includes("entregado")) return "entregado";
  if (t.includes("destino")) return "en_destino";
  if (t.includes("demora")) return "demora";
  if (t.includes("transito")) return "en_transito";
  if (t.includes("origen")) return "en_origen";
  return null;
}

/** "16/11/26 a las 07:00" o "2026-11-16 07:00" → "2026-11-16 07:00:00"; si no se entiende, null. */
export function normalizarFechaShalom(v: string | null | undefined): string | null {
  if (!v) return null;
  const s = v.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(s);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]} ${iso[4]}:${iso[5]}:00`;
  const dmy = /(\d{1,2})\/(\d{1,2})\/(\d{2,4})\D+(\d{1,2}):(\d{2})/.exec(s);
  if (!dmy) return null;
  const anio = dmy[3].length === 2 ? `20${dmy[3]}` : dmy[3];
  const pad = (n: string) => n.padStart(2, "0");
  return `${anio}-${pad(dmy[2])}-${pad(dmy[1])} ${pad(dmy[4])}:${dmy[5]}:00`;
}

export function aResultadoRastreo(r: EstadoReportadoShalom): ResultadoRastreoShalom {
  const desde = normalizarFechaShalom(r.desde);
  const enDestino = r.estado === "en_destino";
  const entregado = r.estado === "entregado";
  return {
    ok: true,
    mensaje: `Estado leído en la web de Shalom: ${r.estado}`,
    estadoGeneral: entregado ? "entregado" : enDestino ? "en_destino" : "en_transito",
    enDestinoListoParaRecojo: enDestino,
    yaEntregado: entregado,
    confirmadoEnOrigen: r.estado !== "no_confirmado",
    fechaConfirmacion: r.estado === "en_origen" ? desde ?? undefined : undefined,
    fechaLlegadaDestino: enDestino ? desde ?? undefined : undefined,
    agenciaDestino: r.agenciaDestino?.trim() || undefined,
  };
}

/** Valida el cuerpo del POST y arma el mapa guía → resultado. Devuelve también los rechazados. */
export function leerReporteEstados(body: unknown): {
  estados: Map<string, ResultadoRastreoShalom>;
  rechazados: string[];
} {
  const estados = new Map<string, ResultadoRastreoShalom>();
  const rechazados: string[] = [];
  const lista = (body as { estados?: unknown })?.estados;
  if (!Array.isArray(lista)) return { estados, rechazados: ["falta la lista «estados»"] };
  for (const item of lista) {
    const it = item as Partial<EstadoReportadoShalom> & { texto?: string };
    const guia = String(it?.guia ?? "").replace(/\D/g, "");
    const estado =
      (ESTADOS_WEB_SHALOM as readonly string[]).includes(String(it?.estado))
        ? (it.estado as EstadoWebShalom)
        : estadoDesdeTextoRastrea(String(it?.texto ?? it?.estado ?? ""));
    if (!guia || !estado) {
      rechazados.push(`${it?.guia ?? "?"}: estado no reconocido`);
      continue;
    }
    estados.set(guia, aResultadoRastreo({ guia, estado, desde: it.desde, agenciaDestino: it.agenciaDestino }));
  }
  return { estados, rechazados };
}

/**
 * Texto para la vendedora cuando el paquete llegó y el cliente no tiene la ventana de 24 h
 * abierta (no se le puede escribir texto libre). Sin montos, guía ni clave: el perfil
 * Vendedor no recibe datos de dinero ni de logística sensible.
 */
export function textoLlamarClienteAgencia(d: {
  cliente: string;
  telefono: string | null;
  numeroOrden: string;
  agencia: string;
  dias: number | null;
}): string {
  const tiempo = d.dias && d.dias >= 1 ? ` (lleva ${d.dias} día${d.dias === 1 ? "" : "s"} en agencia)` : "";
  return (
    `📞 *Llamar al cliente: paquete en agencia Shalom*\n` +
    `👤 ${d.cliente}${d.telefono ? ` · ${d.telefono}` : ""}\n` +
    `📦 Pedido ${d.numeroOrden} llegó a Shalom ${d.agencia}${tiempo}.\n` +
    `No tiene la ventana de WhatsApp abierta, así que el bot no puede escribirle. ` +
    `Llámalo y pídele que nos escriba al WhatsApp para coordinar su recojo.`
  );
}
