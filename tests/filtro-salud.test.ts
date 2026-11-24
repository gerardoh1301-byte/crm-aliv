import { describe, expect, it } from "vitest";
import { corregirFrasesSalud } from "@/lib/agent/filtro-salud";

const PROHIBIDO = /detox|desintox|hep[aá]tic|salud de tu h[ií]gado|est[aá]ndares|certific/i;

describe("filtro de frases de salud (respuestas reales del evaluador 20/11)", () => {
  it("reemplaza la promesa sobre el hígado y conserva precios y cierre", () => {
    const t =
      "El NAC aporta cisteína, que ayuda a tu cuerpo a producir glutatión, un antioxidante que apoya la salud de tu hígado. Es un complemento ideal para tu día a día (debes consultarlo con tu médico tratante).\n\nEl pack de 3 frascos (90 días) está a *S/199* con envío gratis y sale a S/2,20 al día. ¿Te lo enviamos a Lima o a provincia?";
    const r = corregirFrasesSalud(t);
    expect(r.corregido).toBe(true);
    expect(r.texto).not.toMatch(PROHIBIDO);
    expect(r.texto).toContain("su principal antioxidante; es un complemento de bienestar, no un medicamento.");
    expect(r.texto).toMatch(/m[eé]dico/);
    expect(r.texto).toContain("*S/199*");
    expect(r.texto.trim().endsWith("¿Te lo enviamos a Lima o a provincia?")).toBe(true);
  });

  it("detoxificación y función hepática", () => {
    for (const t of [
      "El NAC es un precursor directo del glutatión, el antioxidante natural que apoya los procesos de detoxificación celular. Es un gran complemento diario. ¿Te lo separo?",
      "El NAC es precursor de glutatión, el antioxidante de tu cuerpo, y apoya la función hepática. Es un complemento y debes consultarlo con tu médico.",
      "El NAC aporta cisteína para que tu cuerpo produzca glutatión, el antioxidante clave para apoyar los procesos de detoxificación de tu hígado. Funciona como un complemento ideal junto a tus indicaciones médicas.",
    ]) {
      const r = corregirFrasesSalud(t);
      expect(r.texto, t).not.toMatch(PROHIBIDO);
      expect(r.texto).toContain("no un medicamento");
    }
    expect(corregirFrasesSalud("El NAC es precursor de glutatión y apoya la función hepática. Consúltalo con tu médico.").texto).toMatch(/médico/);
    const r = corregirFrasesSalud(
      "El NAC es el precursor metabólico del glutatión, el principal antioxidante del organismo, y apoya la salud y función celular del hígado. Recuerda que es un suplemento de bienestar y siempre debes consultarlo con tu médico tratante."
    );
    expect(r.texto).not.toMatch(/h[ií]gado/);
    expect(r.texto).toMatch(/médico/);
    expect(corregirFrasesSalud("Beneficia a tus riñones y al corazón. ¿Te lo envío?").corregido).toBe(true);
  });

  it("quita 'estándares' y 'certificaciones' sin tocar el resto", () => {
    const t =
      "El *NAC600 + NAD+* es un suplemento importado de Estados Unidos que cumple con los estándares de calidad de importación. Lo que sí te garantizamos: en Lima pagas recién cuando lo tienes en tus manos y tienes 30 días de garantía por fallas de fábrica.";
    const r = corregirFrasesSalud(t);
    expect(r.texto).toBe(
      "Es un producto importado de Estados Unidos. Lo que sí te garantizamos: en Lima pagas recién cuando lo tienes en tus manos y tienes 30 días de garantía por fallas de fábrica."
    );
    expect(corregirFrasesSalud("La Termix es importada de China y está certificada. ¿Te separo el par?").texto).toBe(
      "Es un producto importado de China. ¿Te separo el par?"
    );
    expect(corregirFrasesSalud("Es importado de Estados Unidos 🇺🇸, con altos estándares de calidad. / ¿Te lo enviamos a Lima?").texto).not.toMatch(/est[aá]ndares/);
  });

  it("otras promesas: curar, presión, glucosa, bajar de peso, desinflamar", () => {
    for (const t of [
      "La tobillera desinflama el tobillo en minutos. ¿Te separo el par?",
      "Ayuda a bajar la presión y regula la glucosa. ¿Te lo envío?",
      "Te ayuda a bajar de peso. ¿Te lo envío?",
      "Cura la fatiga crónica. ¿Te lo separo?",
    ]) {
      const r = corregirFrasesSalud(t);
      expect(r.corregido, t).toBe(true);
      expect(r.texto).not.toMatch(/desinflam|presi[oó]n|glucosa|bajar de peso|\bcura\b/i);
      expect(r.texto).toMatch(/\?$/);
    }
  });

  it("no toca respuestas permitidas", () => {
    for (const t of [
      "Perfecto, Luis. Para emitir tu guía oficial en Shalom, compárteme tu DNI y tu nombre completo.",
      "El NAC aporta cisteína, que el cuerpo usa para producir glutatión, su principal antioxidante. ¿Te separo el de 3?",
      "Si estás tomando medicamentos para la presión, te recomiendo consultarlo primero con tu médico tratante. ¿A qué distrito te lo enviamos?",
      "Si tienes hígado graso, es importante que lo consultes con tu médico antes de tomarlo. ¿Te lo dejo reservado?",
      "La *Termix* da calor de grafeno y masaje para los tobillos cansados. • 1 tobillera *S/79* • 2 tobilleras *S/139* ⭐ ¿Es para ti o para regalar?",
      "Procura tomarlo con el desayuno. ¿Te lo envío el lunes?",
      "",
    ]) {
      const r = corregirFrasesSalud(t);
      expect(r.corregido, t).toBe(false);
      expect(r.texto).toBe(t);
    }
  });

  it("si todo el mensaje era una promesa, deja una respuesta segura", () => {
    const r = corregirFrasesSalud("Limpia tu hígado y lo desintoxica.");
    expect(r.texto).toBe("Es un complemento de bienestar, no un medicamento.");
  });
});

