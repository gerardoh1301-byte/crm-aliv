import { describe, it, expect } from "vitest";
import { buscarAgenciaShalomCercana } from "@/lib/agencias/shalom-directorio";

describe("Directorio y Requisitos de Despacho Shalom para Provincia", () => {
  it("reconoce múltiples agencias oficiales en Iquitos y las lista con sus direcciones", () => {
    const res = buscarAgenciaShalomCercana({ ciudad: "Iquitos" });
    expect(res.multiplesAgenciasEnCiudad).toBe(true);
    expect(res.todasDeCiudad).toBeDefined();
    expect(res.todasDeCiudad!.length).toBeGreaterThanOrEqual(5);

    const nombres = res.todasDeCiudad!.map((a) => a.nombre.toLowerCase()).join(" ");
    expect(nombres).toContain("bolognesi");
    expect(nombres).toContain("pablo rossel");
    expect(nombres).toContain("túpac amaru");
  });

  it("ubica agencia específica en Iquitos si el cliente menciona calle o referencia", () => {
    const res = buscarAgenciaShalomCercana({ ciudad: "Iquitos", direccion: "cerca a la unap en bolognesi" });
    expect(res.mejorOpcion).toBeDefined();
    expect(res.mejorOpcion!.nombre.toLowerCase()).toContain("bolognesi");
  });
});
