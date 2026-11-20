import { nombreParaSaludo } from "@/lib/nombres";

/**
 * Reglas puras del rescate de formularios abandonados (EasySell COD en alivstore.shop).
 *
 * Un "abandono" es un cliente que escribió su celular en el formulario de compra y no
 * lo envió. La landing manda esos datos a /api/webhooks/formulario-abandonado; el barrido
 * /api/agent/abandonos decide aquí qué hacer con cada uno. Sin base de datos para que
 * los tests cubran los tiempos y los cortes sin montar nada.
 *
 * El estado vive en etiquetas del contacto (sobreviven a una edición de la ficha):
 *   formulario_abandonado -> abandono_paso1 -> abandono_paso2 -> abandono_cerrado
 * y los finales abandono_respondio / abandono_recuperado cortan la secuencia.
 */

export const TAG_ABANDONO = "formulario_abandonado";
export const TAG_PASO1 = "abandono_paso1";
export const TAG_PASO2 = "abandono_paso2";
export const TAG_RESPONDIO = "abandono_respondio";
export const TAG_RECUPERADO = "abandono_recuperado";
export const TAG_CERRADO = "abandono_cerrado";

/** Etiquetas que significan "la secuencia automática de abandono ya terminó". */
export const TAGS_FINALES = [TAG_RESPONDIO, TAG_RECUPERADO, TAG_CERRADO];

/** Contacto con un abandono en curso: el rescate de chats no le escribe encima. */
export function abandonoEnCurso(tags: string[] | null | undefined): boolean {
  const t = (tags ?? []).map((x) => x.toLowerCase());
  return t.includes(TAG_ABANDONO) && !TAGS_FINALES.some((f) => t.includes(f));
}

/** Minutos de espera antes del primer mensaje (por si termina el formulario solo). */
export const MINUTOS_PASO1 = 30;
/** Horas entre el primer y el segundo mensaje. */
export const HORAS_PASO2 = 24;
/** Horas después del segundo mensaje para cerrar el abandono como perdido. */
export const HORAS_CIERRE = 48;
/** Un abandono más viejo que esto ya no recibe el primer mensaje (dato frío). */
export const HORAS_MAX_PRIMER_CONTACTO = 20;

/**
 * Normaliza un celular peruano a +51XXXXXXXXX. Acepta "987 654 321", "+51 987654321",
 * "51987654321", "0051987654321". Devuelve null si no es un celular (9 dígitos que
 * empiezan con 9): así un fijo o un número incompleto no dispara mensajes.
 */
export function normalizarCelularPe(raw: unknown): string | null {
  if (typeof raw !== "string" && typeof raw !== "number") return null;
  let d = String(raw).replace(/\D/g, "");
  if (d.startsWith("0051")) d = d.slice(4);
  if (d.length === 11 && d.startsWith("51")) d = d.slice(2);
  if (d.length !== 9 || !d.startsWith("9")) return null;
  if (/^9(\d)\1{7}$/.test(d)) return null; // 999999999, 911111111...
  return `+51${d}`;
}

export type ProductoAbandono = "nac600" | "termix";

/** Unidades del pack según producto y total (precios oficiales del prompt). */
export function unidadesPorTotal(producto: ProductoAbandono, total: number): number {
  const t = Math.round(total);
  if (producto === "termix") {
    if (t >= 189) return 3;
    if (t >= 139) return 2;
    return 1;
  }
  if (t >= 199) return 3;
  if (t >= 189) return 2;
  return 1;
}

/** Texto amable del pack: "3 frascos de NAC600", "2 Tobilleras Termix". */
export function describirPack(producto: ProductoAbandono, total: number): string {
  const n = unidadesPorTotal(producto, total);
  if (producto === "termix") return n === 1 ? "1 Tobillera Termix" : `${n} Tobilleras Termix`;
  return n === 1 ? "1 frasco de NAC600" : `${n} frascos de NAC600`;
}

export function detectarProducto(texto: string | null | undefined): ProductoAbandono {
  return /termix|tobill/i.test(texto ?? "") ? "termix" : "nac600";
}

export interface EstadoAbandono {
  tags: string[];
  /** Cuándo se capturó el formulario (último abandono registrado). */
  capturadoEn: Date;
  /** Cuándo salió el primer / segundo mensaje (de las actividades). */
  paso1En: Date | null;
  paso2En: Date | null;
  /** El cliente escribió por WhatsApp después de la captura. */
  respondioDespues: boolean;
  /** Hay un pedido (web o chat) creado después de la captura. */
  pedidoDespues: boolean;
  /** Hora local de Lima (0-23) para no escribir de madrugada. */
  horaLima: number;
}

export type AccionAbandono =
  | { accion: "esperar"; motivo: string }
  | { accion: "recuperado" }
  | { accion: "respondio" }
  | { accion: "paso1" }
  | { accion: "paso2" }
  | { accion: "cerrar"; motivo: string };

