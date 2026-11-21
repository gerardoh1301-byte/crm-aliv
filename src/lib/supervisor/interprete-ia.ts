import "server-only";
import { createChatCompletionWithFallback, getAgentModel, hasOpenRouterKey } from "@/lib/agent/openrouter";
import { normalizarTraduccion, type TraduccionOrden } from "./traduccion";

/**
 * Cuando el intérprete fijo (parser.ts) no entiende lo que escribió el supervisor
 * («confirma lo de Manuel, ya me llegó su yape», «cuánto le falta pagar a Vertiz»),
 * la IA lo TRADUCE a una orden estándar («adelanto manuel vertiz», «estado vertiz»).
 *
 * La IA nunca ejecuta nada: su traducción vuelve a pasar por el intérprete fijo y toda
 * acción sigue pidiendo «SI 1153» antes de aplicarse. Si la IA no está disponible o
 * falla, se devuelve null y se usa la respuesta de siempre.
 */
export async function traducirOrdenConIA(
  texto: string,
  contexto: string[]
): Promise<TraduccionOrden | null> {
  if (!hasOpenRouterKey() || !texto.trim()) return null;

  const prompt = `Eres el asistente interno del CRM de Aliv Perú. Gerardo (dueño y supervisor de pagos) te escribe por WhatsApp. Traduce su ÚLTIMO mensaje a UNA orden estándar del CRM.

ÓRDENES ESTÁNDAR (el <pedido> puede ser el número como 1153 / LEG-1049, la guía Shalom de 8-10 cifras como 104493022, el celular del cliente o su nombre):
- "adelanto <pedido>"            → verificó el Yape/Plin del adelanto de S/20 de un pedido de provincia
- "pagó <pedido> <monto>"        → el cliente pagó el saldo (monto en soles). "pago completo <pedido>" si dice que pagó todo sin monto
- "flete <pedido> <monto>"       → flete Shalom pagado
- "clave <pedido>"               → quiere ver o mandar la clave de retiro de Shalom
- "entregado <pedido>"           → el cliente ya recogió / recibió el pedido
- "estado <pedido>"              → pide información de un pedido (cuánto debe, dónde está, si pagó, su guía, DNI, dirección, productos, su clave para verla...)
- "guia <pedido> <ordenShalom> <codigo>" → nueva guía Shalom (orden de 8-10 cifras y código de 4 caracteres)
- "cancela <pedido> porque <motivo>" → anular o cancelar un pedido
- "pasa <pedido> a <confirmado|preparando|enviado|por confirmar>" → cambiar el estado del pedido
- "dni <pedido> <dni de 8 cifras>" → corregir o registrar el DNI
- "direccion <número de pedido> <dirección nueva>" / "agencia <número de pedido> <agencia Shalom>" → cambiar dirección o agencia (exige el número de pedido)
- "registra clave <pedido> <clave>" → guardar la clave de retiro de Shalom
- "total <pedido> <monto>"       → corregir el total del pedido
- "nota <número de pedido> <texto>" → dejar una nota en el pedido
- "SI <pedido>" / "ENVIAR <pedido>" / "NO" → confirma, envía la clave o cancela lo que se le propuso
- "ayuda"                        → pregunta qué órdenes existen

CONSULTAS GENERALES (sin pedido): "resumen de hoy" (o "resumen de ayer", "resumen de la semana", "resumen del mes"), "quién me debe", "adelantos pendientes", "por enviar", "en camino", "pedidos por confirmar".

REGLAS:
- Si el mensaje no dice el pedido (ni guía, celular o nombre) pero se refiere al cliente del último aviso del chat (por ejemplo "confirma ese adelanto", "ya pagó"), usa el número de pedido del aviso más reciente.
- Si da la guía Shalom, el celular o el nombre del cliente, ponlos en la orden tal cual (por ejemplo "clave 104493022" o "estado carlos huaynalaya"); NO uses el pedido del último aviso en ese caso.
- Nunca inventes montos ni números de pedido que no estén en el mensaje o en el chat.
- Todo cambio se le volverá a confirmar a Gerardo con "SI <pedido>": tradúcelo a la orden aunque sea un cambio.
- Si es una instrucción para el CRM que no está en la lista (cambiar productos, devolver dinero, borrar un cliente, etc.), responde tipo "no_soportada" y describe en pocas palabras qué pide.
- Si NO es una instrucción para el CRM (Gerardo está probando el bot de ventas escribiendo como un cliente, saluda, pregunta precios del producto, etc.), responde tipo "no_es_orden".

ÚLTIMOS MENSAJES DEL CHAT (del más antiguo al más reciente; "CRM" son avisos y respuestas del sistema):
${contexto.join("\n") || "(sin mensajes previos)"}

MENSAJE A TRADUCIR: ${texto}

Responde SOLO un JSON: {"tipo": "orden" | "no_soportada" | "no_es_orden", "orden": "<orden estándar o vacío>", "descripcion": "<qué pide, en pocas palabras>"}`;

  try {
    const completion = await createChatCompletionWithFallback(
      {
        model: getAgentModel(),
        messages: [
          { role: "system", content: "Responde únicamente con JSON válido, sin markdown ni texto extra." },
          { role: "user", content: prompt },
        ],
        temperature: 0,
        response_format: { type: "json_object" },
      },
      { origen: "supervisor_ordenes", timeout: 12_000, totalTimeoutMs: 25_000 }
    );
    const contenido = completion.choices[0]?.message?.content?.trim();
    if (!contenido) return null;
    const traduccion = normalizarTraduccion(JSON.parse(contenido.replace(/^```(?:json)?\s*|\s*```$/g, "")));
    if (!traduccion) console.warn("[supervisor-ia] respuesta descartada:", contenido.slice(0, 300));
    return traduccion;
  } catch (err) {
    console.warn("[supervisor-ia] no se pudo interpretar la orden:", err instanceof Error ? err.message : err);
    return null;
  }
}
