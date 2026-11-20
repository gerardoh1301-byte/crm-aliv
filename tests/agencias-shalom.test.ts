import { describe, expect, it } from "vitest";
import { buscarAgenciaShalomCercana } from "@/lib/agencias/shalom-directorio";
import { AGENCIAS_SHALOM_OFICIALES } from "@/lib/agencias/shalom-agencias-oficiales";

const n = (s?: string | null) =>
  (s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/ provincias?$/, "").trim();

describe("buscador de agencias Shalom", () => {
  it("propone una agencia del mismo departamento para casi todas las localidades del padrón", () => {
    let ok = 0;
    let total = 0;
    const vistos = new Set<string>();
    for (const a of AGENCIAS_SHALOM_OFICIALES) {
      const ciudad = a.zona || a.distrito;
      if (!ciudad || vistos.has(ciudad)) continue;
      vistos.add(ciudad);
      total++;
      const r = buscarAgenciaShalomCercana({ ciudad });
      if (r.mejorOpcion && n(r.mejorOpcion.departamento) === n(a.departamento)) ok++;
    }
    // Antes del arreglo: 179 de 273 (las ciudades sin match caían en Sullana).
    expect(ok / total).toBeGreaterThan(0.97);
  });

  it("no inventa una agencia lejana cuando la ciudad no existe", () => {
    expect(buscarAgenciaShalomCercana({ ciudad: "Xyzabc" }).mejorOpcion).toBeNull();
  });

  it("resuelve ciudades que antes caían en Sullana", () => {
    for (const [ciudad, esperado] of [
      ["Chachapoyas", "chachapoyas"],
      ["Pichanaqui", "pichanaqui"],
      ["Satipo", "satipo"],
      ["Cutervo", "cutervo"],
      ["Sicuani", "sicuani"],
    ]) {
      const r = buscarAgenciaShalomCercana({ ciudad });
      expect(n(r.mejorOpcion?.nombre), ciudad).toContain(esperado);
    }
    expect(n(buscarAgenciaShalomCercana({ ciudad: "Arequipa", distrito: "Cayma" }).mejorOpcion?.nombre)).toContain("cayma");
  });
});
