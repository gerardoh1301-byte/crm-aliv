/**
 * Transcribe notas de voz y audios entrantes desde Zernio usando Google Gemini ($0 Costo).
 * Modelo optimizado: gemini-3.5-transcribe (Speech-to-Text especializado de ultra baja latencia, ~2s).
 */

export interface TranscribeOptions {
  apiKey?: string;
  zernioKey?: string;
  model?: string;
  timeoutMs?: number;
}

export async function transcribeAudioAttachment(
  attachment: { url?: string; mimeType?: string; payload?: unknown },
  options: TranscribeOptions = {}
): Promise<string | null> {
  const url = attachment.url;
  if (!url) return null;

  const geminiKey = options.apiKey || process.env.GEMINI_API_KEY;
  const zernioKey = options.zernioKey || process.env.ZERNIO_API_KEY;

  if (!geminiKey) {
    console.warn("[transcribe] GEMINI_API_KEY no configurada");
    return null;
  }

  // Aumentado a 35s para tolerar descarga de Zernio (3-4s) + transcripción Gemini (2s)
  const timeoutMs = options.timeoutMs ?? 35000;

  try {
    // 1. Descargar audio desde Zernio
    const headers: Record<string, string> = {};
    if (zernioKey) {
      headers["Authorization"] = `Bearer ${zernioKey}`;
    }

    const audioRes = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!audioRes.ok) {
      console.warn(`[transcribe] error descargando audio (${audioRes.status})`);
      return null;
    }

    const arrayBuf = await audioRes.arrayBuffer();
    if (arrayBuf.byteLength === 0) return null;

    const base64Audio = Buffer.from(arrayBuf).toString("base64");

    // Detectar mime-type limpio (audio/ogg, audio/mp4, audio/wav, etc.)
    const rawMime =
      (attachment.payload as { mimeType?: string })?.mimeType ||
      attachment.mimeType ||
      "audio/ogg";
    const cleanMime = rawMime.split(";")[0].trim().toLowerCase();

    // 2. Modelo especializado de transcripción (gemini-3.5-transcribe responde en ~2s sin razonamiento pesado)
    const primaryModel = options.model || process.env.AGENT_AUDIO_MODEL || "gemini-3.5-transcribe";
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/interactions?key=${geminiKey}`;

    const makeRequest = async (modelName: string) => {
      const payload: Record<string, unknown> = {
        model: modelName,
        input: [
          {
            type: "text",
            text: "Transcribe con total exactitud y fidelidad lo que dice esta nota de voz en español de Perú. Devuelve ÚNICAMENTE el texto hablado tal cual, sin introducciones ni comillas.",
          },
          {
            type: "audio",
            data: base64Audio,
            mime_type: cleanMime,
          },
        ],
      };

      if (modelName === "gemini-3.8-flash") {
        payload.generation_config = {
          thinking_level: "low",
          transcription_config: {
            language_codes: ["es-PE", "es"],
          },
        };
      }

      return fetch(geminiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(timeoutMs),
      });
    };

    let gRes = await makeRequest(primaryModel);

    // Fallback automático si el modelo primario tuviera algún inconveniente
    if (!gRes.ok && primaryModel !== "gemini-3.8-flash") {
      console.warn(`[transcribe] Falló ${primaryModel} (${gRes.status}), reintentando con gemini-3.8-flash...`);
      gRes = await makeRequest("gemini-3.8-flash");
    }

    if (!gRes.ok) {
      const errText = await gRes.text().catch(() => "");
      console.warn(`[transcribe] Gemini error ${gRes.status}: ${errText.slice(0, 200)}`);
      return null;
    }

    const data = await gRes.json();
    const outputStep = data.steps?.find(
      (s: { type?: string }) => s.type === "model_output"
    );
    const transcript = outputStep?.content?.[0]?.text?.trim();

    if (!transcript || transcript.toLowerCase() === "[inaudible]") {
      return null;
    }

    // Limpieza de comillas periféricas si el modelo las agregó
    const cleanTranscript = transcript.replace(/^["'«]+|["'»]+$/g, "").trim();
    return cleanTranscript || null;
  } catch (err) {
    console.error("[transcribe] Error transcribiendo audio:", err);
    return null;
  }
}

/**
 * Inspecciona imágenes entrantes desde Zernio usando Gemini Vision ($0 Costo adicional)
 * para que el agente sepa qué foto envió realmente el cliente (producto, consulta o posible
 * captura de pago) y jamás valide un comprobante falso a ciegas.
 */
export async function inspectImageAttachment(
  attachment: { url?: string; mimeType?: string; payload?: unknown },
  options: TranscribeOptions = {}
): Promise<string | null> {
  const url = attachment.url;
  if (!url) return null;

  const geminiKey = options.apiKey || process.env.GEMINI_API_KEY;
  const zernioKey = options.zernioKey || process.env.ZERNIO_API_KEY;
  if (!geminiKey) return null;

  const timeoutMs = options.timeoutMs ?? 25000;

  try {
    const headers: Record<string, string> = {};
    if (zernioKey) {
      headers["Authorization"] = `Bearer ${zernioKey}`;
    }

    const imgRes = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!imgRes.ok) return null;

    const arrayBuf = await imgRes.arrayBuffer();
    if (arrayBuf.byteLength === 0) return null;

    const base64Image = Buffer.from(arrayBuf).toString("base64");
    const rawMime =
      (attachment.payload as { mimeType?: string })?.mimeType ||
      attachment.mimeType ||
      "image/jpeg";
    const cleanMime = rawMime.split(";")[0].trim().toLowerCase();

    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`;
    const gRes = await fetch(geminiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text:
                  "Analiza esta imagen enviada por un cliente al chat de Aliv Perú (tienda de NAC600 y Termix Tobillera). " +
                  "Indica en 1 o 2 oraciones breves qué es exactamente la imagen:\n" +
                  "- Si parece una constancia/voucher de pago (Yape, Plin, transferencia bancaria), inicia con 'POSIBLE COMPROBANTE DE PAGO (PENDIENTE DE VALIDACIÓN HUMANA):' y detalla banco/app, monto visible, fecha y destinatario si se leen.\n" +
                  "- Si NO es un comprobante de pago (ej. carnet, DNI, selfie, foto de un producto como NAC600 o Termix Tobillera, anuncio, receta médica u otro objeto), inicia con 'NO ES COMPROBANTE DE PAGO:' y describe qué muestra realmente la imagen.",
              },
              {
                inlineData: {
                  mimeType: cleanMime,
                  data: base64Image,
                },
              },
            ],
          },
        ],
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!gRes.ok) return null;
    const data = await gRes.json();
    const desc = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    return desc || null;
  } catch (err) {
    console.error("[inspectImage] Error inspeccionando imagen:", err);
    return null;
  }
}
