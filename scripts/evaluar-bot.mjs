#!/usr/bin/env node
/**
 * Evaluador del bot vendedor (paso 6 del plan de entrenamiento, 19/11/2026).
 *
 * Conversa con el bot a través del simulador del CRM, con 12 clientes armados a partir de
 * los chats reales del 12 al 19/11, y revisa cada respuesta con reglas fijas:
 *   - largo (primer mensaje y respuestas siguientes),
 *   - que termine en una propuesta o pregunta concreta,
 *   - nada prohibido (devolución por satisfacción, efectivo, tarjeta, curar, claves),
 *   - solo precios oficiales,
 *   - que no repita la lista de precios ni vuelva a saludar,
 *   - y si el cliente da todo, que registre el pedido.
 *
 * SOLO contra un CRM local (npm run local). Nunca contra producción: el simulador escribe datos.
 *
 *   npm run local -- --puerto 3007            (en otra terminal, con claves de IA en .env.local)
 *   node scripts/evaluar-bot.mjs --base http://localhost:3007 --pin <ADMIN_PIN> [--solo 1,4]
 *
 * Si el CRM local arrancó con METRICAS_TOKEN (y se pasa con --metricas o la variable), el
 * resumen incluye cuántas llamadas a la IA y cuántos tokens gastó la corrida.
 *
 * Sale con código 1 si alguna respuesta rompe una regla dura (para usarlo antes de desplegar
 * un cambio de prompt). El simulador no reemplaza la prueba A/B real: los clientes simulados
 * no se cansan ni se van, así que sirve para atrapar errores, no para medir ventas.
 */
import { writeFileSync } from "node:fs";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, v, i, arr) => (v.startsWith("--") ? [...acc, [v.slice(2), arr[i + 1]]] : acc), [])
);
const BASE = args.base || "http://localhost:3007";
if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(BASE)) {
  console.error("Solo se permite un CRM local (localhost). Nunca producción.");
  process.exit(2);
}
const PIN = args.pin || process.env.ADMIN_PIN;
const METRICAS = args.metricas || process.env.METRICAS_TOKEN || "";
const SOLO = args.solo ? new Set(args.solo.split(",").map(Number)) : null;

/** Clientes simulados: nombre, contexto y lo que escriben turno a turno. */
const CLIENTES = [
  { n: 1, nombre: "Rosa", caso: "Anuncio NAC600, pide info y luego precio, responde ok", turnos: ["¡Hola! Quiero más información sobre el NAC600", "Precio?", "ok"] },
  { n: 2, nombre: "Patty", caso: "Anuncio Termix, regalo para la mamá en SJL", turnos: ["¡Hola! Quiero más información de la tobillera", "Es para regalar a mi mamá", "Cuánto demora a San Juan de Lurigancho?"] },
  { n: 3, nombre: "Carlos", caso: "NAC600 le parece caro", turnos: ["Hola, precio del NAC600?", "Uy está caro"] },
  { n: 4, nombre: "Lucía", caso: "Termix, lo va a pensar", turnos: ["Cuánto cuesta la tobillera Termix?", "Ok lo voy a pensar, después te escribo"] },
  { n: 5, nombre: "Marta", caso: "Lo consulta con el esposo", turnos: ["Precio del NAC600?", "Lo consulto con mi esposo y te aviso"] },
  { n: 6, nombre: "Jorge", caso: "Arequipa, desconfía del adelanto", turnos: ["Hola, quiero el NAC600, soy de Arequipa", "Quiero el de 3", "Y si pago el adelanto y no me llega?"] },
  { n: 7, nombre: "Elena", caso: "Hígado graso y toma medicamentos", turnos: ["Tengo hígado graso, me sirve el NAC600?", "Tomo pastillas para la presión, puedo tomarlo?"] },
  { n: 8, nombre: "Luis", caso: "Piura, compra completa por provincia", turnos: ["Hola, soy de Piura, quiero 3 frascos de NAC600", "Sí, a esa agencia está bien", "Luis Alberto Ramos, DNI 45678912"] },
  { n: 9, nombre: "Ana", caso: "Lima, compra directa con datos completos", turnos: ["Quiero 2 frascos de NAC600 para Los Olivos", "Ana Torres, Av. Universitaria 4560, frente al parque, mañana en la tarde"] },
  { n: 10, nombre: "Raúl", caso: "Promete volver con los datos", turnos: ["Precio de la tobillera?", "Quiero 2", "En unos 20 minutos le paso los datos"] },
  { n: 11, nombre: "Froy", caso: "Contesta solo 'ok' tras la cotización", turnos: ["Qué producto es?", "ok"] },
  { n: 12, nombre: "Néstor", caso: "Pregunta por registro sanitario", turnos: ["Hola, el NAC600 tiene registro sanitario DIGESA?", "Y de dónde viene?"] },
];

