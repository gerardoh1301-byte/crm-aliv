/**
 * Filtro determinista de frases de salud y de calidad prohibidas (reglas 2 y 3 del prompt).
 *
 * El modelo a veces escribe "apoya la salud de tu hígado", "detoxificación" o "cumple con
 * estándares de calidad" aunque el prompt lo prohíbe. Este filtro revisa cada frase antes de
 * enviarla: si una frase hace una promesa de salud la reemplaza por una frase segura (una sola
 * vez) y si habla de estándares, certificaciones o normas la quita. El resto del mensaje,
 * incluida la pregunta de cierre, queda igual.
 *
 * Lo que SÍ se permite: mencionar la enfermedad que nombró el cliente para derivarlo al médico
 * ("si tienes hígado graso, consúltalo con tu médico"), glutatión, antioxidante y energía.
 */

/** Promesas de salud: beneficio sobre un órgano o una enfermedad, curar, desintoxicar. */
const PROMESAS_SALUD: RegExp[] = [
  /detox|desintox/i,
  /funci[oó]n\s+hep[aá]tica|salud\s+hep[aá]tica|\bhep[aá]tic[oa]s?\b/i,
  /salud\s+(?:de\s+tu\s+|del\s+|de\s+su\s+)h[ií]gado/i,
  /\b(?:limpi|proteg|cuid|desinflam|regener|repar|fortalec|depur|sana|mejora)\w*\s+(?:a\s+|de\s+)?(?:el\s+|tu\s+|su\s+|al\s+|la\s+)?(?:h[ií]gado|ri[nñ]ones?|coraz[oó]n|pulmones?|articulaciones?)/i,
  /\bdesinflam\w*/i,
  /\bcur(?:a|an|ar|ará|aría)\b/i,
  /\b(?:previene|prevenir|evita|evitar)\s+(?:el\s+|la\s+|las\s+|los\s+)?(?:enfermedad|c[aá]ncer|diabetes|h[ií]gado\s+graso|infarto|envejecimiento)/i,
  /\b(?:baja|bajar|regula|regular|controla|controlar|reduce|reducir|normaliza|normalizar)\w*\s+(?:la\s+|el\s+|tu\s+|los\s+|las\s+)?(?:presi[oó]n|glucosa|az[uú]car|colesterol|triglic[eé]ridos|grasa\s+del\s+h[ií]gado)/i,
  /\bbajar\s+de\s+peso|\badelgaz/i,
  /\btratamiento\s+(?:para|del|de\s+la)\b/i,
  /resultados\s+garantizad|garantiza(?:mos)?\s+(?:los\s+)?resultados/i,
];

/** Afirmaciones de calidad o registro que no podemos sostener (regla 3). */
const CALIDAD_PROHIBIDA: RegExp[] = [
  /est[aá]ndares?/i,
  /certificad[oa]s?|certificaci[oó]n(?:es)?/i,
  /\bnormas?\s+(?:de\s+calidad|sanitarias?|internacionales)/i,
  /cumple\s+con\s+(?:las\s+|los\s+|todas?\s+)?(?:normas|requisitos|regulaciones|exigencias)/i,
  /aprobad[oa]\s+por\s+(?:la\s+)?(?:digesa|fda|minsa)/i,
];

const FRASE_SEGURA_SALUD = "Es un complemento de bienestar, no un medicamento.";
const FRASE_MEDICO = "Consúltalo con tu médico antes de tomarlo.";
const FRASE_SEGURA_NAC =
  "El NAC aporta cisteína para que tu cuerpo produzca glutatión, su principal antioxidante; es un complemento de bienestar, no un medicamento.";

export interface ResultadoFiltroSalud {
  texto: string;
  corregido: boolean;
  frasesQuitadas: string[];
}

// Órgano o enfermedad + un verbo de beneficio en la misma frase ("apoya la salud y función
// celular del hígado", "beneficia a tus riñones"). Mencionarlos solo para mandar al médico
// ("si tienes hígado graso, consúltalo con tu médico") no tiene verbo de beneficio y pasa.
const ORGANO_O_ENFERMEDAD =
  /h[ií]gado|ri[nñ][oó]n(?:es)?|coraz[oó]n|cerebr|pulm[oó]n|colesterol|glucosa|diabetes|presi[oó]n\s+arterial|tiroides|pr[oó]stata|artritis|artrosis/i;
