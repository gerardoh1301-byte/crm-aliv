/**
 * Extracción pura y determinística de datos tras una llamada de confirmación con IA
 * (ElevenLabs Conversational AI post-call webhook).
 *
 * Lee tanto los campos estructurados de `analysis.data_collection_results` de ElevenLabs
 * como la transcripción completa (`transcript`) como respaldo para no perder ningún dato
 * que el cliente haya dicho en la llamada (DNI de 8 dígitos, referencia de domicilio,
 * horario de recepción, agencia Shalom elegida, confirmación o cancelación).
 */

import { dniValido } from "@/lib/agent/datos-envio";
import { resolverAgenciaOficial, textoAgenciaOficial } from "@/lib/agencias/shalom-directorio";

export interface TurnoTranscripcion {
  role: "agent" | "user";
  message: string;
}

export interface DatosExtraidosLlamada {
  contestada: boolean;
  duracionSegundos: number;
  estadoConfirmacion: "confirmado" | "cancelado" | "pendiente" | "no_contesto";
  dniExtraido: string | null;
  referenciaDomicilio: string | null;
  distritoExtraido: string | null;
  horarioEntrega: string | null;
  agenciaShalomOficial: string | null;
  agenciaShalomRaw: string | null;
  compromisoAdelantoYape: boolean;
  observaciones: string | null;
  resumenLlamada: string;
  transcripcionTexto: string;
}

function valorDataCollection(
  dc: Record<string, unknown> | null | undefined,
  claves: string[]
): string | null {
  if (!dc || typeof dc !== "object") return null;
  const clavesNorm = new Set(claves.map((c) => c.toLowerCase().trim()));

  const extraerValor = (entry: unknown): string | null => {
    if (entry === null || entry === undefined) return null;
    if (typeof entry === "string" || typeof entry === "number" || typeof entry === "boolean") {
      const s = String(entry).trim();
      if (s && !/^(null|undefined|n\/a|none|ninguno)$/i.test(s)) return s;
    }
    if (typeof entry === "object" && "value" in (entry as Record<string, unknown>)) {
      const val = (entry as { value?: unknown }).value;
      if (val !== null && val !== undefined) {
        const s = String(val).trim();
        if (s && !/^(null|undefined|n\/a|none|ninguno)$/i.test(s)) return s;
      }
    }
    return null;
  };

  // 1. Búsqueda directa por clave del objeto (formato antiguo o pruebas)
  for (const k of claves) {
    if (k in dc) {
      const v = extraerValor(dc[k]);
      if (v !== null) return v;
    }
  }

  // 2. Búsqueda por propiedad interna `name` (ElevenLabs V2 usa keys `aitem_...` y pone el nombre adentro, a veces con espacio al final como `"confirmado "`)
  for (const entry of Object.values(dc)) {
    if (entry && typeof entry === "object" && "name" in (entry as Record<string, unknown>)) {
      const entryName = String((entry as { name?: unknown }).name ?? "")
        .toLowerCase()
        .trim();
      if (clavesNorm.has(entryName)) {
        const v = extraerValor(entry);
        if (v !== null) return v;
      }
    }
  }

  return null;
}

/** Extrae un DNI de 8 dígitos de lo que dijo el cliente en la llamada (incluso si lo dictó separado). */
export function extraerDniDeTranscripcion(textoUsuario: string): string | null {
  if (!textoUsuario) return null;
  // 1. 8 dígitos seguidos o separados por espacios/guiones (no empieza con 9 de celular de 9 dígitos)
  const limpio = textoUsuario.replace(/\b9\d{8}\b/g, " "); // quitar celulares peruanos de 9 dígitos
  const mDirecto = limpio.match(/\b(\d{8})\b/);
  if (mDirecto) return mDirecto[1];

  // Si dictó dígitos separados por espacios o guiones: ej. "45 89 21 03" o "7 1 2 0 4 9 8 2"
  const secuencias = limpio.match(/(?:\d[\s.-]*){8,9}/g) ?? [];
  for (const seq of secuencias) {
    const soloDigitos = seq.replace(/\D/g, "");
    if (soloDigitos.length === 8) return soloDigitos;
  }
  return null;
}

/** Extrae referencia domiciliaria si el cliente la mencionó en la transcripción y ElevenLabs no la separó. */
export function extraerReferenciaDeTranscripcion(turnosUsuario: string[]): string | null {
  const texto = turnosUsuario.join(" · ");
  const m = texto.match(
    /\b((?:frente a|al costado de|cerca (?:a|de)|a media cuadra de|a \d+ cuadras? de|altura (?:de|del)|espalda (?:de|del)|puerta|fachada|port[oó]n|reja|casa de \d+ pisos|edificio|paradero|colegio|parque|mercado|posta|grifo|botica|farmacia)[^.!?\n]{3,90})/i
  );
  return m ? m[1].trim() : null;
}

