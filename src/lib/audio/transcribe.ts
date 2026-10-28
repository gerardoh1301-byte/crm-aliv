/**
 * Transcribe notas de voz y audios entrantes desde Zernio usando Google Gemini ($0 Costo).
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

  const timeoutMs = options.timeoutMs ?? 15000;

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

    // 2. Transcripción con Google Gemini (Interactions API oficial)
    const model = options.model || process.env.AGENT_AUDIO_MODEL || "gemini-3.8-flash";
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/interactions?key=${geminiKey}`;

    const payload = {
      model,
      input: [
        {
          type: "text",
          text: "Transcribe con total exactitud y fidelidad lo que dice esta nota de voz en español (Perú). Devuelve ÚNICAMENTE el texto hablado tal cual, sin prefijos, sin explicaciones ni comillas añadidas. Si es inaudible o silencio puro, responde [inaudible].",
        },
        {
          type: "audio",
          data: base64Audio,
          mime_type: cleanMime,
        },
      ],
    };

    const gRes = await fetch(geminiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs),
    });

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

    return transcript;
  } catch (err) {
    console.error("[transcribe] Error transcribiendo audio:", err);
    return null;
  }
}