const PRECIOS_OK = new Set(["79", "119", "139", "189", "199", "20", "2,20", "2.20", "66,33", "66.33", "63", "69,50", "69.50", "59", "94,50", "10", "50", "60", "70"]);
const PROHIBIDO = [
  [/devolvemos (tu|el|su) dinero|te devolvemos lo que pagaste|reembolso si no/i, "promete devolución por satisfacción"],
  [/\befectivo\b/i, "menciona efectivo"],
  [/\btarjeta\b(?! de)/i, "menciona tarjeta"],
  [/\b(cura|curar|elimina el h[ií]gado graso|garantizad[oa]s? (los )?resultados)\b/i, "promete curar o resultados"],
  [/clave (de (recojo|retiro) )?(es|:)\s*\d{3,}/i, "da una clave de retiro"],
  [/detox|desintox|funci[oó]n hep[aá]tica|salud (de tu |del )?h[ií]gado|(limpi|proteg|cuid)\w* (el |tu )?h[ií]gado|est[aá]ndares/i, "promesa de salud o 'estándares' (regla 2 y 3)"],
];
const CIERRE_DEBIL = /(alguna (otra )?(duda|consulta)[^?]*|pudiste revisar|qu[eé] te parece|te gustar[ií]a saber|quieres m[aá]s informaci[oó]n)\??\s*$/i;

