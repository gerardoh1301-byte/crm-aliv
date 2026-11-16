import { describe, expect, it } from "vitest";
import { buscarAgenciaShalomCercana } from "@/lib/agencias/shalom-directorio";

describe("Directorio y Búsqueda de Agencias Shalom Cercanas en Provincia", () => {
  it("ubica agencia Santa Rosa en Sullana cuando el cliente indica Sta Rosa o Calle Dos", () => {
    const res = buscarAgenciaShalomCercana({
      ciudad: "Sullana",
      direccion: "Calle Dos Nro 857 - Sta Rosa",
    });

    expect(res.mejorOpcion).toBeDefined();
    expect(res.mejorOpcion?.id).toBe("sullana-santa-rosa");
    expect(res.mejorOpcion?.direccion).toBe("Jr. Santa Rosa 450");
    expect(res.propuestaMensaje).toContain("Shalom Sullana - Santa Rosa");
  });

  it("ubica agencia Av. Parra en Arequipa como principal o por calle", () => {
    const res = buscarAgenciaShalomCercana({
      ciudad: "Arequipa",
      direccion: "Cerca al centro o Av. Parra",
    });

    expect(res.mejorOpcion).toBeDefined();
    expect(res.mejorOpcion?.id).toBe("arequipa-parra");
    expect(res.mejorOpcion?.direccion).toBe("Av. Parra 379");
  });

  it("ubica agencia Cerro Colorado en Arequipa si el cliente está en ese distrito", () => {
    const res = buscarAgenciaShalomCercana({
      ciudad: "Arequipa",
      distrito: "Cerro Colorado",
      direccion: "Por la vía de Evitamiento o Zamácola",
    });

    expect(res.mejorOpcion).toBeDefined();
    expect(res.mejorOpcion?.id).toBe("arequipa-cerro-colorado");
  });

  it("ubica agencia José Leonardo Ortiz en Chiclayo", () => {
    const res = buscarAgenciaShalomCercana({
      ciudad: "Chiclayo",
      distrito: "José Leonardo Ortiz",
      direccion: "Av. Chiclayo cerca a Moshoqueque",
    });

    expect(res.mejorOpcion).toBeDefined();
    expect(res.mejorOpcion?.id).toBe("chiclayo-jlo");
  });

  it("ubica agencia principal de Trujillo (Mansiche) si solo se conoce la ciudad", () => {
    const res = buscarAgenciaShalomCercana({
      ciudad: "Trujillo",
    });

    expect(res.mejorOpcion).toBeDefined();
    expect(res.mejorOpcion?.id).toBe("trujillo-mansiche");
  });

  it("ubica agencia El Tambo / Mariscal Castilla en Huancayo", () => {
    const res = buscarAgenciaShalomCercana({
      ciudad: "Huancayo",
      distrito: "El Tambo",
    });

    expect(res.mejorOpcion).toBeDefined();
    expect(res.mejorOpcion?.id).toBe("huancayo-castilla");
  });

  it("REQUERIMIENTO AUDIO: ubica agencia más cercana por dirección completa en provincia y la propone como primera opción", () => {
    const res = buscarAgenciaShalomCercana({
      direccion: "Vivo en Sullana calle dos 857",
    });

    expect(res.mejorOpcion).toBeDefined();
    expect(res.mejorOpcion?.id).toBe("sullana-santa-rosa");
    expect(res.mejorOpcion?.direccion).toBe("Jr. Santa Rosa 450");
    expect(res.propuestaMensaje).toContain("*Shalom Sullana - Santa Rosa*");
    expect(res.propuestaMensaje).toContain("Jr. Santa Rosa 450");
    expect(res.propuestaMensaje).toContain("¿Te parece bien que lo programemos a esa agencia o prefieres otra?");
  });

  it("REQUERIMIENTO AUDIO: discrimina distrito específico en provincia frente a la sede principal", () => {
    const res = buscarAgenciaShalomCercana({
      direccion: "Arequipa cerro colorado",
    });

    expect(res.mejorOpcion).toBeDefined();
    expect(res.mejorOpcion?.id).toBe("arequipa-cerro-colorado");
    expect(res.mejorOpcion?.direccion).toBe("Av. Villa Hermosa 215");
  });
});