/** Extrae horario o día mencionado por el cliente en la transcripción. */
export function extraerHorarioDeTranscripcion(turnosUsuario: string[]): string | null {
  const texto = turnosUsuario.join(" · ");
  const m = texto.match(
    /\b((?:en la ma[nñ]ana|por la ma[nñ]ana|en la tarde|por la tarde|todo el d[ií]a|de \d{1,2} a \d{1,2}|a partir de las \d{1,2}|despu[eé]s de las \d{1,2}|antes de las \d{1,2}|lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|ma[nñ]ana)[^.!?\n]{0,60})/i
  );
  return m ? m[1].trim() : null;
}

/** Detecta mensajes grabados de buzón de voz de operadoras peruanas (Claro, Movistar, Entel, Bitel). */
const RE_BUZON_VOZ =
  /\b(buz[oó]n de voz|casilla de voz|mensaje de voz|despu[eé]s del tono|tiempo l[ií]mite de mensaje|mensaje fue grabado|no se encuentra disponible|no puede contestar|llamada ser[aá] transferida|deje su mensaje|fuera del [aá]rea de cobertura|el n[uú]mero marcado|voicemail|leave a message|marcando (?:\d|uno|dos|tres|cuatro|cinco)|duraci[oó]n m[aá]xima)\b/i;

export function esSoloBuzonOSilencio(turnosUsuario: string[]): boolean {
  const limpios = turnosUsuario
    .map((t) => t.replace(/[\s.,…¡!¿?\-_]+/g, " ").trim())
    .filter((t) => t.length > 0);
  if (limpios.length === 0) return true;
  // Si todos los turnos "del usuario" son grabaciones de buzón de voz
  return limpios.every((t) => RE_BUZON_VOZ.test(t));
}

