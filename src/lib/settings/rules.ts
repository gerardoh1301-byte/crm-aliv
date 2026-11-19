import "server-only";
import { db } from "@/db";
import { crmSettings } from "@/db/schema";
import { eq } from "drizzle-orm";

export const BUSINESS_RULES_KEY = "business_rules_and_faqs";

export interface FaqItem {
  pregunta: string;
  respuesta: string;
}

export interface BusinessRulesData {
  faqs: FaqItem[];
  politicas: string;
  promocionesTemporales: string;
  horariosAtencion: string;
}

export const DEFAULT_BUSINESS_RULES: BusinessRulesData = {
  faqs: [
    {
      pregunta: "¿Cómo se debe tomar el NAC600 + NAD+?",
      respuesta: "Se toman 2 cápsulas al día con abundante agua, preferentemente por la mañana con el desayuno.",
    },
    {
      pregunta: "¿La Tobillera Termix es para pie izquierdo o derecho?",
      respuesta: "Es de talla universal y sirve indistintamente para el pie izquierdo o derecho, adaptándose de 18 a 34 cm de contorno con su correa reforzada.",
    },
    {
      pregunta: "¿Cuánto demora en llegar mi pedido a provincia por Shalom?",
      respuesta: "Generalmente de 24 a 48 horas hábiles según la ciudad de destino. Se envía número de orden y código para rastreo en tiempo real.",
    },
  ],
  politicas: "Garantía de satisfacción de 30 días para todos nuestros productos. En Lima se paga contraentrega. En provincia se abona adelanto de S/20 para emitir la guía de remisión oficial de Shalom.",
  promocionesTemporales: "NAC600: 1 frasco S/ 119, 2 frascos S/ 189, 3 frascos S/ 199 con envío gratis. Termix Tobillera: 1x S/ 79, 2x S/ 139, 3x S/ 189 con envío gratis.",
  horariosAtencion: "Lunes a Sábado de 8:30 am a 8:00 pm. Despachos diarios a Lima y salidas a provincia por agencia Shalom.",
};

export async function getBusinessRules(): Promise<BusinessRulesData> {
  try {
    const [row] = await db
      .select({ value: crmSettings.value })
      .from(crmSettings)
      .where(eq(crmSettings.key, BUSINESS_RULES_KEY))
      .limit(1);

    if (row?.value) {
      const parsed = JSON.parse(row.value);
      return {
        faqs: Array.isArray(parsed.faqs) ? parsed.faqs : DEFAULT_BUSINESS_RULES.faqs,
        politicas: typeof parsed.politicas === "string" ? parsed.politicas : DEFAULT_BUSINESS_RULES.politicas,
        promocionesTemporales: typeof parsed.promocionesTemporales === "string" ? parsed.promocionesTemporales : DEFAULT_BUSINESS_RULES.promocionesTemporales,
        horariosAtencion: typeof parsed.horariosAtencion === "string" ? parsed.horariosAtencion : DEFAULT_BUSINESS_RULES.horariosAtencion,
      };
    }
  } catch (err) {
    console.warn("[rules] Error al leer business_rules_and_faqs:", err);
  }
  return DEFAULT_BUSINESS_RULES;
}

export async function saveBusinessRules(data: BusinessRulesData): Promise<void> {
  const serialized = JSON.stringify(data);
  await db
    .insert(crmSettings)
    .values({ key: BUSINESS_RULES_KEY, value: serialized })
    .onConflictDoUpdate({
      target: crmSettings.key,
      set: { value: serialized },
    });
}

export function renderBusinessRulesPrompt(rules: BusinessRulesData): string {
  const partes: string[] = [];
  partes.push("\n# INFORMACIÓN, REGLAS Y FAQS ADICIONALES (CONFIGURADAS EN AJUSTES)");

  if (rules.horariosAtencion?.trim()) {
    partes.push(`## Horarios de Atención\n${rules.horariosAtencion.trim()}`);
  }
  if (rules.politicas?.trim()) {
    partes.push(`## Políticas de Envío y Garantía\n${rules.politicas.trim()}`);
  }
  if (rules.promocionesTemporales?.trim()) {
    partes.push(`## Promociones Vigentes\n${rules.promocionesTemporales.trim()}`);
  }
  if (rules.faqs && rules.faqs.length > 0) {
    const validFaqs = rules.faqs.filter((f) => f.pregunta?.trim() && f.respuesta?.trim());
    if (validFaqs.length > 0) {
      const faqsTxt = validFaqs
        .map((f, i) => `${i + 1}. Pregunta: "${f.pregunta.trim()}"\n   Respuesta oficial: "${f.respuesta.trim()}"`)
        .join("\n\n");
      partes.push(`## Preguntas Frecuentes (FAQs Oficiales)\nResponde a estas consultas con la siguiente base de conocimientos oficial:\n${faqsTxt}`);
    }
  }

  return partes.join("\n\n");
}
