import { describe, expect, it } from "vitest";
import { resolverAgenciaOficial } from "@/lib/agencias/shalom-directorio";

const nombre = (texto: string, ciudad?: string) => resolverAgenciaOficial({ texto, ciudad }).agencia?.direccion ?? null;

describe("agencia Shalom confirmada contra el directorio oficial", () => {
  it("Av. Centenario Km 6.800 en Pucallpa es la agencia de la Carretera Federico Basadre Km 6.800", () => {
    expect(nombre("Av. Centenario Km 6.800, Yarinacocha", "Pucallpa")).toMatch(/FEDERICO BASADRE KM 6\.800/i);
  });
  it("Av. Centenario Km 4.2 no existe: no se da por confirmada y se ofrecen opciones reales", () => {
    const r = resolverAgenciaOficial({ texto: "Agencia Shalom Pucallpa (Av. Centenario Km 4.2)", ciudad: "Pucallpa" });
    expect(r.agencia).toBeNull();
    expect(r.motivo).toBe("km_distinto");
    expect(r.opciones.length).toBeGreaterThan(1);
  });
  it("Yarinacocha Centro es la sede de Jr. Túpac Amaru", () => {
    expect(nombre("Shalom Yarinacocha Centro", "Pucallpa")).toMatch(/TUPAC AMARU, MZ\. 50/i);
  });
  it("solo la ciudad no basta cuando hay varias agencias", () => {
    expect(resolverAgenciaOficial({ texto: "Pucallpa", ciudad: "Pucallpa" }).agencia).toBeNull();
  });
  it("agencia de Cutervo en Ica es la sede ICA AV. JJ ELIAS (cruce con Av. Cutervo)", () => {
    expect(resolverAgenciaOficial({ texto: "Agencia de cutervo Ica", ciudad: "Ica" }).agencia?.distrito).toMatch(/jj elias/i);
  });
  it("Los Próceres Mz. Pp2 en Los Olivos no se confunde con Próceres Mz. 3", () => {
    expect(nombre("Av. Los Próceres Mz. Pp2 Lt.21", "Los Olivos")).toMatch(/PP2/i);
  });
  it("una agencia curada a mano que no está en el padrón oficial no se confirma", () => {
    expect(nombre("Av. Centenario Km 4.2", "Pucallpa")).toBeNull();
  });
});

describe("padrón de agencias que propone el bot", () => {
  it("toda agencia curada que se propone existe en el padrón oficial", async () => {
    const { AGENCIAS_SHALOM_PERU } = await import("@/lib/agencias/shalom-directorio");
    const sinOficial = AGENCIAS_SHALOM_PERU.filter(
      (a) =>
        a.curada &&
        !resolverAgenciaOficial({ texto: `${a.direccion} ${a.referencia ?? ""}`, ciudad: a.provincia }).agencia &&
        !resolverAgenciaOficial({ texto: a.direccion, ciudad: a.departamento }).agencia
    ).map((a) => a.id);
    expect(sinOficial).toEqual([]);
  });
  it("ya no se propone la Av. Centenario Km 4.2 en Pucallpa", async () => {
    const { buscarAgenciaShalomCercana } = await import("@/lib/agencias/shalom-directorio");
    const r = buscarAgenciaShalomCercana({ ciudad: "Pucallpa", direccion: "Av. Centenario" });
    const todas = [r.mejorOpcion, ...r.otrasOpciones, ...(r.todasDeCiudad ?? [])].map((a) => a?.direccion ?? "");
    expect(todas.some((d) => /km 4\.2/i.test(d))).toBe(false);
  });
});

describe("sede por nombre con Shalom mal escrito (25/11, #1181)", () => {
  it("«En shallon PAITA» es la única sede Paita", () => {
    const r = resolverAgenciaOficial({ texto: "En shallon PAITA", ciudad: "Piura paita" });
    expect(r.motivo).toBe("exacta");
    expect(r.agencia?.nombre).toBe("Shalom Paita");
  });
  it("solo la ciudad, sin nombrar Shalom ni agencia, no basta", () => {
    expect(resolverAgenciaOficial({ texto: "en paita", ciudad: "Piura paita" }).motivo).not.toBe("exacta");
  });
});