describe("filtro de salud: chat del 23/11 (quedaba solo «Consúltalo con tu médico»)", () => {
  it("si la frase segura venía dentro de la frase quitada, se vuelve a poner", () => {
    const t =
      "NAC600 es un complemento de bienestar, no un medicamento, y apoya la salud de tu hígado; consúltalo con tu médico antes de tomarlo.\n\n¿Te gustaría que te reservemos el pack de 3 frascos por *S/199*?";
    const r = corregirFrasesSalud(t);
    expect(r.corregido).toBe(true);
    expect(r.texto).not.toMatch(/h[ií]gado/);
    expect(r.texto).toMatch(/no un medicamento/);
    expect(r.texto).toMatch(/médico/);
  });

  it("decir que NO cura ni controla enfermedades no se borra", () => {
    const t =
      "No es un medicamento, así que no cura ni controla enfermedades. Es un complemento antioxidante: el NAC aporta cisteína para que tu cuerpo produzca glutatión. Si tienes alguna condición o tomas medicinas, consúltalo con tu médico.\n\n¿Lo buscas para ti o para alguien de tu familia?";
    const r = corregirFrasesSalud(t);
    expect(r.corregido).toBe(false);
    expect(r.texto).toBe(t);
  });

  it("la negación no salva una promesa real en la misma frase", () => {
    const r = corregirFrasesSalud("No cura, pero limpia tu hígado. ¿Te lo envío?");
    expect(r.corregido).toBe(true);
    expect(r.texto).not.toMatch(/h[ií]gado/);
    expect(corregirFrasesSalud("Cura la gastritis. ¿Te lo envío?").corregido).toBe(true);
    expect(corregirFrasesSalud("Te ayuda a controlar la presión. ¿Te lo envío?").corregido).toBe(true);
  });
});
