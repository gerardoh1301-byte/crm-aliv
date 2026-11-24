import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { debeRepartir, normalizarPesos, siguienteTurno } from "@/lib/team/round-robin";

const leer = (rel: string) => fs.readFileSync(path.join(__dirname, "..", rel), "utf8");

describe("reparto por turnos con pesos (mejora 10)", () => {
  it("reparte según el peso sin rachas largas", () => {
    let estado = {};
    const orden: string[] = [];
    for (let i = 0; i < 6; i++) {
      const r = siguienteTurno({ a: 2, b: 1 }, estado);
      orden.push(r.memberId!);
      estado = r.estado;
    }
    expect(orden.filter((x) => x === "a")).toHaveLength(4);
    expect(orden.filter((x) => x === "b")).toHaveLength(2);
    expect(orden.join("")).not.toContain("aaa");
  });

  it("sin pesos no asigna a nadie", () => {
    expect(siguienteTurno({}, {}).memberId).toBeNull();
  });

  it("solo cuenta asesores activos con peso 1–10", () => {
    expect(normalizarPesos({ a: 3, b: 0, c: 50, x: 2 }, ["a", "b", "c"])).toEqual({ a: 3, c: 10 });
  });

  it("un cliente con asesor de la rueda se queda con él", () => {
    expect(debeRepartir("a", { a: 1, b: 1 })).toBe(false);
    expect(debeRepartir(null, { a: 1 })).toBe(true);
    expect(debeRepartir("viejo", { a: 1 })).toBe(true);
  });

  it("la bandeja filtra por etapa del pipeline", () => {
    expect(leer("src/components/conversations/ConversationsList.tsx")).toContain('id="filtro-etapa"');
    expect(leer("src/lib/conversations.ts")).toContain("pipeline_stages ps");
  });
});
