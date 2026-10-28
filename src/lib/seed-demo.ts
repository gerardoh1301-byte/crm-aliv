import "server-only";
import { db } from "@/db";
import {
  activities,
  contacts,
  conversations,
  deals,
  messages,
  pipelineStages,
  pipelines,
  teamMembers,
} from "@/db/schema";
import { asc, eq, sql } from "drizzle-orm";
import { camposContacto } from "@/lib/config";
import { setDealStage } from "@/lib/deals/stage";
import { ingestMessage, linkExtraIdentity, upsertConversation } from "@/lib/channels/ingest";
import { resolveDefaultTenantId } from "@/lib/tenants";
import { modulosActivos } from "@/lib/modules";
import { sincronizarConGoogleDrive } from "@/lib/drive-sync";
import type { CampoConfig } from "@/lib/config/schema";
import type { ValoresCampos } from "@/lib/config/campos";

/**
 * Datos de demostracion para Aliv Store (E-commerce Peru COD).
 *
 * Idempotente: los contactos llevan la etiqueta `demo`; si ya hay alguno, el nucleo no
 * vuelve a sembrar. Despues corre el `seed()` de cada modulo activo (cada uno decide
 * si ya tiene datos).
 *
 * Las conversaciones usan el conector `simulador`: en una demo se les puede responder
 * desde la bandeja y el agente contesta, sin que nada salga a un canal real. No se
 * excluyen de Reportes (solo se excluyen los contactos creados desde /simulador).
 *
 * Los campos personalizados se completan segun config/cliente.ts: la misma demo sirve
 * para cualquier plantilla.
 */

const PERSONAS = [
  { name: "Valeria Mendoza", email: "valeria.mendoza@ejemplo.pe", phone: "+51 987 100 001", company: null, source: "whatsapp" },
  { name: "Carlos Quispe", email: "carlos.quispe@ejemplo.pe", phone: "+51 987 100 002", company: null, source: "instagram" },
  { name: "Luciana Vargas", email: "luciana.vargas@ejemplo.pe", phone: "+51 987 100 003", company: null, source: "website" },
  { name: "Jorge Huaman", email: "jorge.huaman@ejemplo.pe", phone: "+51 987 100 004", company: null, source: "whatsapp" },
  { name: "Patricia Rojas", email: "patricia.rojas@ejemplo.pe", phone: "+51 987 100 005", company: null, source: "facebook" },
  { name: "Rodrigo Paredes", email: "rodrigo.paredes@ejemplo.pe", phone: "+51 987 100 006", company: null, source: "whatsapp" },
  { name: "Milagros Chavez", email: "milagros.chavez@ejemplo.pe", phone: "+51 987 100 007", company: null, source: "website" },
  { name: "Diego Salazar", email: "diego.salazar@ejemplo.pe", phone: "+51 987 100 008", company: null, source: "whatsapp" },
  { name: "Fiorella Castro", email: "fiorella.castro@ejemplo.pe", phone: "+51 987 100 009", company: null, source: "instagram" },
  { name: "Renzo Flores", email: "renzo.flores@ejemplo.pe", phone: "+51 987 100 010", company: null, source: "referido" },
  { name: "Andrea Espinoza", email: "andrea.espinoza@ejemplo.pe", phone: "+51 987 100 011", company: null, source: "website" },
  { name: "Fernando Gutierrez", email: "fernando.gutierrez@ejemplo.pe", phone: "+51 987 100 012", company: null, source: "whatsapp" },
];

const ZONAS = ["Miraflores", "Santiago de Surco", "San Borja", "San Isidro", "La Molina", "Arequipa", "Trujillo", "Cusco"];
const PRODUCTOS_DEMO = [
  "Nuvara Almohada Cervical",
  "NAC600 + NAD+",
  "Termix Tobillera",
  "Termix Hombrera Térmica",
  "Meno Mag",
  "Herbia Roll-On Migraña",
  "GODA for Her",
];

