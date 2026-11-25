import "server-only";
import { getNextGeminiKey, markGeminiKeyRateLimited } from "@/lib/gemini-keys";
import { anotarUsoIA } from "@/lib/ia-uso";
import { datosDeRotulo, type DatosRotulo } from "./guia-pdf-reglas";

/**
 * Lee el N° de orden y el código del rótulo de Shalom (la preguía PDF es una imagen, sin
 * texto). Usa el mismo modelo de visión que los comprobantes. Si la IA no responde, devuelve
 * null y los campos se llenan a mano como antes.
 */
export async function leerRotuloShalom(imagen: Buffer): Promise<DatosRotulo | null> {
  const clave = getNextGeminiKey() || process.env.GEMINI_API_KEY;
  if (!clave) return null;
  const modelo = process.env.VISION_MODEL || "gemini-3.1-flash-lite";
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent?key=${clave}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text:
                  "Es un rótulo de envío de la agencia Shalom (Perú). Copia exactamente lo que dice junto a «N° de Orden» " +
                  "y junto a «Código». Responde SOLO un JSON: {\"numeroOrden\": \"...\", \"codigo\": \"...\"}. " +
                  "Si no se lee alguno, pon null.",
              },
              { inlineData: { mimeType: "image/jpeg", data: imagen.toString("base64") } },
            ],
          },
        ],
        generationConfig: { responseMimeType: "application/json", temperature: 0 },
      }),
      signal: AbortSignal.timeout(25_000),
    });
    if (!res.ok) {
      if (res.status === 429) markGeminiKeyRateLimited(clave, 60);
      anotarUsoIA({ proveedor: "gemini", modelo, origen: "vision", ok: false });
      console.warn(`[guia-ocr] Gemini ${modelo} respondió ${res.status}`);
      return null;
    }
    const data = await res.json();
    anotarUsoIA({
      proveedor: "gemini",
      modelo,
      origen: "vision",
      ok: true,
      tokensEntrada: Number(data?.usageMetadata?.promptTokenCount) || 0,
      tokensSalida: Number(data?.usageMetadata?.candidatesTokenCount) || 0,
    });
    return datosDeRotulo(String(data?.candidates?.[0]?.content?.parts?.[0]?.text ?? ""));
  } catch (err) {
    console.warn("[guia-ocr] No se pudo leer el rótulo:", err);
    return null;
  }
}