const VERBO_BENEFICIO =
  /\b(?:apoy|ayud|favorec|benefici|mejor|cuid|protec|proteg|limpi|regener|nutr|fortalec|equilibr|optimiz|potenci|revitaliz|restaur|sostien|sosten)\w*|\bsalud\b|\bfunci[oó]n\b|\bbueno\s+para\b/i;

function infringe(frase: string, reglas: RegExp[]): boolean {
  if (reglas === PROMESAS_SALUD && ORGANO_O_ENFERMEDAD.test(frase) && VERBO_BENEFICIO.test(frase)) return true;
  return reglas.some((re) => re.test(frase));
}

/** Parte una línea en frases conservando la puntuación final y los emojis pegados. */
function frasesDe(linea: string): string[] {
  return linea.match(/[^.!?¿¡]*(?:[¿¡][^?!]*[?!]|[^.!?]+(?:[.!?]+|$))\s*[\p{Extended_Pictographic}️‍\s]*/gu)?.filter((f) => f.trim()) ?? [linea];
}

export function corregirFrasesSalud(texto: string): ResultadoFiltroSalud {
  const original = texto ?? "";
  if (!original.trim()) return { texto: original, corregido: false, frasesQuitadas: [] };

  const frasesQuitadas: string[] = [];
  let usoFraseSegura = /complemento de bienestar|no un medicamento/i.test(original);

  const lineas = original.split("\n").map((linea) => {
    if (!linea.trim()) return linea;
    const frases = frasesDe(linea);
    const reconstruida = frases
      .map((frase) => {
        // Una pregunta de cierre nunca se toca (no lleva promesas, y quitarla rompe la venta).
        const esPregunta = /\?\s*[\p{Extended_Pictographic}️‍\s]*$/u.test(frase);
        if (infringe(frase, PROMESAS_SALUD) && !esPregunta) {
          frasesQuitadas.push(frase.trim());
          const espacio = /\s$/.test(frase) ? " " : "";
          // Si la frase también mandaba al médico (regla 2), ese consejo se conserva.
          const conMedico = /m[eé]dic|doctor|especialista/i.test(frase);
          const partes: string[] = [];
          if (!usoFraseSegura) partes.push(/glutati|\bnac\b|cisteína/i.test(frase) ? FRASE_SEGURA_NAC : FRASE_SEGURA_SALUD);
          if (conMedico) partes.push(FRASE_MEDICO);
          usoFraseSegura = true;
          return partes.length ? partes.join(" ") + espacio : "";
        }
        if (infringe(frase, CALIDAD_PROHIBIDA) && !esPregunta) {
          frasesQuitadas.push(frase.trim());
          // Si la frase respondía el origen, se conserva solo eso (regla 3: "es importado").
          if (/importad/i.test(frase)) {
            const espacio = /\s$/.test(frase) ? " " : "";
            const origen = /china/i.test(frase) ? " de China" : /estados unidos|ee\.? ?uu/i.test(frase) ? " de Estados Unidos" : "";
            return `Es un producto importado${origen}.` + espacio;
          }
          return "";
        }
        return frase;
      })
      .join("")
      .replace(/[ \t]{2,}/g, " ")
      .trim();
    return reconstruida;
  });

  if (!frasesQuitadas.length) return { texto: original, corregido: false, frasesQuitadas };

  let resultado = lineas
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  // Una pregunta que llevaba la promesa adentro ("¿Quieres cuidar tu hígado?") se reemplaza entera.
  for (const re of PROMESAS_SALUD) {
    if (re.test(resultado)) {
      resultado = resultado
        .split("\n")
        .filter((l) => !re.test(l))
        .join("\n")
        .trim();
    }
  }
  if (!resultado) resultado = `${FRASE_SEGURA_SALUD} ¿Te lo dejo reservado?`;
  return { texto: resultado, corregido: true, frasesQuitadas };
}
