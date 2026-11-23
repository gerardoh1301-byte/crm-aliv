import { describe, expect, it } from "vitest";
import { textoUbicacion, ubicacionDesdePayload } from "@/lib/channels/ubicacion";

// Forma real del webhook de Zernio (22/11): texto «📍 Location», sin adjuntos, y las
// coordenadas en el metadata del sobre.
const payloadReal = {
  id: "evt",
  event: "message.received",
  message: { id: "m1", text: "📍 Location", attachments: [], platform: "whatsapp", direction: "incoming" },
  metadata: { location: { latitude: -12.1551418, longitude: -76.9575584 } },
};

describe("ubicaciones de WhatsApp por Zernio", () => {
  it("lee las coordenadas del metadata del sobre", () => {
    const u = ubicacionDesdePayload(payloadReal);
    expect(u).toEqual({ latitud: -12.1551418, longitud: -76.9575584, nombre: undefined, direccion: undefined });
    const t = textoUbicacion(u!);
    expect(t).toContain("Ubicación enviada por el cliente");
    expect(t).toContain("https://maps.google.com/?q=-12.155142,-76.957558");
  });

  it("incluye nombre y dirección si vienen", () => {
    const u = ubicacionDesdePayload({ message: { location: { latitude: "-8.1", longitude: "-79.0", name: "Mall Plaza", address: "Av. América Oeste" } } });
    expect(textoUbicacion(u!)).toContain(": Mall Plaza, Av. América Oeste]");
  });

  it("acepta la ubicación como adjunto de tipo location", () => {
    expect(ubicacionDesdePayload({ message: { attachments: [{ type: "location", latitude: -12, longitude: -77 }] } })?.latitud).toBe(-12);
  });

  it("sin coordenadas válidas no inventa nada", () => {
    expect(ubicacionDesdePayload({ message: { text: "hola" } })).toBeNull();
    expect(ubicacionDesdePayload({ metadata: { location: { latitude: 200, longitude: 0 } } })).toBeNull();
    expect(ubicacionDesdePayload({ metadata: { otra: 1 } })).toBeNull();
    expect(ubicacionDesdePayload(null)).toBeNull();
  });
});
