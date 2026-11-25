import { describe, expect, it } from "vitest";
import { quitarHorarioInventado } from "@/lib/agent/postulante";

describe("postulante: no inventa el horario", () => {
  it("cambia la frase del horario inventado del 24/11", () => {
    const real =
      "¡Excelente experiencia en ventas por canal telefónico y televisión!\n\nSobre el horario, trabajamos en turnos coordinados de lunes a sábado de 8:30 a. m. a 6:00 p. m. (con los 5 días virtuales y 1 día presencial en La Molina). El equipo de selección se pondrá en contacto contigo muy pronto. ¡Muchos éxitos! 🌿";
    const r = quitarHorarioInventado(real);
    expect(r).not.toMatch(/8:30|6:00|lunes a s[áa]bado/);
    expect(r).toContain("El horario exacto te lo confirma el equipo cuando te contacte.");
    expect(r).toContain("¡Excelente experiencia");
    expect(r).toContain("El equipo de selección se pondrá en contacto contigo muy pronto.");
  });

  it("deja igual la explicación normal del puesto", () => {
    const t = "Modalidad: 5 días virtuales y 1 día presencial en La Molina. Pago: S/600 mensuales fijos + 2%. Requisitos: mayor de 23 años.";
    expect(quitarHorarioInventado(t)).toBe(t);
  });

  it("varias frases con horario dejan una sola respuesta", () => {
    const r = quitarHorarioInventado("Entras a las 9 am. Sales a las 6 pm. ¿Te parece?");
    expect(r).toBe("El horario exacto te lo confirma el equipo cuando te contacte. ¿Te parece?");
  });

  it("cambia «tiempo completo» inventado del 25/11", () => {
    const real =
      "El puesto es a tiempo completo (jornada completa); los detalles exactos del horario y los turnos te los confirmará el equipo de selección cuando te contacten. Cuéntame, ¿tienes experiencia previa en atención al cliente, call center o ventas?";
    const r = quitarHorarioInventado(real);
    expect(r).not.toMatch(/tiempo completo|jornada completa/i);
    expect(r).toContain("La jornada y el horario exactos te los confirma el equipo cuando te contacte.");
    expect(r).toContain("¿tienes experiencia previa");
  });

  it("dice part-time inventado", () => {
    const r = quitarHorarioInventado("Sí, es part-time. Cuéntame tu experiencia.");
    expect(r).toBe("La jornada y el horario exactos te los confirma el equipo cuando te contacte. Cuéntame tu experiencia.");
  });

  it("deja la respuesta correcta que remite al equipo", () => {
    const t = "Si es part-time o tiempo completo te lo confirma el equipo cuando te contacte. ¿Me cuentas tu experiencia?";
    expect(quitarHorarioInventado(t)).toBe(t);
  });
});