/** Valor plausible para cada campo segun su tipo (misma demo para cualquier plantilla). */
function valorDemo(campo: CampoConfig, i: number): ValoresCampos[string] {
  switch (campo.tipo) {
    case "seleccion":
      return campo.opciones?.[i % (campo.opciones.length || 1)] ?? null;
    case "numero": {
      const esMonto = /presupuesto|precio|monto|valor|importe|total/i.test(campo.clave + campo.etiqueta);
      return esMonto ? [99, 119, 149, 198, 248, 99][i % 6] : (i % 4) + 1;
    }
    case "booleano":
      return i % 2 === 0;
    case "fecha":
      return new Date(Date.now() + ((i % 10) + 1) * 86_400_000).toISOString().slice(0, 10);
    default:
      if (campo.clave.includes("producto")) return PRODUCTOS_DEMO[i % PRODUCTOS_DEMO.length];
      if (campo.clave.includes("dni")) return String(42000000 + i * 135791);
      if (campo.clave.includes("direccion")) return `Av. Principal ${120 + i * 30}, ${ZONAS[i % ZONAS.length]}`;
      if (campo.clave.includes("ciudad")) return i < 5 ? "Lima" : ZONAS[i % ZONAS.length];
      return ZONAS[i % ZONAS.length];
  }
}

const GUIONES: Array<Array<{ dir: "in" | "out"; origen?: "agent" | "human"; body: string }>> = [
  [
    { dir: "in", body: "Hola! Vi la almohada cervical Nuvara en su web alivstore.shop, cuanto esta y hacen pago contraentrega en Lima?" },
    { dir: "out", origen: "agent", body: "¡Hola Valeria! Sí, la almohada cervical Nuvara (con calor, vibración y tracción) está en promoción a S/ 149.00 (antes S/ 199.00) y contamos con Pago Contraentrega en Lima Metropolitana (efectivo, Yape o Plin al recibir). ¿En qué distrito te encuentras?" },
    { dir: "in", body: "Estoy en Miraflores, Av. Jose Pardo 620 Dpto 502. Quiero pedir una." },
    { dir: "out", origen: "agent", body: "¡Excelente! Ya registré tu pedido #ALIV-1001 por S/ 149.00 con pago contraentrega para Miraflores. Nuestro motorizado te contactará antes de llegar." },
    { dir: "in", body: "Genial, muchas gracias!" },
  ],
  [
    { dir: "in", body: "Buenas tardes, tienen envios a Arequipa del suplemento NAC600 + NAD+?" },
    { dir: "out", origen: "agent", body: "¡Hola Carlos! Sí, enviamos a todo el Perú por agencia Shalom u Olva Courier. El frasco de NAC600 + NAD+ (60 cápsulas en aceite de coco y MCT) está a S/ 119.00. ¿Te gustaría recibirlo en agencia Shalom o en tu domicilio?" },
    { dir: "in", body: "En Shalom de Av. Parra en Arequipa por favor, y agregame un roll-on Herbia para la migrana." },
    { dir: "out", origen: "agent", body: "Perfecto, el NAC600 (S/ 119.00) + Herbia Roll-On (S/ 30.00) suman S/ 149.00 en total. Tu pedido #ALIV-1002 ya fue despachado por Shalom con guía SH-9048127." },
  ],
  [
    { dir: "in", body: "Hola, me duele mucho el tobillo despues de correr, como funciona la Termix Tobillera?" },
    { dir: "out", origen: "agent", body: "¡Hola Luciana! La Termix Tobillera es inalámbrica y combina placas térmicas de grafeno (que calientan en segundos) con doble motor de masaje por vibración. Es talla universal y está a S/ 99.00 con pago contraentrega. ¿Para qué distrito o ciudad la necesitarías?" },
    { dir: "in", body: "Para Surco, por Chacarilla. Puedo pagar con Yape al recibir?" },
  ],
  [
    { dir: "in", body: "Hola, hice un pedido de la Hombrera Termix en la web para Trujillo, queria confirmar si llega por Olva." },
    { dir: "out", origen: "agent", body: "¡Hola Jorge! Sí, vemos tu pedido #ALIV-1004 de la Hombrera Térmica Termix (S/ 99.00) para Trujillo. ¿Confirmas el envío a la oficina de Olva Courier de Av. Larco?" },
    { dir: "in", body: "Si por favor, con mi DNI 73910284." },
    { dir: "out", origen: "agent", body: "¡Listo Jorge! Ya quedó anotado tu DNI y confirmado para despacho por Olva Courier. Te enviaremos el número de tracking apenas salga." },
  ],
  [
    { dir: "in", body: "Hola, necesito hablar con un asesor sobre una garantia o cambio de direccion de mi pedido." },
    { dir: "out", origen: "agent", body: "Te comunico con un especialista de nuestro equipo de Aliv Store para ayudarte personalmente con tu caso. En unos minutos te responde por aquí." },
    { dir: "out", origen: "human", body: "Hola Patricia, te saluda el equipo de soporte de Aliv Store. Indícame la nueva dirección o consulta para actualizar tu envío de inmediato." },
  ],
  [
    { dir: "in", body: "Hola! Tienen stock de Meno Mag y el perfume GODA?" },
    { dir: "out", origen: "agent", body: "¡Hola Rodrigo! Sí tenemos stock disponible de ambos: Meno Mag está en oferta a S/ 99.00 (antes S/ 159.00) y GODA for Her a S/ 99.00. ¿Deseas que te armemos el pedido con pago contraentrega?" },
    { dir: "in", body: "Si, quiero 2 de Meno Mag para San Borja." },
  ],
];

