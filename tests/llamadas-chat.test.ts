import { describe, it, expect } from "vitest";
import { analizarSolicitudLlamada } from "@/lib/agent/llamadas";

describe("Detección y Verificación de Llamadas en el Chat", () => {
  it("detecta cuando un cliente solicita llamada telefónica sin realizar todavía", () => {
    const mensajes = [
      { direction: "out", origin: "agent", body: "Hola Carlos, te escribimos de Aliv Perú..." },
      { direction: "in", origin: null, body: "Ok" },
      { direction: "in", origin: null, body: "Me llamas a las 8 mañana" },
    ];

    const res = analizarSolicitudLlamada(mensajes);
    expect(res.tieneSolicitud).toBe(true);
    expect(res.llamadaRealizada).toBe(false);
    expect(res.detalleSolicitud).toBe("Me llamas a las 8 mañana");
    expect(res.horaSolicitada).toContain("a las 8");
  });

  it("verifica que la llamada YA se realizó cuando aparece un evento de llamada en el chat (caso WhatsApp)", () => {
    const mensajes = [
      { direction: "out", origin: "agent", body: "Hola Carlos, te escribimos de Aliv..." },
      { direction: "in", origin: null, body: "Me llamas a las 8 mañana" },
      { direction: "out", origin: "agent", body: "📦 Lo enviamos por agencia Shalom..." },
      { direction: "in", origin: null, body: "Llamada 1 minuto", type: "call" },
    ];

    const res = analizarSolicitudLlamada(mensajes);
    expect(res.tieneSolicitud).toBe(true);
    expect(res.llamadaRealizada).toBe(true);
    expect(res.evidenciaRealizada).toContain("Llamada");
  });

  it("verifica que la llamada YA se realizó cuando un asesor humano interviene posteriormente (origin: human)", () => {
    const mensajes = [
      { direction: "in", origin: null, body: "llámame por favor para coordinar" },
      { direction: "out", origin: "agent", body: "¡Por supuesto! Ya le avisé al asesor." },
      {
        direction: "out",
        origin: "human",
        body: "Estimado, según lo conversado procedemos con el despacho a Shalom de Av. Parra.",
      },
    ];

    const res = analizarSolicitudLlamada(mensajes);
    expect(res.tieneSolicitud).toBe(true);
    expect(res.llamadaRealizada).toBe(true);
    expect(res.evidenciaRealizada).toContain("humano");
  });

  it("verifica que la llamada YA se realizó si el texto posterior menciona 'según lo conversado'", () => {
    const mensajes = [
      { direction: "in", origin: null, body: "pueden llamarme mañana temprano?" },
      {
        direction: "out",
        origin: null,
        body: "Buenas tardes según lo conversado le comparto la dirección de Shalom.",
      },
    ];

    const res = analizarSolicitudLlamada(mensajes);
    expect(res.tieneSolicitud).toBe(true);
    expect(res.llamadaRealizada).toBe(true);
  });

  it("retorna tieneSolicitud = false si no hubo petición de llamada", () => {
    const mensajes = [
      { direction: "in", origin: null, body: "Hola, qué precio tiene la tobillera?" },
      { direction: "out", origin: "agent", body: "1 por S/79 y 2 por S/139" },
    ];

    const res = analizarSolicitudLlamada(mensajes);
    expect(res.tieneSolicitud).toBe(false);
    expect(res.llamadaRealizada).toBe(false);
  });
});
