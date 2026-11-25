import { describe, expect, it } from "vitest";
import { BLOQUE_POSTULANTE, esPostulante, vieneDeAnuncioEmpleo } from "@/lib/agent/postulante";

describe("esPostulante", () => {
  it("detecta el mensaje del aviso de empleo", () => {
    expect(esPostulante([{ role: "user", content: "Hola, quiero postular al puesto de Asesor comercial" }])).toBe(true);
  });
  it("acepta asesora y asesor(a) en cualquier mensaje del cliente", () => {
    expect(esPostulante([{ role: "user", content: "hola" }, { role: "user", content: "es por lo de asesora comercial" }])).toBe(true);
    expect(esPostulante([{ role: "user", content: "vi el aviso de ASESOR(A) COMERCIAL" }])).toBe(true);
  });
  it("caso 955 424 136 (24/11): el primer mensaje llegó vacío y siguió con trabajo remoto", () => {
    const u = (content: string) => ({ role: "user", content });
    expect(esPostulante([u("[Unsupported message]")])).toBe(false);
    expect(esPostulante([u("[Unsupported message]"), u("Vengo por lo del trabajo remoro")])).toBe(true);
    expect(esPostulante([u('En su anuncio decía "asesor de confirmaciones"')])).toBe(true);
    expect(esPostulante([u("Hola, vi la convocatoria")])).toBe(true);
    expect(esPostulante([u("quiero postular")])).toBe(true);
    expect(esPostulante([u("hay vacante todavía?")])).toBe(true);
  });
  it("detecta el anuncio de empleo aunque el cliente no escriba nada de empleo", () => {
    const md = { ctwa_headline: "Empleo: Asesor(a) de confirmaciones", ctwa_body: "¡Estamos contratando en Aliv Perú!" };
    expect(vieneDeAnuncioEmpleo(md)).toBe(true);
    expect(esPostulante([{ role: "user", content: "Hola" }], md)).toBe(true);
    expect(vieneDeAnuncioEmpleo({ ctwa_headline: "NAC600 + NAD+ envío gratis" })).toBe(false);
    expect(vieneDeAnuncioEmpleo(null)).toBe(false);
  });
  it("los clientes que hablan de su trabajo no son postulantes", () => {
    for (const t of ["estoy en el trabajo, luego te escribo", "trabajo hasta las 6, mándalo a mi casa", "me lo envían a mi trabajo en Miraflores", "para mi esposo que trabaja de pie"]) {
      expect(esPostulante([{ role: "user", content: t }])).toBe(false);
    }
  });
  it("no se activa con clientes normales ni con textos del bot", () => {
    expect(esPostulante([{ role: "user", content: "Quiero más información del NAC600" }])).toBe(false);
    expect(esPostulante([{ role: "assistant", content: "Un asesor comercial te escribirá" }])).toBe(false);
  });
});

describe("BLOQUE_POSTULANTE", () => {
  it("lleva las condiciones del puesto y no pide CV", () => {
    expect(BLOQUE_POSTULANTE).toContain("5 días virtuales y 1 día presencial en La Molina");
    expect(BLOQUE_POSTULANTE).toContain("S/600 mensuales fijos + 2%");
    expect(BLOQUE_POSTULANTE).toContain("30 órdenes al día");
    expect(BLOQUE_POSTULANTE).toContain("NO pidas CV");
    expect(BLOQUE_POSTULANTE).toContain("Asesor(a) de confirmaciones");
    expect(BLOQUE_POSTULANTE).toContain("nunca le digas que no hay empleo");
  });
});

describe("reglas del modo postulante (revisión 24/11)", () => {
  it("no descarta por provincia, no pide datos extra y responde part-time", () => {
    expect(BLOQUE_POSTULANTE).toContain("NUNCA descartes ni desanimes");
    expect(BLOQUE_POSTULANTE).toContain("provincia");
    expect(BLOQUE_POSTULANTE).toContain("No pidas datos que no estén aquí");
    expect(BLOQUE_POSTULANTE).toMatch(/part-time/);
  });
});

import { BLOQUE_MENSAJE_ILEGIBLE, primerMensajeIlegible } from "@/lib/agent/postulante";

describe("primer mensaje que Meta no entregó (131060)", () => {
  it("lo detecta aunque después escriba otra cosa (caso 991420348)", () => {
    expect(
      primerMensajeIlegible([
        { role: "user", content: "[Unsupported message]" },
        { role: "assistant", content: "¡Hola!" },
        { role: "user", content: "Hola, es para mi" },
      ])
    ).toBe(true);
    expect(primerMensajeIlegible([{ role: "user", content: "[Unsupported message]\nHola" }])).toBe(true);
  });

  it("un chat normal no cambia", () => {
    expect(primerMensajeIlegible([{ role: "user", content: "Hola, quiero info del NAC600" }])).toBe(false);
  });

  it("el bloque pide aclarar producto o empleo y prohíbe vender antes", () => {
    expect(BLOQUE_MENSAJE_ILEGIBLE).toContain("aviso de empleo");
    expect(BLOQUE_MENSAJE_ILEGIBLE).toContain("NO ofrezcas productos");
  });

  it("al responder «por el empleo» ya entra en modo postulante", () => {
    expect(esPostulante([{ role: "user", content: "[Unsupported message]" }, { role: "user", content: "por el empleo" }])).toBe(true);
  });
});

describe("indicaPostulante (25/11: Flor, 958479456)", () => {
  it("detecta por el anuncio, por «remoto» del cliente y por lo que escribe el equipo", async () => {
    const { indicaPostulante } = await import("@/lib/agent/postulante");
    expect(indicaPostulante({ direction: "in", body: "Me interesa todo Remoto" })).toBe(true);
    expect(indicaPostulante({ direction: "out", body: "Por favor, agenda una reunión: https://calendar.app.google/4Vjx" })).toBe(true);
    expect(indicaPostulante({ direction: "out", body: "Estamos buscando un/a Asesor(a) de confirmaciones para nuestro equipo" })).toBe(true);
    expect(indicaPostulante({ direction: "in", body: null, metadata: { ctwa_headline: "Empleo: Asesor(a) de confirmaciones" } })).toBe(true);
  });

  it("no marca a un cliente normal", async () => {
    const { indicaPostulante } = await import("@/lib/agent/postulante");
    expect(indicaPostulante({ direction: "in", body: "Quiero 3 frascos de NAC600, estoy en el trabajo" })).toBe(false);
    expect(indicaPostulante({ direction: "out", body: "¿Te gustaría empezar con 1 frasco de S/119?" })).toBe(false);
    expect(indicaPostulante({ direction: "in", body: "hola", metadata: { ctwa_headline: "NAC600 + NAD+" } })).toBe(false);
  });
});