/** Ventana en la que se le escribe a un cliente: 08:30 a 20:59 (se redondea a 9-21). */
export function esHoraDeEscribir(horaLima: number): boolean {
  return horaLima >= 9 && horaLima < 21;
}

const horasEntre = (a: Date, b: Date) => (b.getTime() - a.getTime()) / 3_600_000;

/**
 * Decide el siguiente paso de un abandono. Orden de prioridad:
 * 1. Si ya compró -> recuperado (corta todo).
 * 2. Si respondió -> lo atiende el bot (corta la secuencia, no se insiste).
 * 3. Si ya terminó -> esperar (nada que hacer).
 * 4. Pasos por tiempo, solo en horario.
 */
export function decidirAccion(e: EstadoAbandono, ahora: Date): AccionAbandono {
  const tags = e.tags.map((t) => t.toLowerCase());
  if (TAGS_FINALES.some((t) => tags.includes(t))) {
    return { accion: "esperar", motivo: "secuencia terminada" };
  }
  if (e.pedidoDespues) return { accion: "recuperado" };
  if (e.respondioDespues) return { accion: "respondio" };

  const yaPaso1 = tags.includes(TAG_PASO1) || e.paso1En !== null;
  const yaPaso2 = tags.includes(TAG_PASO2) || e.paso2En !== null;

  if (!yaPaso1) {
    const horas = horasEntre(e.capturadoEn, ahora);
    if (horas * 60 < MINUTOS_PASO1) return { accion: "esperar", motivo: "aun dentro de los 30 min" };
    if (horas > HORAS_MAX_PRIMER_CONTACTO) {
      return { accion: "cerrar", motivo: `abandono de hace ${Math.round(horas)} h sin primer contacto` };
    }
    if (!esHoraDeEscribir(e.horaLima)) return { accion: "esperar", motivo: "fuera de horario" };
    return { accion: "paso1" };
  }

  if (!yaPaso2) {
    const base = e.paso1En ?? e.capturadoEn;
    if (horasEntre(base, ahora) < HORAS_PASO2) return { accion: "esperar", motivo: "esperando 24 h del paso 1" };
    if (!esHoraDeEscribir(e.horaLima)) return { accion: "esperar", motivo: "fuera de horario" };
    return { accion: "paso2" };
  }

  const base = e.paso2En ?? e.paso1En ?? e.capturadoEn;
  if (horasEntre(base, ahora) >= HORAS_CIERRE) {
    return { accion: "cerrar", motivo: "sin respuesta tras 2 mensajes" };
  }
  return { accion: "esperar", motivo: "esperando respuesta al paso 2" };
}

export interface DatosMensajeAbandono {
  nombre: string;
  producto: ProductoAbandono;
  total: number;
}

/** Primer nombre presentable o null (evita "WhatsApp 1234", alias con números). */
export function primerNombre(nombre: string | null | undefined): string | null {
  return nombreParaSaludo(nombre);
}

/**
 * Plantillas de Meta (hay que crearlas y aprobarlas en WhatsApp Manager con este texto;
 * las variables van en este orden). `texto` es lo que se ve en el chat del CRM.
 *
 * aliv_formulario_incompleto (Utilidad):
 *   "Hola {{1}}, te escribe Aliv Perú 🌿. Vimos que no se completó tu pedido de {{2}} por
 *    S/{{3}} en nuestra web. ¿Te ayudo a terminarlo por aquí? Envío gratis y en Lima
 *    pagas al recibir."
 * aliv_formulario_recordatorio (Utilidad):
 *   "Hola {{1}}, seguimos guardando tu pedido de {{2}} 📦. Si tuviste alguna duda con el
 *    formulario, respóndenos este mensaje y te lo dejamos registrado en 1 minuto."
 */
export function armarMensaje(paso: "paso1" | "paso2", d: DatosMensajeAbandono) {
  const nombre = primerNombre(d.nombre) ?? "";
  const saludo = nombre ? `Hola ${nombre}` : "Hola";
  const pack = describirPack(d.producto, d.total);
  const total = d.total > 0 ? d.total.toFixed(2) : d.producto === "termix" ? "139.00" : "199.00";
  if (paso === "paso1") {
    return {
      texto: `${saludo}, te escribe Aliv Perú 🌿. Vimos que no se completó tu pedido de ${pack} por S/${total} en nuestra web. ¿Te ayudo a terminarlo por aquí? Envío gratis y en Lima pagas al recibir.`,
      plantilla: {
        name: "aliv_formulario_incompleto",
        language: "es",
        params: [nombre || "😊", pack, total],
      },
    };
  }
  return {
    texto: `${saludo}, seguimos guardando tu pedido de ${pack} 📦. Si tuviste alguna duda con el formulario, respóndenos este mensaje y te lo dejamos registrado en 1 minuto.`,
    plantilla: {
      name: "aliv_formulario_recordatorio",
      language: "es",
      params: [nombre || "😊", pack],
    },
  };
}
