/**
 * Barridos de recuperacion dentro del proceso (para Coolify / docker / cualquier host
 * con un proceso Node vivo).
 *
 * El camino normal no necesita esto: un mensaje entrante se contesta en ~7 s por el
 * webhook y `after()`. Pero si ese `after()` muere a mitad de camino, quedan jobs del
 * agente, eventos de webhook y corridas de automatizacion a medio procesar. Estos
 * barridos pegan cada SWEEP_INTERVAL_MIN (default 30) a los mismos endpoints que
 * usaba el cron de GitHub Actions, con el mismo secreto. En Vercel no corren (ahi
 * manda vercel.json + .github/workflows/sweepers.yml).
 */

const ENDPOINTS = [
  "/api/agent/process",
  "/api/webhooks/zernio",
  "/api/automations/process",
  // Avisa a los admins de chats sin respuesta (sistema integrado).
  "/api/alertas",
  // Ventana de 24 h de los supervisores por cerrar: los avisos internos van sin plantilla.
  "/api/agent/ventana-supervisor",
  // Auditoría automática de chats abandonados para rescate de ventas caídas
  "/api/agent/rescate",
  // Rastreo automático de envíos Shalom y avisos de llegada/recordatorio
  "/api/shalom/verificar-envios",
  // Pedidos contra entrega de AliClik: entregados pasan a Entregado (liquidación la valida una persona).
  "/api/aliclik/sincronizar-entregas",
  // Formularios EasySell abandonados: mensaje a los 30 min y a las 24 h
  "/api/agent/abandonos",
  // Seguimiento con hora: le escribe una vez a quien prometió volver y no volvió
  "/api/agent/seguimientos",
  // Toque en caliente: una vez a los 12-45 min si el bot pidió adelanto/datos o dio el precio
  "/api/agent/toque-caliente",
  // Contra entrega: recordatorio de ubicación y referencia a los 10 min; sin pin, punto de Google
  "/api/agent/ubicacion-ce",
  // Llamadas IA de primera hora (7:00 a. m. Lima) para pedidos web que entraron de madrugada (10pm-7am)
  "/api/agent/llamadas-pendientes",
  // Pedidos web de las últimas semanas: AG/CE según cobertura AliClik (una vez por pedido)
  "/api/agent/reclasificar-pedidos-web",
  // Posventa y recompra: incorpora los entregados (backfill idempotente, últimos 30 días)
  // y envía los mensajes del día 1-3, 7 y 25 en horario permitido.
  "/api/agent/postventa?backfill=true",
  // Copia de los chats en Drive, una vez por día de Lima (las otras vueltas salen al toque).
  "/api/respaldo/chats",
  // 22:00 Lima: pendientes de cada vendedor a su WhatsApp y resumen general a Gerardo.
  "/api/agent/resumen-diario",
];

import { iniciarMantenerDespierto } from "./mantener-despierto";

declare global {
  var __builderBarridos: ReturnType<typeof setInterval> | undefined;
  var __builderBarridoEnCurso: boolean | undefined;
}

export function iniciarBarridos() {
  // Independiente del secreto: sin esto Render gratis se duerme y pierde los webhooks.
  iniciarMantenerDespierto();
  if (globalThis.__builderBarridos) return;

  const secreto = process.env.AGENT_WORKER_SECRET;
  if (!secreto) {
    console.warn("[barridos] AGENT_WORKER_SECRET vacio: los barridos no arrancan");
    return;
  }

  const minutos = Number(process.env.SWEEP_INTERVAL_MIN) || 2;
  const base = `http://127.0.0.1:${process.env.PORT || 3000}`;

  const correr = async () => {
    // E5: una vuelta puede tardar más que el intervalo (10 rutas de hasta 60 s). Si la
    // anterior sigue, esta se salta: dos vueltas a la vez podían mandar dos veces el mismo
    // rescate o mensaje de posventa.
    if (globalThis.__builderBarridoEnCurso) {
      console.warn("[barridos] la vuelta anterior sigue en curso; se omite esta");
      return;
    }
    globalThis.__builderBarridoEnCurso = true;
    try {
      await correrRutas();
    } finally {
      globalThis.__builderBarridoEnCurso = false;
    }
  };

  const correrRutas = async () => {
    for (const ruta of ENDPOINTS) {
      try {
        const res = await fetch(base + ruta, {
          headers: { authorization: `Bearer ${secreto}` },
          signal: AbortSignal.timeout(60_000),
        });
        if (!res.ok) console.warn(`[barridos] ${ruta} -> ${res.status}`);
      } catch (err) {
        console.warn(`[barridos] ${ruta} fallo:`, err instanceof Error ? err.message : err);
      }
    }
  };

  // Primer barrido a los 5 segundos de arrancar: si un webhook de Zernio desperto a
  // Render de un cold start y dio timeout a los 5s, este barrido rescata el mensaje
  // entrante de inmediato y dispara la respuesta del agente.
  const primero = setTimeout(correr, 5_000);
  primero.unref?.();
  globalThis.__builderBarridos = setInterval(correr, minutos * 60_000);
  globalThis.__builderBarridos.unref?.();
  console.log(`[barridos] activos cada ${minutos} min (primer rescate a los 5s)`);
}