export function analizarPayloadPostLlamada(
  payload: Record<string, unknown>,
  ciudadPedido?: string | null
): DatosExtraidosLlamada {
  const data = (
    payload.data && typeof payload.data === "object" ? (payload.data as Record<string, unknown>) : payload
  ) as Record<string, unknown>;

  const rawTranscript = Array.isArray(data.transcript) ? data.transcript : [];
  const turnos: TurnoTranscripcion[] = rawTranscript
    .map((t) => {
      if (!t || typeof t !== "object") return null;
      const obj = t as Record<string, unknown>;
      const role: "agent" | "user" = obj.role === "user" ? "user" : "agent";
      const msg = typeof obj.message === "string" ? obj.message.trim() : "";
      return msg ? { role, message: msg } : null;
    })
    .filter((t): t is TurnoTranscripcion => Boolean(t));

  const turnosUsuario = turnos.filter((t) => t.role === "user").map((t) => t.message);
  const textoUsuarioCompleto = turnosUsuario.join("\n");
  const transcripcionTexto = turnos
    .map((t) => `${t.role === "agent" ? "Sofía (IA)" : "Cliente"}: ${t.message}`)
    .join("\n");

  const metadata = (data.metadata && typeof data.metadata === "object" ? data.metadata : {}) as Record<string, unknown>;
  const duracionSegundos = Number(metadata.call_duration_secs ?? data.call_duration_secs ?? 0) || 0;

  const analysis = (data.analysis && typeof data.analysis === "object" ? data.analysis : {}) as Record<string, unknown>;
  const dc = (
    analysis.data_collection_results && typeof analysis.data_collection_results === "object"
      ? analysis.data_collection_results
      : {}
  ) as Record<string, unknown>;

  const resumenRaw =
    (typeof analysis.transcript_summary === "string" && analysis.transcript_summary.trim()) ||
    valorDataCollection(dc, ["resumen", "summary", "observaciones"]) ||
    "";

  // ¿Contestó el cliente humano (y no fue solo buzón de voz o puntos suspensivos de silencio)?
  const soloBuzon = esSoloBuzonOSilencio(turnosUsuario);
  const contestada = !soloBuzon && turnosUsuario.length > 0 && duracionSegundos >= 5;

  // Estado de confirmación
  const confirmadoDc = valorDataCollection(dc, ["pedido_confirmado", "confirmado", "confirmed", "estado_pedido"]);
  const textoUsuarioNorm = textoUsuarioCompleto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  let estadoConfirmacion: DatosExtraidosLlamada["estadoConfirmacion"] = contestada ? "pendiente" : "no_contesto";

  // Si solo habló el buzón de voz, el «confirmado: no» de la IA no es del cliente (27/11, #1202).
  if (confirmadoDc && contestada) {
    if (/^(true|si|sí|confirmado|yes|1)$/i.test(confirmadoDc)) {
      estadoConfirmacion = "confirmado";
    } else if (/^(false|no|cancelado|rechazado|cancel)$/i.test(confirmadoDc)) {
      estadoConfirmacion = "cancelado";
    }
  }

  if (contestada && estadoConfirmacion === "pendiente") {
    if (
      /\b(no lo quiero|ya no deseo|cancela|cancelar|me equivoque|no pedi|no hice ningun pedido|no voy a poder)\b/.test(
        textoUsuarioNorm
      )
    ) {
      estadoConfirmacion = "cancelado";
    } else if (
      /\b(si|claro|correcto|esta bien|confirmo|mandalo|envialo|en la manana|en la tarde|todo el dia|shalom)\b/.test(
        textoUsuarioNorm
      )
    ) {
      estadoConfirmacion = "confirmado";
    }
  }

  // DNI
  const dniDc = valorDataCollection(dc, ["dni", "dni_cliente", "numero_dni", "documento"]);
  const dniExtraido = dniValido(dniDc) || extraerDniDeTranscripcion(textoUsuarioCompleto);

  // Referencia de domicilio
  const refDc = valorDataCollection(dc, [
    "referencia",
    "referencia_domicilio",
    "referencia_direccion",
    "address_reference",
  ]);
  const referenciaDomicilio = refDc || extraerReferenciaDeTranscripcion(turnosUsuario);

  // Distrito
  const distritoExtraido = valorDataCollection(dc, ["distrito", "district"]);

  // Horario de entrega
  const horarioDc = valorDataCollection(dc, [
    "horario_entrega",
    "horario",
    "dia_horario",
    "delivery_schedule",
    "fecha_entrega",
  ]);
  const horarioEntrega = horarioDc || extraerHorarioDeTranscripcion(turnosUsuario);

  // Agencia Shalom
  const agenciaDc = valorDataCollection(dc, ["agencia_shalom", "agencia", "sede_shalom", "shalom_agency"]);
  let agenciaShalomOficial: string | null = null;
  if (agenciaDc) {
    const r = resolverAgenciaOficial({ texto: agenciaDc, ciudad: ciudadPedido ?? undefined });
    if (r.agencia) {
      agenciaShalomOficial = textoAgenciaOficial(r.agencia);
    }
  }
  if (!agenciaShalomOficial && ciudadPedido && turnosUsuario.length > 0) {
    const r = resolverAgenciaOficial({ texto: textoUsuarioCompleto, ciudad: ciudadPedido });
    if (r.agencia && r.motivo === "exacta") {
      agenciaShalomOficial = textoAgenciaOficial(r.agencia);
    }
  }

  // Compromiso de adelanto Yape
  const yapeDc = valorDataCollection(dc, ["compromiso_adelanto", "adelanto_yape", "enviara_yape"]);
  const compromisoAdelantoYape = Boolean(
    (yapeDc && /^(true|si|sí|yes|1)$/i.test(yapeDc)) ||
      /\b(ahorita (?:lo |te )?(?:yapeo|mando|envio)|ya te mando|te (?:mando|envio) (?:el yape|la captura|el adelanto)|voy a yapear|si tengo yape)\b/.test(
        textoUsuarioNorm
      )
  );

  const observaciones = valorDataCollection(dc, ["observaciones", "notas", "notes"]);

  const resumenPartes: string[] = [];
  if (!contestada) {
    resumenPartes.push("El cliente no contestó la llamada o entró buzón de voz.");
  } else {
    resumenPartes.push(
      `Resultado: ${
        estadoConfirmacion === "confirmado"
          ? "✅ Cliente confirmó el pedido en llamada"
          : estadoConfirmacion === "cancelado"
          ? "❌ Cliente solicitó cancelar en llamada"
          : "⏳ Conversación atendida (pendiente completar)"
      } (${duracionSegundos}s).`
    );
    if (referenciaDomicilio) resumenPartes.push(`📍 Referencia capturada: ${referenciaDomicilio}`);
    if (distritoExtraido) resumenPartes.push(`🏘️ Distrito: ${distritoExtraido}`);
    if (horarioEntrega) resumenPartes.push(`🗓️ Horario acordado: ${horarioEntrega}`);
    if (dniExtraido) resumenPartes.push(`🪪 DNI capturado: ${dniExtraido}`);
    if (agenciaShalomOficial || agenciaDc) {
      resumenPartes.push(`📦 Agencia Shalom: ${agenciaShalomOficial ?? agenciaDc}`);
    }
    if (compromisoAdelantoYape) resumenPartes.push(`💳 Cliente indicó que enviará el Yape de adelanto.`);
    if (observaciones) resumenPartes.push(`📝 Notas: ${observaciones}`);
    if (resumenRaw) resumenPartes.push(`💬 Resumen IA: ${resumenRaw}`);
  }

  return {
    contestada,
    duracionSegundos,
    estadoConfirmacion,
    dniExtraido,
    referenciaDomicilio,
    distritoExtraido,
    horarioEntrega,
    agenciaShalomOficial,
    agenciaShalomRaw: agenciaDc,
    compromisoAdelantoYape,
    observaciones,
    resumenLlamada: resumenPartes.join("\n"),
    transcripcionTexto,
  };
}