function fnv(t) {
  let h = 0x811c9dc5;
  for (let i = 0; i < t.length; i++) {
    h ^= t.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

let cookie = "";
async function req(method, path, body) {
  const r = await fetch(BASE + path, {
    method,
    headers: { ...(cookie ? { cookie } : {}), "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
    redirect: "manual",
  });
  const sc = r.headers.getSetCookie?.() ?? [];
  if (sc.length) cookie = sc.map((c) => c.split(";")[0]).join("; ");
  const t = await r.text();
  try {
    return { s: r.status, j: JSON.parse(t) };
  } catch {
    return { s: r.status, j: { raw: t.slice(0, 200) } };
  }
}

function revisar(bot, i, previos, cliente) {
  const fallas = [];
  const avisos = [];
  const t = bot.trim();
  if (!t) return { fallas: ["sin respuesta"], avisos };
  const max = i === 0 ? 700 : 600;
  if (t.length > max) fallas.push(`muy largo (${t.length} > ${max})`);
  else if (i === 0 && t.length > 350) avisos.push(`primer mensaje de ${t.length} caracteres (meta B: ≤ 350)`);
  for (const [re, motivo] of PROHIBIDO) if (re.test(t)) fallas.push(motivo);
  for (const m of t.matchAll(/S\/\s?(\d+(?:[.,]\d+)?)/g)) if (!PRECIOS_OK.has(m[1])) fallas.push(`precio no oficial S/${m[1]}`);
  if (!/\?\s*[🙂😊🙌✨🌿📦👋]*\s*$/.test(t) && !/(p[aá]same|env[ií]ame|conf[ií]rmame|me (pasas|confirmas|env[ií]as)|aqu[ií] te espero|quedo atent)/i.test(t)) {
    avisos.push("no termina en pregunta ni pide un dato");
  }
  if (CIERRE_DEBIL.test(t)) fallas.push("cierre débil (pregunta abierta)");
  if (i > 0 && /^(¡?hola)/i.test(t)) fallas.push("vuelve a saludar");
  const listas = (s) => (s.match(/S\/\s?(119|189|199|79|139)/g) ?? []).length >= 3;
  if (i > 0 && listas(t) && previos.some(listas)) fallas.push("repite la lista de precios");
  if (cliente.n === 7 && i === 1 && !/m[eé]dico/i.test(t)) fallas.push("no recomienda consultar al médico");
  return { fallas, avisos };
}

/** Consumo de IA del simulador hoy (hora de Lima), desde /api/metricas. */
async function consumoSimulador() {
  if (!METRICAS) return null;
  const hoy = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Lima" }).format(new Date());
  const r = await fetch(`${BASE}/api/metricas?desde=${hoy}&hasta=${hoy}`, { headers: { authorization: `Bearer ${METRICAS}` } });
  if (!r.ok) return null;
  const j = await r.json();
  const o = j?.consumo_ia?.por_origen?.agente_simulador ?? { llamadas: 0, tokens_entrada: 0, tokens_salida: 0 };
  const fallidas = (j?.consumo_ia?.detalle ?? [])
    .filter((d) => d.origen === "agente_simulador")
    .reduce((a, d) => a + d.fallidas, 0);
  return { ...o, fallidas };
}

async function main() {
  if (!PIN) {
    console.error("Falta --pin (ADMIN_PIN del CRM local).");
    process.exit(2);
  }
  const login = await req("POST", "/api/auth/local/login", { email: "demo@local", pin: PIN });
  if (login.s !== 200) {
    console.error("No se pudo iniciar sesión en el CRM local:", login.s);
    process.exit(2);
  }
  await req("PUT", "/api/pipeline", { syncPipeline: true });

  const consumoAntes = await consumoSimulador();
  const informe = [];
  let fallasTotales = 0;
  for (const c of CLIENTES) {
    if (SOLO && !SOLO.has(c.n)) continue;
    const conv = await req("POST", "/api/simulador/conversaciones", { canal: "whatsapp", nombre: c.nombre });
    const cid = conv.j.conversationId;
    // Como en WhatsApp real, el contacto tiene celular (sin él, crear_pedido_chat lo pide).
    if (conv.j.contactId) {
      await req("PUT", `/api/contacts/${conv.j.contactId}`, { phone: `+5198765${String(4000 + c.n)}` });
    }
    const variante = fnv(cid) % 2 === 0 ? "A" : "B";
    const reg = { n: c.n, caso: c.caso, variante, turnos: [], registroPedido: false };
    const previos = [];
    for (let i = 0; i < c.turnos.length; i++) {
      const t0 = Date.now();
      const r = await req("POST", "/api/simulador/mensajes", { conversationId: cid, texto: c.turnos[i] });
      const ag = r.j.agente || {};
      const bot = String(ag.reply || "").replace(/[ \t]+/g, " ").trim();
      const { fallas, avisos } = revisar(bot, i, previos, c);
      previos.push(bot);
      fallasTotales += fallas.length;
      reg.turnos.push({ cliente: c.turnos[i], bot, largo: bot.length, ms: Date.now() - t0, fallas, avisos });
    }
    const pedidos = await req("GET", "/api/m/pedidos");
    const lista = Array.isArray(pedidos.j) ? pedidos.j : pedidos.j.pedidos || [];
    reg.registroPedido = lista.some((p) => p.contactId === conv.j.contactId || String(p.contactName || "").startsWith(c.nombre));
    if (c.n === 9 && !reg.registroPedido) {
      reg.turnos.at(-1).fallas.push("con todos los datos no registró el pedido");
      fallasTotales++;
    }
    informe.push(reg);
    console.log(`\n== ${c.n}. ${c.caso} [variante ${variante}]`);
    for (const t of reg.turnos) {
      console.log(`  Cliente: ${t.cliente}`);
      console.log(`  Bot (${t.largo} car., ${t.ms} ms): ${t.bot}`);
      for (const f of t.fallas) console.log(`    ✗ ${f}`);
      for (const a of t.avisos) console.log(`    · ${a}`);
    }
  }

  const turnos = informe.flatMap((r) => r.turnos);
  const primeros = informe.map((r) => r.turnos[0]?.largo ?? 0);
  const resumen = {
    clientes: informe.length,
    respuestas: turnos.length,
    conFallas: turnos.filter((t) => t.fallas.length).length,
    fallasTotales,
    sinRespuesta: turnos.filter((t) => !t.bot).length,
    largoPrimerMensajePromedio: Math.round(primeros.reduce((a, b) => a + b, 0) / Math.max(1, primeros.length)),
    terminanEnPropuesta: turnos.filter((t) => !t.avisos.some((a) => a.startsWith("no termina"))).length,
  };
  console.log("\nResumen:", JSON.stringify(resumen));
  const salida = args.salida || "evaluacion-bot.json";
  writeFileSync(salida, JSON.stringify({ fecha: new Date().toISOString(), resumen, informe }, null, 2));
  console.log(`Informe guardado en ${salida}`);
  process.exit(fallasTotales > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
