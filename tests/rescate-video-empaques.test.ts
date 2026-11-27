import { describe, expect, it } from "vitest";
import { mensajeRescate, plantillaParaRescate, PLANTILLA_ADELANTO_VIDEO } from "@/lib/agent/rescate";
import { VIDEO_EMPAQUES_PREPARANDO } from "@/lib/agent/imagenes-referencia";

const datos = { nombre: "Diego", producto: "suplemento NAC600 + NAD+", ciudad: "Cusco" };
const plantilla = plantillaParaRescate("primero", "adelanto_provincia", datos);
const texto = "Hola Diego, tenemos separada tu orden...";

describe("video de empaques en el recordatorio del adelanto", () => {
  it("dentro de 24 h va el texto con el video adjunto", () => {
    const m = mensajeRescate({ envio: { modo: "texto" }, texto, pasada: "primero", escenario: "adelanto_provincia", plantillasAprobadas: new Set() });
    expect(m.text).toBe(texto);
    expect(m.attachments).toEqual([{ type: "video", url: VIDEO_EMPAQUES_PREPARANDO }]);
  });

  it("otros escenarios y el segundo toque no llevan video", () => {
    expect(mensajeRescate({ envio: { modo: "texto" }, texto, pasada: "primero", escenario: "cotizacion_abandonada", plantillasAprobadas: new Set() }).attachments).toBeUndefined();
    expect(mensajeRescate({ envio: { modo: "texto" }, texto, pasada: "segundo", escenario: "adelanto_provincia", plantillasAprobadas: new Set() }).attachments).toBeUndefined();
  });

  it("fuera de 24 h sin la plantilla con video aprobada sale la de siempre", () => {
    const m = mensajeRescate({ envio: { modo: "plantilla", plantilla }, texto, pasada: "primero", escenario: "adelanto_provincia", plantillasAprobadas: new Set(["aliv_recordatorio_adelanto"]) });
    expect(m.template?.name).toBe("aliv_recordatorio_adelanto");
    expect(m.template?.components).toBeUndefined();
    expect(m.attachments).toBeUndefined();
  });

  it("fuera de 24 h con la plantilla con video aprobada lleva el video de encabezado", () => {
    const m = mensajeRescate({
      envio: { modo: "plantilla", plantilla },
      texto,
      pasada: "primero",
      escenario: "adelanto_provincia",
      plantillasAprobadas: new Set(["aliv_recordatorio_adelanto", PLANTILLA_ADELANTO_VIDEO]),
    });
    expect(m.template?.name).toBe(PLANTILLA_ADELANTO_VIDEO);
    expect(m.template?.components).toEqual([
      { type: "header", parameters: [{ type: "video", video: { link: VIDEO_EMPAQUES_PREPARANDO } }] },
      { type: "body", parameters: ["Diego", "suplemento NAC600 + NAD+", "Cusco"].map((t) => ({ type: "text", text: t })) },
    ]);
  });
});
