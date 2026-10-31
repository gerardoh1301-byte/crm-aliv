import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { firmarSesion, verificarSesion } from "@/lib/sesion-local";
import { ID_MIEMBRO_LOCAL } from "@/lib/modo-local";

/**
 * La cookie del acceso por PIN guardaba el id del miembro tal cual, y el id del admin
 * es fijo y publico (`modo-local.ts`): poner esa cookie a mano daba acceso de admin
 * sin PIN. Estos casos son los que no pueden volver a romperse.
 */

const ORIGINAL = { ...process.env };

beforeEach(() => {
  process.env.AGENT_WORKER_SECRET = "secreto-de-prueba-0123456789abcdef";
  delete process.env.SESSION_SECRET;
  delete process.env.MODO_LOCAL;
});

afterEach(() => {
  process.env = { ...ORIGINAL };
  vi.useRealTimers();
});

describe("sesion local firmada", () => {
  it("el id del admin a pelo ya no es una sesion valida", () => {
    expect(verificarSesion(ID_MIEMBRO_LOCAL)).toBeNull();
  });

  it("una cookie firmada por el servidor devuelve el miembro", () => {
    const valor = firmarSesion(ID_MIEMBRO_LOCAL);
    expect(valor).not.toBeNull();
    expect(verificarSesion(valor)).toBe(ID_MIEMBRO_LOCAL);
  });

  it("cambiar el miembro invalida la firma", () => {
    const valor = firmarSesion("00000000-0000-4000-8000-000000000002")!;
    const [, expira, firma] = valor.split(".");
    expect(verificarSesion(`${ID_MIEMBRO_LOCAL}.${expira}.${firma}`)).toBeNull();
  });

  it("rotar el secreto cierra las sesiones abiertas", () => {
    const valor = firmarSesion(ID_MIEMBRO_LOCAL);
    process.env.SESSION_SECRET = "otro-secreto-distinto-0123456789";
    expect(verificarSesion(valor)).toBeNull();
  });

  it("una sesion vencida no sirve", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const valor = firmarSesion(ID_MIEMBRO_LOCAL);
    vi.setSystemTime(new Date("2026-03-01T00:00:00Z"));
    expect(verificarSesion(valor)).toBeNull();
  });

  it("en la nube sin secreto no firma ni acepta nada", () => {
    delete process.env.AGENT_WORKER_SECRET;
    expect(firmarSesion(ID_MIEMBRO_LOCAL)).toBeNull();
    expect(verificarSesion("x.y.z")).toBeNull();
  });
});
