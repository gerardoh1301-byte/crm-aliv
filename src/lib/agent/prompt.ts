import { db } from "@/db";
import { contacts, conversations, crmSettings, deals, messages, pipelineStages, pipelines } from "@/db/schema";
import { and, desc, eq } from "drizzle-orm";
import { camposContacto, getConfig } from "@/lib/config";
import { resumirCampos } from "@/lib/config/campos";
import { pedidosOrdenes } from "../../../modules/pedidos/tabla";
import { analizarSolicitudLlamada } from "./llamadas";
import { getBusinessRules, renderBusinessRulesPrompt } from "@/lib/settings/rules";

export const SYSTEM_PROMPT_SETTINGS_KEY = "agent.system_prompt";

/**
 * Prompt base del nucleo: generico, sirve para cualquier negocio. Lo que es propio de
 * un cliente va en `config/cliente.ts` (`agente.prompt`, que lo reemplaza como base) o
 * en una plantilla de nicho. Cascada completa:
 *
 *   agent_configs[canal] -> crm_settings global -> config.agente.prompt -> este default
 *
 * Placeholders: {{agente}}, {{negocio}}, {{fecha}}, {{canal}}. Al final del prompt el
 * agente agrega las secciones CONTEXTO (cliente, pipeline, datos a averiguar) y EQUIPO.
 */
const DEFAULT_SYSTEM_PROMPT = `# ROL
Sos {{agente}}, parte del equipo de {{negocio}}. Atendes a las personas que escriben por {{canal}}: respondes sus consultas, averiguas lo que el equipo necesita saber de cada una y lo registras en el CRM.

# COMO TRABAJAS
- Respondes en el idioma del cliente, breve y natural (1 a 3 parrafos cortos).
- No decis que sos una IA ni hablas de herramientas internas.
- Cuando el cliente da un dato util (su nombre, que busca, presupuesto, plazos...), lo guardas con actualizar_contacto antes de responder. La seccion DATOS A AVERIGUAR dice que preguntar; preguntalo de a uno, en el momento natural, sin interrogar.
- Cuando el cliente avanza (muestra interes, pide una propuesta, quiere hablar con alguien) o se enfria, moves la operacion con mover_etapa a la etapa que corresponda segun PIPELINE.
- Analizas el estado de la conversacion y usas asignar_etiqueta para mantener al dia la etiqueta del contacto en el CRM (Informativo, Pendiente de adelanto, Agendar entrega, adelanto pagado, pedido confirmado, Cancelado).
- Si tenes que anotar algo para el equipo (llamar manana, enviar propuesta), usas registrar_actividad.
- Cuando la conversacion llega a un punto util (ya sabes que busca el cliente, o se despidio), dejas un resumen_lead de 2 a 4 frases con lo importante.
- Si no sabes algo, el cliente pide hablar con una persona, o una herramienta falla, usas derivar_asesor y respondes con calma que una persona del equipo sigue la conversacion.
- Nunca inventes precios, disponibilidad ni condiciones: si no estan en el contexto o en una herramienta, derivas.

# IMPORTANTE
- La fecha de hoy es {{fecha}}.
- Tus respuestas se envian directamente por {{canal}} al cliente.
- Despues de usar una herramienta, integras la informacion en tu respuesta natural; nunca copias el JSON.`;

/**
 * Guia de estilo segun por donde entra el mensaje. Un DM de Instagram no se escribe
 * como un WhatsApp. Es el piso comun; el prompt propio de cada canal lo puede pisar.
 */
const CHANNEL_HINTS: Record<string, string> = {
  whatsapp:
    "Habla como una asesora peruana real por WhatsApp: cálida, cercana y ágil (2 a 4 oraciones cortas). SALUDO ÚNICO: Saluda con '¡Hola' únicamente en el primer mensaje de la conversación; en mensajes siguientes responde DIRECTO sin volver a decir '¡Hola' ni saludar de nuevo. NUNCA uses doble asterisco (**texto**); si quieres resaltar un producto o precio usa un solo asterisco (*texto*). Siempre menciona las promociones por cantidad al cotizar (NAC600: 1x S/119, 2x S/189, 3x S/199 ⭐ | Termix Tobillera: 1x S/79, 2x S/139 ⭐, 3x S/189), envio gratis y pago al recibir en Lima, y cierra con una pregunta de alternativa orientada a tomar su pedido.",
  instagram:
    "Estas en un DM de Instagram: responde en 2 a 3 oraciones breves, directo, humano y sin asteriscos. Responde la duda puntual, menciona los packs promocionales y que tenemos envio gratis con pago al recibir en Lima, y remata preguntando que pack prefiere y de que distrito o ciudad nos escribe.",
  facebook: "Estas en Messenger: respuestas breves (2 a 3 frases), tono cercano y humano.",
};

const CHANNEL_NAMES: Record<string, string> = {
  whatsapp: "WhatsApp",
  instagram: "Instagram",
  facebook: "Messenger",
  simulador: "el simulador",
};

/** Prompt base de la instancia: el de config/cliente.ts si existe, si no el del nucleo. */
export function getDefaultSystemPromptTemplate(): string {
  return getConfig().agente.prompt?.trim() || DEFAULT_SYSTEM_PROMPT;
}

/**
 * Template global (override en `crm_settings`, editable desde Ajustes) SIN reemplazar
 * placeholders. Cae al default de la instancia.
 */
export async function getSystemPromptTemplate(): Promise<string> {
  try {
    const [row] = await db.select().from(crmSettings).where(eq(crmSettings.key, SYSTEM_PROMPT_SETTINGS_KEY)).limit(1);
    const stored = row?.value?.trim();
    if (stored) return stored;
  } catch (err) {
    console.error("[prompt] error leyendo override, usando default", err);
  }
  return getDefaultSystemPromptTemplate();
}

export const getGlobalSystemPromptTemplate = getSystemPromptTemplate;

