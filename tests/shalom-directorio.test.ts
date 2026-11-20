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

  it("detecta múltiples agencias en Pucallpa cuando el cliente no especifica sede o calle", () => {
    const res = buscarAgenciaShalomCercana({
      ciudad: "Pucallpa",
    });

    expect(res.multiplesAgenciasEnCiudad).toBe(true);
    expect(res.todasDeCiudad && res.todasDeCiudad.length).toBeGreaterThanOrEqual(4);
    expect(res.propuestaMensaje).toContain("En Pucallpa contamos con varias agencias de Shalom");
    expect(res.propuestaMensaje).toContain("Jr. José Gálvez 147");
    expect(res.propuestaMensaje).toContain("Yarinacocha");
  });

  it("discrimina agencia específica en Pucallpa si el cliente da distrito o referencia", () => {
    const resYarina = buscarAgenciaShalomCercana({
      ciudad: "Pucallpa",
      distrito: "Yarinacocha",
    });
    // Vale la curada o la del padrón oficial de Shalom: ambas están en Yarinacocha.
    expect(resYarina.mejorOpcion?.nombre.toLowerCase()).toContain("yarinacocha");

    const resManantay = buscarAgenciaShalomCercana({
      ciudad: "Pucallpa",
      direccion: "Por el mercado San Fernando en Manantay",
    });
    expect(resManantay.mejorOpcion?.id).toBe("pucallpa-manantay");
  });

  it("identifica al 100% las agencias oficiales de Pisco (La Villa Cruce Pisco vs Centro Valdelomar)", () => {
    const resCruce = buscarAgenciaShalomCercana({
      ciudad: "Pisco",
      direccion: "Cerca al cruce de la Panamericana o La Villa",
    });
    expect(resCruce.mejorOpcion?.id).toBe("shalom-472-vla");
    expect(resCruce.mejorOpcion?.nombre).toContain("La Villa (Cruce Pisco)");
    expect(resCruce.mejorOpcion?.direccion).toContain("Villa Los Ángeles");

    const resValdelomar = buscarAgenciaShalomCercana({
      ciudad: "Pisco",
      direccion: "Por la Posta San Martín en Valdelomar",
    });
    expect(resValdelomar.mejorOpcion?.id).toBe("shalom-56-pis");
    expect(resValdelomar.mejorOpcion?.nombre).toContain("Abraham Valdelomar");
  });
});
