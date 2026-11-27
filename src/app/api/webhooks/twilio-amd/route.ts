import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { activities } from "@/db/schema";
import { like } from "drizzle-orm";
import { pedidosOrdenes } from "../../../../../modules/pedidos/tabla";
import { obtenerConfigVozIA } from "@/lib/voice/llamar-pedido";
import { esContestadora, firmaTwilioValida, urlCallbackAmd } from "@/lib/voice/twilio-amd";

/**
 * Twilio avisa aquí quién contestó la llamada de Sofía. Si fue el buzón de voz, se cuelga
 * de inmediato: la IA no le habla a la contestadora y se ahorran minutos de Twilio y ElevenLabs.
 */
export async function POST(request: NextRequest) {
  const form = await request.formData();
  const params: Record<string, string> = {};
  form.forEach((v, k) => {
    params[k] = String(v);
  });

  const config = await obtenerConfigVozIA();
  if (!config.twilioAccountSid || !config.twilioAuthToken) {
    return NextResponse.json({ ok: false, motivo: "Twilio sin configurar" }, { status: 503 });
  }
  if (!firmaTwilioValida(urlCallbackAmd(), params, request.headers.get("x-twilio-signature"), config.twilioAuthToken)) {
    return NextResponse.json({ ok: false, motivo: "Firma inválida" }, { status: 403 });
  }

  const callSid = params.CallSid;
  const answeredBy = params.AnsweredBy;
  if (!callSid || !esContestadora(answeredBy)) {
    return NextResponse.json({ ok: true, colgada: false, answeredBy });
  }

  const auth = Buffer.from(`${config.twilioAccountSid}:${config.twilioAuthToken}`).toString("base64");
  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${config.twilioAccountSid}/Calls/${encodeURIComponent(callSid)}.json`,
    {
      method: "POST",
      headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ Status: "completed" }).toString(),
      signal: AbortSignal.timeout(10_000),
    }
  ).catch(() => null);

  // Dejar constancia en la ficha del cliente (el pedido guarda el sid al iniciar la llamada).
  const [pedido] = await db
    .select({ contactId: pedidosOrdenes.contactId, numeroOrden: pedidosOrdenes.numeroOrden })
    .from(pedidosOrdenes)
    .where(like(pedidosOrdenes.notas, `%sid=${callSid}%`))
    .limit(1);
  if (pedido?.contactId) {
    await db.insert(activities).values({
      type: "call",
      description: `📵 [IA Voz] Contestó el buzón de voz (${answeredBy}) en la llamada del pedido ${pedido.numeroOrden}: se colgó sin hablar.`,
      contactId: pedido.contactId,
    });
  }

  return NextResponse.json({ ok: true, colgada: Boolean(res?.ok), answeredBy });
}
