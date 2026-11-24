import { describe, expect, it } from "vitest";
import { fechaLegible, mensajeRespaldoTrasHerramientas } from "@/lib/agent/respaldo-sin-ia";

const agendar = {
  nombre: "agendar_entrega",
  args: { tipo: "entrega", fecha: "2026-11-24", horario: "A partir de las 2:00 pm", descripcion: "Pedido #1175", monto: 189 },
  ok: true,
};

describe("respuesta sin IA tras herramientas (pedido #1175, 23/11)", () => {
  it("confirma la entrega agendada con día y horario, y termina en pregunta", () => {
    const t = mensajeRespaldoTrasHerramientas({
      nombre: "Fernando",
      herramientas: [agendar, { nombre: "avisar_asesor", args: {}, ok: true }],
    });
    expect(t).toContain("¡Listo, Fernando!");
    expect(t).toContain("el martes 24 de noviembre (A partir de las 2:00 pm)");
    expect(t).toMatch(/\?\s*📍$/u);
    expect(t).not.toMatch(/Disculpa la demora/);
  });

  it("usa el texto que el modelo ya había escrito si todo salió bien", () => {
    expect(
      mensajeRespaldoTrasHerramientas({ nombre: "Ana", herramientas: [agendar], textoParcial: "¡Perfecto, Ana! Queda para el martes." })
    ).toBe("¡Perfecto, Ana! Queda para el martes.");
  });

  it("no usa el texto del modelo si alguna herramienta falló", () => {
    const t = mensajeRespaldoTrasHerramientas({
      nombre: "Ana",
      herramientas: [{ nombre: "crear_pedido_chat", args: {}, ok: false }],
      textoParcial: "Tu pedido ya quedó registrado.",
    });
    expect(t).toBeNull();
  });

  it("sin entrega agendada ni texto: null (sigue el aviso de siempre)", () => {
    expect(mensajeRespaldoTrasHerramientas({ nombre: "Ana", herramientas: [{ nombre: "asignar_etiqueta", args: {}, ok: true }] })).toBeNull();
    expect(
      mensajeRespaldoTrasHerramientas({ nombre: "Ana", herramientas: [{ ...agendar, args: { ...agendar.args, tipo: "llamada" } }] })
    ).toBeNull();
  });

  it("no saluda con un nombre que es un número", () => {
    const t = mensajeRespaldoTrasHerramientas({ nombre: "+51997359437", herramientas: [agendar] });
    expect(t?.startsWith("¡Listo! 🙌")).toBe(true);
  });

  it("fecha legible", () => {
    expect(fechaLegible("2026-11-24")).toBe("el martes 24 de noviembre");
    expect(fechaLegible("mañana")).toBeNull();
  });
});