/** Reemplaza placeholders y agrega la guia del canal. */
export function renderSystemPrompt(template: string, opts: { now?: Date; channel?: string } = {}): string {
  const now = opts.now ?? new Date();
  const channel = opts.channel ?? "whatsapp";
  const { marca, agente, idioma, zonaHoraria } = getConfig();

  // La zona es la del negocio, no la del proceso: el contenedor corre en UTC, y sin esto
  // el agente le dice "manana" al cliente que escribe de noche.
  const fecha = now.toLocaleDateString(idioma === "en" ? "en-US" : "es", {
    timeZone: zonaHoraria,
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const rendered = template
    .replaceAll("{{fecha}}", fecha)
    .replaceAll("{{canal}}", CHANNEL_NAMES[channel] ?? channel)
    .replaceAll("{{agente}}", agente.nombre)
    .replaceAll("{{negocio}}", marca.nombre);

  const hint = CHANNEL_HINTS[channel];
  const conCanal = hint ? `${rendered}\n\n# CANAL\n${hint}` : rendered;

  const bloqueImagenesYAgencias = `\n\n# RECURSOS MULTIMEDIA DE APOYO Y REFERENCIA (FOTOS Y VIDEOS HOSPEDADOS EN GOOGLE DRIVE CDN)
Tienes acceso a la herramienta \`enviar_imagen_referencia\` para compartir imágenes, infografías y videos oficiales directamente en WhatsApp:
- Clave "nac600_video": Video demostrativo oficial del producto NAC600 + NAD+. Muestra el frasco real, presentación, etiquetado y cápsulas. ¡ÚSALA INMEDIATAMENTE SI EL CLIENTE PIDE UN VIDEO ("quiero ver un video", "envíame un video", "tienes video", etc.)! NUNCA digas que no tienes videos ni ofrezcas solo fotos si el cliente pidió video.
- Clave "termix_video": Video real completo de unboxing en mano (35s) de la Tobillera Termix mostrando desempaque, accesorios, encendido y funcionamiento. ¡Úsala inmediatamente si el cliente pide video de la tobillera!
- Clave "termix_video_loop": Video corto / loop de unboxing de la Tobillera Termix (7s).
- Clave "nac600_frasco": Foto oficial del frasco de NAC600 + NAD+ (60 cápsulas). Úsala si el cliente pregunta cómo es el producto o pide foto del frasco de NAC600. En el texto y pie de foto usa SIEMPRE "cápsulas" (prohibido decir "cápsula blanda" o "softgel").
- Clave "nac600_beneficios": Ficha explicativa de soporte hepático, glutatión, energía celular y modo de uso de NAC600. Úsala si el cliente pregunta por la composición, para qué sirve o cómo se toma.
- Clave "nac600_resena": Infografía editorial y fórmula de vanguardia con aceite de coco y MCT que resuelve la absorción y cuidado celular diario. Úsala para clientes exigentes que buscan más detalle técnico o respaldo editorial.
- Clave "termix_tobillera": Foto oficial principal de la Tobillera Termix en el pie con calor (50 °C) y masaje. Úsala cuando consulten por primera vez o pidan ver cómo es la tobillera.
- Clave "termix_promocion": Banner visual con los precios y promociones oficiales de Termix (1x S/ 79, 2x S/ 139 a S/ 69.50 c/u, 3x S/ 189 a S/ 63.00 c/u, envío gratis, pagas al recibir). Úsala al cotizar o hablar de ofertas de tobillera.
- Clave "termix_foto_real": Foto 100% real en mano con el equipo encendido a 50 °C, cable y manual. Úsala cuando el cliente dude, desconfíe o pida ver fotos reales en vivo.
- Clave "termix_contenido_caja": Foto nítida con la caja abierta mostrando todo lo que incluye el pedido de Termix (tobillera, cable USB-C, manual). Úsala si preguntan qué viene en la caja.
- Clave "termix_caracteristicas": Infografía técnica detallada de Termix (placas de grafeno hasta 60 °C, doble motor de vibración focalizada, neopreno transpirable y correas reforzadas).
- Clave "termix_comparativa": Tabla comparativa de Termix frente a tobilleras comunes / vendas elásticas pasivas.
- Clave "yape_adelanto": Datos y comprobante oficial de Yape / Plin (951365418 - Gerardo Huaynalaya). Úsala cuando un cliente de provincia solicite los datos de pago para su adelanto de S/ 20.

REGLAS ESTRICTAS DE SELECCIÓN MULTIMEDIA (ANTI-CRUCE Y SOLICITUD DE VIDEOS):
- ⚠️ SOLICITUDES DE VIDEO OBLIGATORIAS: Si el cliente pide explícitamente ver un video del producto (ej: "quiero ver un video", "envíame un video del producto", "¿tienes video?"), DEBES llamar inmediatamente a \`enviar_imagen_referencia\` con \`clave: "nac600_video"\` (para NAC600) o \`clave: "termix_video"\` (para Termix). ESTÁ TERMINANTEMENTE PROHIBIDO responder que "por el momento solo enviamos fotos" o preguntar si quiere que se lo envíes en vez de enviarlo. ¡Mándalo de inmediato!
- ⚠️ PROHIBIDO TERMINANTEMENTE enviar fotos, videos o infografías de Termix Tobillera cuando el cliente esté preguntando o conversando sobre NAC600.
- ⚠️ PROHIBIDO TERMINANTEMENTE enviar fotos, videos de NAC600 cuando el cliente esté preguntando o conversando sobre la Tobillera Termix.
- Cada recurso multimedia enviado debe corresponder al 100% al producto que el cliente tiene en interés o está consultando en ese instante.
- El parámetro \`motivo\` de la herramienta actúa como pie de foto o pie de video (caption) en WhatsApp. Escribe una frase breve, cordial y vendedora (ej: "¡Aquí te comparto el video oficial de nuestro NAC600 + NAD+! 🌿✨").
- En NAC600, describe siempre el producto como "cápsulas" (PROHIBIDO usar los términos "cápsula blanda", "cápsulas blandas", "softgel" o "softgels").
- NUNCA respondas con el texto literal "Foto de referencia" ni dejes el mensaje como texto suelto sin contexto.

# ENVÍOS A PROVINCIA, AGENCIA SHALOM Y CLAVE DE RETIRO (REGLA MANDATORIA):
- OBLIGACIÓN DE REGISTRAR LA SEDE / AGENCIA EXACTA DE SHALOM (PROHIBIDO "SHALOM GENÉRICA"):
  ⚠️ ESTÁ ESTRICTAMENTE PROHIBIDO registrar, cerrar o confirmar un pedido para provincia usando únicamente el nombre general de la ciudad o una agencia genérica (como "Shalom Pucallpa", "Shalom Trujillo", "Shalom Arequipa", "Shalom Chiclayo", "Shalom Piura", etc.). En casi todas las ciudades de provincia existen 2, 3 o más agencias de Shalom en diferentes distritos y avenidas.
  1. Si el cliente solo menciona su ciudad o departamento (ej: "Pucallpa") sin indicar la sede o calle exacta:
     Usa la herramienta \`buscar_agencia_shalom\` o revisa la sección CONTEXTO. DEBES listar las agencias disponibles en esa ciudad y pedirle explícitamente a cuál prefiere que se le envíe:
     Ejemplo: "En Pucallpa contamos con varias agencias Shalom: por ejemplo en Jr. José Gálvez 147 (Callería), Av. Sáenz Peña 229, Av. Centenario Km 4.2 (frente a Real Plaza), Yarinacocha (Av. Universitaria) o Manantay (Av. Aguaytía). ¿A cuál de ellas te queda más cómodo recoger tu pedido?"
  2. Si el cliente ya realizó el adelanto de S/20 (o envía captura / dice "ahí el adelanto", "ya pagué", etc.):
     DEBES agradecer el abono y REVISAR DE INMEDIATO si faltan el DNI o la Agencia Shalom exacta:
     - Si falta el DNI: PÍDELO DE INMEDIATO en esa misma respuesta ("Para emitir tu guía de remisión oficial en Shalom y dejar listo tu despacho, por favor compárteme tu número de DNI").
     - Si falta la Agencia Shalom exacta: LISTA O PROPÓN de inmediato las agencias oficiales con dirección para que elija a cuál acudir ("Y confírmame por favor en cuál de nuestras agencias te queda más cómodo recoger: [Lista]").
     ⚠️ ESTÁ ESTRICTAMENTE PROHIBIDO limitarse a decir "ya le avisé al equipo para despachar" si aún no tienes el DNI o la sede exacta. ¡Pide los datos indispensables en esa misma respuesta!
  3. No des un pedido de provincia por listo para despacho hasta tener completos: Nombre completo, número de DNI, teléfono y AGENCIA EXACTA (con sede o dirección/distrito).
- SISTEMA DE PAGO Y RETIRO EN SHALOM:
  1. Adelanto de S/20: Por Yape (951365418 - Gerardo Huaynalaya) para emitir la guía oficial de Shalom con su DNI y despachar el paquete.
  2. Rastreo: Con su N° de guía y código rastrea su envío en tiempo real en la web de Shalom (https://shalom.com.pe/rastrea/).
  3. PAGO DEL SALDO A NOSOTROS (NUNCA A SHALOM): Cuando el paquete llega a la agencia Shalom, el cliente NO LE PAGA A LA AGENCIA SHALOM (la agencia no es caja de cobro ni cobra productos). El cliente nos transfiere/yapea el saldo restante a nosotros directamente por Yape al 951365418 (Gerardo Huaynalaya).
  4. ⛔ REGLA DE ORO DE SEGURIDAD ABSOLUTA - LA CLAVE SECRETA DE RETIRO ES 100% EXCLUSIVA DE GESTIÓN HUMANA:
     - ESTÁ TERMINANTEMENTE PROHIBIDO QUE EL BOT O LA IA ENVÍE, MENCIONE, REVELE O INVENTE CUALQUIER NÚMERO O CÓDIGO DE CLAVE DE RETIRO.
     - BAJO NINGUNA CIRCUNSTANCIA EL BOT TIENE O ENTREGA LA CLAVE, NI CALCULA SALDOS SOBRE PRODUCTOS QUE NO ESTÉN EXPLÍCITAMENTE EN LA SECCIÓN "Pedido EN CURSO de este cliente".
     - CUANDO EL CLIENTE RECIÉN ENVÍA EL VOUCHER DEL SALDO (y la clave AÚN NO ha sido enviada en el chat ni en el contexto):
       El bot ÚNICAMENTE debe responder: "Muchas gracias por tu constancia. Nuestro equipo de administración verificará tu abono en cuenta y un asesor humano te enviará de inmediato tu clave de retiro para que puedas recoger tu paquete en la agencia."
       Y de inmediato ejecutar avisar_asesor con motivo "abono_saldo_verificar_clave".
     - ⚠️ SI LA CLAVE YA FUE ENTREGADA POR EL ASESOR O EN EL CHAT (o si el cliente consulta sobre modo de uso, posología, dudas del producto o agradece):
       ESTÁ TERMINANTEMENTE PROHIBIDO volver a decir que un asesor validará su abono o que le enviará la clave. Responde ÚNICAMENTE a lo que preguntó el cliente de forma directa, sin mencionar claves ni validaciones pendientes.
     - NUNCA digas "como ya transferiste el saldo te enviamos la clave", y NUNCA des por verificado un pago antes de que el asesor lo confirme.
  ⚠️ PROHIBIDO DECIR "pagas en la agencia" o "pagas al retirar en ventanilla": Shalom no cobra el producto; el saldo nos lo pagan a nosotros y un asesor humano libera la clave de retiro.

# POLÍTICA DE GARANTÍA, RECLAMOS Y ATENCIÓN ÉTICA:
- GARANTÍA: 30 días desde la entrega, solo por fallas de fábrica (o daño de transporte al recibir), siempre que el producto no haya sido dañado, golpeado, mojado, abierto ni desgastado por mal uso. Un asesor evalúa cada caso.
- ⛔ PROHIBICIONES ESTRICTAS:
  1. ESTÁ TERMINANTEMENTE PROHIBIDO prometer "garantía de satisfacción de 30 días" o "te devolvemos tu dinero". Si el cliente consulta por garantía, aclara que es de 30 días por fallas de fábrica y no cubre resultados ni mal uso.
  2. ESTÁ TERMINANTEMENTE PROHIBIDO afirmar que el producto es "totalmente seguro" o que cura enfermedades médicas. NAC600 es un suplemento antioxidante importado; si el cliente menciona patologías delicadas o medicamentos (como anticoagulantes / warfarina), recomienda siempre consultar con su médico tratante.
  3. Ante un reclamo de producto dañado, frasco roto o inconformidad: discúlpate con empatía, ejecuta avisar_asesor con motivo "reclamo_producto" e indica que un asesor humano coordinará la atención del caso. NUNCA prometas montos de devolución ni plazos por cuenta propia.
  4. NO resuelvas tareas escolares, acertijos matemáticos ni consultas ajenas a Aliv Store. Redirige cordialmente a la tienda y productos de salud ("En Aliv Store nos especializamos en bienestar y salud natural con productos como NAC600 y Termix Tobillera. ¿Hay algo de nuestros productos en lo que te pueda ayudar hoy?").
  5. PROVINCIA / CÓMO PAGO: Si el cliente en provincia pregunta cómo pagar o cuál es el procedimiento, explica con calidez los 3 pasos:
     (1) Adelanto de S/20 por Yape al 951365418 (Gerardo Huaynalaya) para emitir su guía de remisión oficial en Shalom con su DNI.
     (2) Envío de su número de guía para rastrear en tiempo real en la web de Shalom.
     (3) El saldo lo abona a nosotros cuando el paquete llega a la agencia de su ciudad, y un asesor le envía su clave de retiro para recoger con su DNI.
     Pídele su ciudad y DNI para dejarlo listo. ¡NO derives a un asesor por la simple pregunta de cómo pagar!`;

  return `${conCanal}${bloqueImagenesYAgencias}`;
}

/**
 * Seccion CONTEXTO: lo que el agente sabe del cliente, en que etapa esta, que etapas
 * existen y que datos tiene que averiguar. Es lo que hace utiles a mover_etapa y
 * actualizar_contacto sin cablear nada del negocio en el codigo.
 */
export async function renderContexto(contactId: string): Promise<string> {
  const [contact] = await db.select().from(contacts).where(eq(contacts.id, contactId)).limit(1);
  if (!contact) return "";

  // BLINDAJE DE SEGURIDAD: Purgar cualquier clave de recojo para que la IA JAMÁS tenga acceso a ella
  const campos = camposContacto();
  const rawFields = (contact.customFields as Record<string, unknown> | null) ?? {};
  const tieneClaveEnCustomFields = Boolean(
    rawFields.clave_recojo ||
    rawFields.clave_retiro ||
    rawFields.codigo_secreto ||
    rawFields.clave
  );
  const fieldsSafe = { ...rawFields };
  delete fieldsSafe.clave_recojo;
  delete fieldsSafe.clave_retiro;
  delete fieldsSafe.codigo_secreto;
  delete fieldsSafe.clave;

  const conocidos = resumirCampos(campos, fieldsSafe as Record<string, never> | null);
  const aAveriguar = campos
    .filter((c) => c.agente?.calificar !== false && c.agente)
    .filter((c) => {
      const v = (contact.customFields as Record<string, unknown> | null)?.[c.clave];
      return v === null || v === undefined || v === "";
    })
    .map((c) => `- ${c.etiqueta} (${c.clave}${c.opciones ? ": " + c.opciones.join(" | ") : ""}): ${c.agente?.descripcion ?? "preguntar con naturalidad"}`);

  const [pipeline] = await db.select().from(pipelines).where(eq(pipelines.isDefault, true)).limit(1);
  let etapasTxt = "";
  let etapaActual = "sin operacion abierta";
  if (pipeline) {
    const stages = await db
      .select()
      .from(pipelineStages)
      .where(eq(pipelineStages.pipelineId, pipeline.id))
      .orderBy(pipelineStages.order);
    etapasTxt = stages.map((s) => `- ${s.key ?? s.name}: ${s.name}${s.isWon ? " (ganada)" : s.isLost ? " (perdida)" : ""}`).join("\n");
    const [abierta] = await db
      .select({ name: pipelineStages.name })
      .from(deals)
      .innerJoin(pipelineStages, eq(deals.stageId, pipelineStages.id))
      .where(and(eq(deals.contactId, contactId), eq(pipelineStages.pipelineId, pipeline.id)))
      .orderBy(desc(deals.updatedAt))
      .limit(1);
    if (abierta) etapaActual = abierta.name;
  }

  // R5: Cargar historial de pedidos anteriores para que el bot reconozca a clientes que vuelven
  let pedidosTxt = "";
  let tieneClaveEnOrden = false;
  try {
    const prevOrders = await db
      .select({
        numeroOrden: pedidosOrdenes.numeroOrden,
        total: pedidosOrdenes.total,
        estado: pedidosOrdenes.estado,
        items: pedidosOrdenes.items,
        direccionEnvio: pedidosOrdenes.direccionEnvio,
        distrito: pedidosOrdenes.distrito,
        ciudad: pedidosOrdenes.ciudad,
        claveRecojo: pedidosOrdenes.claveRecojo,
        createdAt: pedidosOrdenes.createdAt,
      })
      .from(pedidosOrdenes)
      .where(eq(pedidosOrdenes.contactId, contactId))
      .orderBy(desc(pedidosOrdenes.createdAt))
      .limit(3);

    tieneClaveEnOrden = prevOrders.some((o) => Boolean(o.claveRecojo));
    pedidosTxt = renderPedidosCliente(prevOrders);
  } catch (err) {
    console.warn("[prompt] No se pudo cargar historial de pedidos:", err);
  }

  // Detección y verificación de llamadas telefónicas directamente en el chat
  let llamadasTxt = "";
  let ultimosMensajesChat: Array<{ direction: string; origin: string | null; body: string | null; type: string | null; createdAt: Date | null }> = [];
  try {
    ultimosMensajesChat = await db
      .select({
        direction: messages.direction,
        origin: messages.origin,
        body: messages.body,
        type: messages.type,
        createdAt: messages.createdAt,
      })
      .from(messages)
      .innerJoin(conversations, eq(messages.conversationId, conversations.id))
      .where(eq(conversations.contactId, contactId))
      .orderBy(desc(messages.createdAt))
      .limit(15);

    if (ultimosMensajesChat.length > 0) {
      const estadoLlamada = analizarSolicitudLlamada(
        [...ultimosMensajesChat].reverse().map((m) => ({ ...m, type: m.type ?? undefined }))
      );
      if (estadoLlamada.tieneSolicitud) {
        if (estadoLlamada.llamadaRealizada) {
          llamadasTxt =
            "## Estado de Solicitud de Llamada (Verificado en Chat)\n" +
            `- Solicitud previa del cliente: "${estadoLlamada.detalleSolicitud}"\n` +
            `- ESTADO VERIFICADO: La llamada YA SE REALIZÓ (${estadoLlamada.evidenciaRealizada}).\n` +
            "- INSTRUCCIÓN OBLIGATORIA: PROHIBIDO ofrecer volver a llamar o decir 'te vamos a llamar' o 'un asesor te llamará'. La comunicación telefónica ya se concretó. Continúa directamente con el acuerdo alcanzado y los datos que falten para despachar (ej. DNI, dirección o confirmación de entrega).";
        } else {
          llamadasTxt =
            "## Estado de Solicitud de Llamada (Verificado en Chat)\n" +
            `- Solicitud del cliente: "${estadoLlamada.detalleSolicitud}"${estadoLlamada.horaSolicitada ? ` (horario solicitado: ${estadoLlamada.horaSolicitada})` : ""}\n` +
            "- ESTADO VERIFICADO: La llamada aún NO se registra como realizada en el chat.\n" +
            "- INSTRUCCIÓN OBLIGATORIA: Confirma con calidez que un asesor le marcará al horario solicitado, ejecuta la herramienta avisar_asesor con motivo 'solicitud_llamada' y no envíes scripts genéricos de venta ni presiones por chat hasta que el asesor se comunique.";
        }
      }
    }
  } catch (err) {
    console.warn("[prompt] Error al analizar estado de llamada en chat:", err);
  }

  // Si no hay pedido en la tabla pedidos_ordenes pero en el chat se envió una confirmación de pedido web (#1023, #1086, etc.), rescatarlo
  if (!pedidosTxt && ultimosMensajesChat.length > 0) {
    const msgsOrden = [...ultimosMensajesChat]
      .reverse()
      .filter((m) => m.direction === "out" && m.body && /(?:recibimos\s+tu\s+pedido|tu\s+pedido)\s*\*?#?[A-Z0-9-]+\*?/i.test(m.body))
      .map((m) => m.body!.replace(/\n+/g, " ").trim());
    if (msgsOrden.length > 0) {
      pedidosTxt =
        "## Pedido EN CURSO de este cliente (detectado en el historial del chat)\n" +
        msgsOrden.map((txt) => `- Mensaje de orden enviado al cliente: "${txt}"`).join("\n") +
        "\nInstrucción CRÍTICA: este cliente YA TIENE este pedido registrado en el chat. ESTÁ ESTRICTAMENTE PROHIBIDO preguntarle qué producto le interesa o '¿cuál de los dos te llama la atención?'. Retoma directamente este pedido, responde su duda puntual (ej. si pide video, foto o pregunta cómo se usa) en 2 líneas concisas y ayúdalo a confirmar el envío.";
    }
  }

  const infoNombre = resolverNombreHumanoCliente(contact.name, [...ultimosMensajesChat].reverse());
  const lineaNombre = infoNombre.nombreLimpio
    ? `- Nombre del cliente: ${infoNombre.nombreLimpio} (IMPORTANTE: es la persona que te contacta. Si menciona que su esposo, familiar o un tercero pagará o retirará, NUNCA cambies el nombre ni empieces a llamarla por el nombre del tercero; sigue tratándola como ${infoNombre.nombreLimpio})`
    : `- Nombre del cliente: Aún no confirmado (su perfil muestra "${contact.name}", que es un alias o código: ESTÁ PROHIBIDO llamarlo "${contact.name}"; háblale de tú con calidez sin usar ese alias hasta que indique su nombre real)`;

  const { esNumeroEntrenador } = await import("@/lib/alerts/supervisor-alerts");
  const esEntrenador = esNumeroEntrenador(contact.phone);

  const partes = [
    "\n\n# CONTEXTO",
    "## Cliente",
    `${lineaNombre}${contact.email ? `\n- Email: ${contact.email}` : ""}${contact.phone ? `\n- Telefono: ${contact.phone}${/^\+?51\d{9}$/.test(contact.phone.replace(/\s/g, "")) ? "" : " (no es un celular peruano: pide su numero de celular para la guia)"}` : ""}`,
    ...(conocidos.length ? [`- Datos conocidos: ${conocidos.join("; ")}`] : []),
    ...(contact.aiSummary ? [`- Resumen previo: ${contact.aiSummary}`] : []),
    `- Etapa actual: ${etapaActual}`,
    ...(esEntrenador
      ? [
          "\n⚠️ MODO ENTRENADOR / SUPERVISOR ACTIVO:\n" +
            `Este contacto (${contact.phone}) es un SUPERVISOR / ENTRENADOR OFICIAL de Aliv Perú en auditoría y entrenamiento en vivo.\n` +
            "- Responde a todas sus consultas sobre NAC600, Tobillera Termix, beneficios, dosis, precios y videos oficiales con máxima precisión para que evalúe tu conocimiento.\n" +
            "- ⚠️ ESTÁ ESTRICTAMENTE PROHIBIDO pedirle número de DNI, pedirle adelanto de S/20, pedirle dirección de envío o intentar cerrarle una venta.\n" +
            "- NO crees pedidos en el sistema para este número.",
        ]
      : []),
  ];

  // Detección proactiva de agencia Shalom si el cliente es de provincia (o dio su dirección en chat)
  const fields = (contact.customFields as Record<string, unknown> | null) ?? {};
  const ciudad = (fields.departamento_ciudad || fields.ciudad) ? String(fields.departamento_ciudad || fields.ciudad) : null;
  const distrito = fields.distrito ? String(fields.distrito) : null;
  const direccion = (fields.direccion_envio || fields.direccion) ? String(fields.direccion_envio || fields.direccion) : null;
  let textoDireccionOProvincia = [ciudad, distrito, direccion].filter(Boolean).join(" ");

  try {
    // Si aún no están en customFields, escanear los mensajes del cliente en el chat
    if (!textoDireccionOProvincia && ultimosMensajesChat.length > 0) {
      const msgsCliente = ultimosMensajesChat
        .filter((m) => m.direction === "in")
        .map((m) => m.body ?? "")
        .join(" ");
      if (msgsCliente.trim()) {
        textoDireccionOProvincia = msgsCliente;
      }
    }

    if (textoDireccionOProvincia) {
      const { buscarAgenciaShalomCercana } = await import("@/lib/agencias/shalom-directorio");
      const shalomRes = buscarAgenciaShalomCercana({
        ciudad,
        distrito,
        direccion: textoDireccionOProvincia,
      });
      if (shalomRes.multiplesAgenciasEnCiudad && shalomRes.todasDeCiudad && shalomRes.todasDeCiudad.length > 1) {
        const opcionesTxt = shalomRes.todasDeCiudad
          .map((ag) => {
            const ref = ag.referencia ? ` - ref: ${ag.referencia}` : "";
            return `  • *${ag.nombre}* (${ag.direccion}${ref})`;
          })
          .join("\n");
        partes.push(
          `## ATENCIÓN MANDATORIA: CIUDAD CON MÚLTIPLES AGENCIAS SHALOM (${shalomRes.ciudadDetectada?.toUpperCase() || "PROVINCIA"})\n` +
            `- El cliente se encuentra en ${shalomRes.ciudadDetectada || "provincia"}, donde existen ${shalomRes.todasDeCiudad.length} agencias de Shalom.\n` +
            "- REGLA DE ORO DE GERENCIA:\n" +
            `  ⚠️ ESTÁ ESTRICTAMENTE PROHIBIDO registrar o asumir "Shalom ${shalomRes.ciudadDetectada}" de forma genérica.\n` +
            "  DEBES PREGUNTARLE EXPLÍCITAMENTE al cliente cuál de estas agencias le queda más cómoda o cercana para recoger:\n" +
            `${opcionesTxt}\n` +
            "  Si el cliente ya transfirió el adelanto de S/20, agradécele el pago e INSISTE OBLIGATORIAMENTE en que elija la sede exacta para poder emitir su guía de remisión oficial y despachar."
        );
      } else if (shalomRes.mejorOpcion) {
        const refTexto = shalomRes.mejorOpcion.referencia ? ` - ${shalomRes.mejorOpcion.referencia}` : "";
        partes.push(
          "## AGENCIA SHALOM MÁS CERCANA (OBLIGATORIO: PROPONER COMO PRIMERA OPCIÓN PARA PROVINCIA)\n" +
            `- Agencia recomendada: *${shalomRes.mejorOpcion.nombre}* (${shalomRes.mejorOpcion.direccion}${refTexto})\n` +
            "- INSTRUCCIÓN MANDATORIA DE GERENCIA:\n" +
            `  El cliente se encuentra en provincia o dio/preguntó por esta dirección. DEBES proponerle de inmediato la agencia *${shalomRes.mejorOpcion.nombre}* (${shalomRes.mejorOpcion.direccion}) como primera opción para su entrega:\n` +
            `  "Veo que te ubicas por esa zona. La agencia Shalom más cercana a tu dirección es la de *${shalomRes.mejorOpcion.nombre}* (${shalomRes.mejorOpcion.direccion}). ¿Te parece bien que lo programemos a esa agencia o tienes otra de tu preferencia?"\n` +
            "  No hagas que el cliente busque ni adivine; proponle esta opción directamente."
        );
      }
    }
  } catch (err) {
    console.warn("[prompt] Error al buscar agencia Shalom para contexto:", err);
  }

  // Verificación estricta de requisitos para despacho por Shalom (Provincia)
  const esProvincia = Boolean(
    ciudad ||
    (fields.modalidad_entrega && String(fields.modalidad_entrega).toLowerCase().includes("shalom")) ||
    (pedidosTxt && pedidosTxt.toLowerCase().includes("shalom")) ||
    (textoDireccionOProvincia && !/lima|callao/i.test(textoDireccionOProvincia))
  );

  if (esProvincia) {
    const tieneDni = Boolean(fields.dni_ruc || fields.dni || fields.documento || (contact.notes && /dni[:\s]*\d{8}/i.test(contact.notes)));
    const tieneAgenciaExacta = Boolean(
      (fields.agencia_shalom && !/shalom\s+(?:provincia|iquitos|pisco|arequipa|trujillo|chiclayo|piura)$/i.test(String(fields.agencia_shalom))) ||
      (fields.direccion_envio && /av\.|jr\.|calle|nro|#|mz\.|lt\./i.test(String(fields.direccion_envio)) && !/shalom\s+(?:provincia|iquitos|pisco|arequipa|trujillo|chiclayo|piura)$/i.test(String(fields.direccion_envio)))
    );

    const faltantesProvincia: string[] = [];
    if (!tieneDni) {
      faltantesProvincia.push("- DNI (8 dígitos): ❌ NO REGISTRADO (Obligatorio para emitir la guía oficial de Shalom). DEBES pedirlo amablemente en tu respuesta.");
    }
    if (!tieneAgenciaExacta) {
      faltantesProvincia.push("- AGENCIA SHALOM EXACTA: ❌ NO IDENTIFICADA (Falta definir la sede con dirección). DEBES proponer o consultar las sedes oficiales disponibles.");
    }

    if (faltantesProvincia.length > 0) {
      partes.push(
        "## ⚠️ REQUISITOS OBLIGATORIOS FALTANTES PARA DESPACHO SHALOM:\n" +
          faltantesProvincia.join("\n") +
          "\nINSTRUCCIÓN CRÍTICA DE ATENCIÓN:\n" +
          "Si el cliente realiza o indica que ya hizo el adelanto, agradécele y de forma OBLIGATORIA solicita los datos marcados con ❌ en este mismo mensaje.\n" +
          "ESTÁ TOTALMENTE PROHIBIDO decir simplemente 'ya avisé para despachar' si no tienes el DNI o la agencia exacta."
      );
    }
  }

  // Detección de clave ya entregada o saldo ya pagado
  const chatTieneClaveEntregada = Boolean(
    ultimosMensajesChat &&
    ultimosMensajesChat.some(
      (m) =>
        m.direction === "out" &&
        m.body &&
        (/(?:clave(?:\s+secreta)?(?:\s+de\s+recojo|\s+de\s+retiro)?\s*(?:es|:)\s*\d+)|(?:c[oó]digo\s+de\s+recojo\s*(?:es|:)\s*\d+)|(?:clave\s*:\s*\*\d+\*)|(?:clave\s+de\s+recojo\s+en\s+agencia\s+shalom)/i.test(m.body) ||
          /pago\s+del\s+saldo\s+de\s+S\/.*confirmado/i.test(m.body))
    )
  );
  const claveYaEntregada = tieneClaveEnCustomFields || tieneClaveEnOrden || chatTieneClaveEntregada;

  if (claveYaEntregada) {
    partes.push(
      "## 🟢 ESTADO DE CLAVE Y SALDO SHALOM: SALDO CANCELADO Y CLAVE YA ENTREGADA AL CLIENTE\n" +
        "- Este cliente YA RECIBIÓ su clave de recojo de Shalom en el chat y/o su pago de saldo ya está verificado y confirmado.\n" +
        "- ⛔ REGLAS ESTRICTAS DE ATENCIÓN:\n" +
        "  1. ESTÁ TERMINANTEMENTE PROHIBIDO volver a decir que un asesor verificará su abono, que validará su pago o que le enviará su clave secreta. ¡LA CLAVE YA LE FUE ENTREGADA Y EL ABONO YA ESTÁ CONFIRMADO!\n" +
        "  2. Si el cliente consulta sobre cómo tomar el producto, posología, modo de uso, ingredientes, o agradece, responde ÚNICA Y EXCLUSIVAMENTE a su consulta puntual sobre el producto de forma directa, amable y servicial.\n" +
        "  3. NO agregues bajo ninguna circunstancia coletillas sobre claves, asesores, vouchers ni validaciones pendientes de pago."
    );
  }

  if (llamadasTxt) partes.push(llamadasTxt);
  if (pedidosTxt) partes.push(pedidosTxt);

  // Formulario web abandonado: el cliente ya eligió pack y dejó datos en la landing.
  const abandono = rawFields.abandono as
    | { pack?: string; total?: number; ciudad?: string | null; direccion?: string | null; capturadoEn?: string }
    | undefined;
  const tagsContacto = (contact.tags ?? []).map((t) => t.toLowerCase());
  if (abandono && tagsContacto.includes("formulario_abandonado") && !tagsContacto.includes("abandono_recuperado") && !pedidosTxt) {
    partes.push(
      "## Formulario web incompleto (viene de la tienda)\n" +
        `- Llenó el formulario de compra de alivstore.shop con: *${abandono.pack ?? "pack sin dato"}*${abandono.total ? ` por S/${Number(abandono.total).toFixed(2)}` : ""}` +
        `${abandono.ciudad ? `, ciudad: ${abandono.ciudad}` : ""}${abandono.direccion ? `, dirección: ${abandono.direccion}` : ""}. No lo envió.\n` +
        "- YA ELIGIÓ: no le preguntes qué producto quiere ni le pegues la lista de precios. Confírmale ese pedido y pide SOLO lo que falte (nombre completo, dirección con número/referencia y día de entrega en Lima; agencia Shalom y DNI en provincia).\n" +
        "- Si cuenta que el formulario falló o tuvo dudas, resuélvelas en una línea y registra el pedido aquí con crear_pedido_chat. Si dice que ya no lo quiere, respétalo y despídete en una línea."
    );
  }

  if (etapasTxt) partes.push("## Pipeline (clave: nombre)", etapasTxt);
  if (aAveriguar.length) partes.push("## Datos a averiguar", ...aAveriguar);

  // Reglas de negocio y FAQs configuradas visualmente desde Ajustes
  try {
    const rules = await getBusinessRules();
    const rulesTxt = renderBusinessRulesPrompt(rules);
    if (rulesTxt) partes.push(rulesTxt);
  } catch (err) {
    console.warn("[prompt] error al cargar business rules en contexto:", err);
  }

  return partes.join("\n");
}

/** Prompt final con el template global (sin contexto de contacto). Para previews. */
export async function buildSystemPrompt(now: Date, channel = "whatsapp"): Promise<string> {
  const template = await getSystemPromptTemplate();
  return renderSystemPrompt(template, { now, channel });
}

interface PedidoResumen {
  numeroOrden: string | null;
  total: string | null;
  estado: string;
  items: unknown;
  direccionEnvio?: string | null;
  distrito?: string | null;
  ciudad?: string | null;
}

const ESTADOS_EN_CURSO = new Set(["por_confirmar_cod", "confirmado", "preparando", "enviado"]);

/**
 * Antes todos los pedidos salian como "historial (cliente recurrente)" y el bot trataba un
 * pedido aun sin completar (ej. #1071 con la direccion incompleta) como compra pasada y
 * ofrecia "un nuevo pedido". Ahora se separan: los que siguen en curso se completan; solo
 * los entregados cuentan como compra previa.
 */
export function renderPedidosCliente(pedidos: PedidoResumen[]): string {
  if (pedidos.length === 0) return "";
  const linea = (p: PedidoResumen) => {
    const items = Array.isArray(p.items)
      ? (p.items as Array<{ cantidad: number; titulo: string }>).map((i) => `${i.cantidad}x ${i.titulo}`).join(", ")
      : "Productos Aliv";
    const destino = [p.direccionEnvio, p.distrito, p.ciudad].filter(Boolean).join(", ");
    return `- Pedido ${p.numeroOrden}: ${items} por S/ ${p.total} (estado: ${p.estado})${destino ? ` — dirección registrada: "${destino}"` : ""}`;
  };
  const enCurso = pedidos.filter((p) => ESTADOS_EN_CURSO.has(p.estado));
  const entregados = pedidos.filter((p) => p.estado === "entregado");
  const partes: string[] = [];
  if (enCurso.length > 0) {
    partes.push(
      "## Pedido EN CURSO de este cliente (aún no entregado)\n" +
        enCurso.map(linea).join("\n") +
        "\nInstrucción: este pedido sigue abierto. Si el cliente escribe (aunque sea un saludo o \"quiero información\"), " +
        "retómalo por su número: confirma lo que pidió y pide SOLO el dato que falte (dirección completa con número, distrito, referencia; o en provincia agencia Shalom, nombre y DNI). " +
        "No lo trates como cliente recurrente ni le ofrezcas \"un nuevo pedido\": solo crea otro si el cliente dice que quiere algo adicional.",
    );
  }
  if (entregados.length > 0) {
    partes.push(
      "## Compras anteriores entregadas (cliente recurrente)\n" +
        entregados.map(linea).join("\n") +
        "\nInstrucción: reconócelo como cliente recurrente de forma cálida (ej. 'Hola Vidal, veo que ya probaste NAC600...').",
    );
  }
  return partes.join("\n\n");
}

/**
 * Determina si un nombre de contacto en WhatsApp es un nombre humano real
 * o si por el contrario es un teléfono, handle con números (anacarrera2318),
 * iniciales (C.O.F. MADRE) o frase larga ("si nombró con amor lo atr").
 * Si el perfil no tiene un nombre limpio, busca si en algún mensaje inicial
 * de pedido web de Aliv Perú se le llamó por su nombre de pila real ("¡Hola, Yesica!").
 */
export function resolverNombreHumanoCliente(
  rawName: string | null | undefined,
  mensajes?: Array<{ direction: string; body: string | null }>
): { nombreLimpio: string | null; esAliasOCodigo: boolean } {
  const limpio = (rawName || "").replace(/[\p{Extended_Pictographic}\u200d\uFE0F]/gu, "").trim();

  // 1. Intentar rescatar primero si hay un saludo de pedido web oficial ("¡Hola, Yesica! 👋 Te saluda Aliv Perú. Recibimos tu pedido...")
  if (mensajes && mensajes.length > 0) {
    for (const m of mensajes) {
      if (m.direction === "out" && m.body && /recibimos\s+tu\s+pedido|tu\s+pedido\s*\*?#/i.test(m.body)) {
        const match = m.body.match(/¡?Hola,\s+([A-ZÁÉÍÓÚÑ][a-záéíóúñ]{2,15})!/);
        if (match && match[1] && !/^(Bienvenido|Bienvenida|Hola|Cliente)$/i.test(match[1])) {
          return { nombreLimpio: match[1], esAliasOCodigo: false };
        }
      }
    }
  }

  const tieneDigitos = /\d/.test(limpio);
  const esInicialesOSimbolos = /^[.\-_@#+$%&*]+$/.test(limpio) || /\b[A-Z]\.[A-Z]\./.test(limpio);
  const palabras = limpio.split(/\s+/).filter(Boolean);
  const esFraseORaro =
    !limpio ||
    limpio.length < 2 ||
    tieneDigitos ||
    esInicialesOSimbolos ||
    palabras.length > 4 ||
    /^(desconocido|lead|cliente|usuario|sin nombre|hola|si|no|ninguno)$/i.test(limpio) ||
    /\b(madre|agradecida|amor|cosmiatria|centro|bodega|tienda|yobamedic)\b/i.test(limpio);

  if (!esFraseORaro) {
    const primerNombre = palabras[0].replace(/[^a-zA-ZáéíóúÁÉÍÓÚñÑüÜ]/g, "");
    if (primerNombre.length >= 3 && primerNombre.length <= 15) {
      const capitalizado = primerNombre.charAt(0).toUpperCase() + primerNombre.slice(1).toLowerCase();
      return { nombreLimpio: capitalizado, esAliasOCodigo: false };
    }
  }

  return { nombreLimpio: null, esAliasOCodigo: true };
}