export interface ResultadoSeed {
  yaExistia: boolean;
  contactos: number;
  operaciones: number;
  conversaciones: number;
  mensajes: number;
  modulos: string[];
}

export async function cargarDatosDemo(): Promise<ResultadoSeed> {
  const resultado: ResultadoSeed = { yaExistia: false, contactos: 0, operaciones: 0, conversaciones: 0, mensajes: 0, modulos: [] };

  const [existente] = await db
    .select({ id: contacts.id })
    .from(contacts)
    .where(sql`'demo' = any(${contacts.tags})`)
    .limit(1);

  if (existente) {
    resultado.yaExistia = true;
  } else {
    await sembrarNucleo(resultado);
  }

  for (const m of modulosActivos()) {
    if (!m.seed) continue;
    await m.seed();
    resultado.modulos.push(m.manifiesto.nombre);
  }

  await sincronizarConGoogleDrive().catch(() => {});

  return resultado;
}

async function sembrarNucleo(r: ResultadoSeed) {
  const tenantId = await resolveDefaultTenantId();
  const [admin] = await db.select({ id: teamMembers.id }).from(teamMembers).orderBy(asc(teamMembers.createdAt)).limit(1);
  const campos = camposContacto();
  const ahora = Date.now();
  const dia = 86_400_000;

  // Contactos repartidos en los ultimos 40 dias, con campos de la plantilla.
  const creados: Array<{ id: string; name: string; source: string }> = [];
  for (let i = 0; i < PERSONAS.length; i++) {
    const p = PERSONAS[i];
    const valores: ValoresCampos = {};
    for (const c of campos) valores[c.clave] = valorDemo(c, i);
    const createdAt = new Date(ahora - (i * 3 + 1) * dia);
    const [row] = await db
      .insert(contacts)
      .values({
        name: p.name,
        email: p.email,
        phone: p.phone,
        company: p.company,
        source: p.source,
        score: 40 + ((i * 17) % 55),
        tags: ["demo", ...(i % 3 === 0 ? ["prioridad"] : [])],
        customFields: valores,
        ownerId: admin?.id ?? null,
        assignedAt: admin ? createdAt : null,
        tenantId,
        createdAt,
        updatedAt: createdAt,
      })
      .returning({ id: contacts.id, name: contacts.name, source: contacts.source });
    creados.push(row);
  }
  r.contactos = creados.length;

  // Operaciones repartidas por etapa del pipeline por defecto.
  const [pipeline] = await db.select().from(pipelines).where(eq(pipelines.isDefault, true)).limit(1);
  if (pipeline) {
    const stages = await db.select().from(pipelineStages).where(eq(pipelineStages.pipelineId, pipeline.id)).orderBy(asc(pipelineStages.order));
    if (stages.length > 0) {
      const valores = [149, 149, 99, 99, 198, 119, 99, 129, 248];
      for (let i = 0; i < Math.min(9, creados.length); i++) {
        const stage = stages[(i * 2) % stages.length];
        const [deal] = await db
          .insert(deals)
          .values({
            title: `${creados[i].name} · ${PRODUCTOS_DEMO[i % PRODUCTOS_DEMO.length]}`,
            value: valores[i % valores.length],
            stageId: stage.id,
            contactId: creados[i].id,
            probability: stage.isWon ? 100 : stage.isLost ? 0 : 30 + ((i * 13) % 60),
            createdAt: new Date(ahora - (i * 3) * dia),
            updatedAt: new Date(ahora - i * dia),
          })
          .returning({ id: deals.id });
        await setDealStage({ dealId: deal.id, stageId: stage.id, justCreated: true });
        r.operaciones++;
      }
    }
  }

  // Actividades.
  const notas = [
    "Confirmó dirección en Lima para entrega con motorizado contraentrega.",
    "Solicitó envío por agencia Shalom con pago al recoger.",
    "Consultó modo de uso de Termix y beneficios de NAC600.",
    "Coordinando entrega para horario de la tarde.",
  ];
  for (let i = 0; i < Math.min(8, creados.length); i++) {
    await db.insert(activities).values({
      type: (["call", "email", "note", "meeting"] as const)[i % 4],
      description: notas[i % notas.length],
      contactId: creados[i].id,
      scheduledAt: i % 4 === 3 ? new Date(ahora + (i + 2) * dia) : null,
      completedAt: i % 4 === 3 ? null : new Date(ahora - i * dia),
      createdAt: new Date(ahora - (i + 1) * dia),
    });
  }

  // Conversaciones por el simulador: se pueden responder y el agente contesta.
  const canales = ["whatsapp", "instagram", "whatsapp", "facebook", "whatsapp", "instagram"] as const;
  for (let i = 0; i < GUIONES.length && i < creados.length; i++) {
    const contacto = creados[i];
    const canal = canales[i];
    const externalId = `demo:${contacto.id}`;
    await linkExtraIdentity(contacto.id, canal, externalId, null);
    const conv = await upsertConversation({
      tenantId: tenantId ?? "",
      contactId: contacto.id,
      accountId: null,
      channel: canal,
      provider: "simulador",
      externalId,
      participantId: externalId,
      participantName: contacto.name,
      participantHandle: canal === "instagram" ? contacto.name.toLowerCase().replace(/\s+/g, ".") : null,
      participantPicture: null,
    });
    r.conversaciones++;

    const base = ahora - (i + 1) * dia;
    const guion = GUIONES[i];
    for (let k = 0; k < guion.length; k++) {
      const m = guion[k];
      const sentAt = new Date(base + k * 7 * 60_000);
      if (m.dir === "in") {
        await ingestMessage({ conversation: conv, direction: "in", externalId: `demo:${contacto.id}:${k}`, body: m.body, sentAt, enqueueAgent: false });
      } else {
        await db.insert(messages).values({
          contactId: contacto.id,
          conversationId: conv.id,
          channel: canal,
          provider: "simulador",
          direction: "out",
          origin: m.origen ?? "human",
          type: "text",
          body: m.body,
          externalId: `demo:${contacto.id}:${k}`,
          status: "sent",
          tenantId,
          sentAt,
          createdAt: sentAt,
        });
      }
      r.mensajes++;
    }
    const ultimo = guion[guion.length - 1];
    const ultimoAt = new Date(base + (guion.length - 1) * 7 * 60_000);
    await db
      .update(contacts)
      .set({ updatedAt: ultimoAt })
      .where(eq(contacts.id, contacto.id));
    const idxUltimoEntrante = guion
      .map((g, idx) => (g.dir === "in" ? idx : -1))
      .filter((x) => x >= 0)
      .pop()!;
    await db
      .update(conversations)
      .set({
        lastMessageAt: ultimoAt,
        lastMessageBody: ultimo.body,
        lastDirection: ultimo.dir,
        unreadCount: ultimo.dir === "in" ? 1 : 0,
        lastInboundAt: new Date(base + idxUltimoEntrante * 7 * 60_000),
      })
      .where(eq(conversations.id, conv.id));
  }

  // Un hilo derivado a humano, para que la bandeja muestre el estado.
  if (creados[4]) {
    await db.execute(sql`
      update conversations set ai_enabled = false, needs_human = true,
        needs_human_reason = 'solicito cambio de direccion / soporte post-venta', needs_human_at = now()
      where contact_id = ${creados[4].id}`);
  }
}
