"use client";

import { useEffect, useState } from "react";
import {
  ShieldCheck,
  Plus,
  Trash2,
  Save,
  Loader2,
  HelpCircle,
  Clock,
  Tag,
  FileText,
  AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";

interface FaqItem {
  pregunta: string;
  respuesta: string;
}

interface BusinessRulesData {
  faqs: FaqItem[];
  politicas: string;
  promocionesTemporales: string;
  horariosAtencion: string;
}

export function BusinessRulesSettings() {
  const [data, setData] = useState<BusinessRulesData>({
    faqs: [],
    politicas: "",
    promocionesTemporales: "",
    horariosAtencion: "",
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/settings/rules", { cache: "no-store" })
      .then((r) => r.json())
      .then((res: BusinessRulesData) => {
        setData(res);
      })
      .catch((err) => {
        console.error("Error al cargar reglas:", err);
        toast.error("No se pudieron cargar las reglas de negocio");
      })
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/settings/rules", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Error al guardar");
      toast.success("Reglas y FAQs guardadas correctamente");
    } catch {
      toast.error("Error al guardar los cambios");
    } finally {
      setSaving(false);
    }
  };

  const addFaq = () => {
    setData((prev) => ({
      ...prev,
      faqs: [...prev.faqs, { pregunta: "", respuesta: "" }],
    }));
  };

  const updateFaq = (index: number, field: "pregunta" | "respuesta", value: string) => {
    setData((prev) => {
      const updated = [...prev.faqs];
      updated[index] = { ...updated[index], [field]: value };
      return { ...prev, faqs: updated };
    });
  };

  const removeFaq = (index: number) => {
    setData((prev) => ({
      ...prev,
      faqs: prev.faqs.filter((_, i) => i !== index),
    }));
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8 text-muted-foreground gap-2">
        <Loader2 className="h-5 w-5 animate-spin" />
        <span className="text-sm">Cargando base de conocimiento y reglas...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Banner de Blindaje Normativo Inviolable */}
      <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4 text-emerald-950 dark:text-emerald-100 flex items-start gap-3">
        <ShieldCheck className="h-5 w-5 text-emerald-600 dark:text-emerald-400 mt-0.5 shrink-0" />
        <div className="space-y-1 text-xs sm:text-sm">
          <p className="font-semibold text-emerald-800 dark:text-emerald-300">
            Normativa Central y Blindaje de Seguridad (Activo e Inviolable)
          </p>
          <p className="text-muted-foreground leading-relaxed">
            Las reglas críticas del negocio están blindadas en el núcleo del bot:{" "}
            <strong>NAC600 siempre son cápsulas</strong> (nunca softgels), adelanto indispensable de{" "}
            <strong>S/ 20 para emitir guía de Shalom</strong> en provincia, prohibición absoluta de entregar
            claves de recojo sin validación de saldo por parte de un asesor humano, y uso de enlaces oficiales CDN para videos.
            Las reglas y FAQs a continuación <strong>enriquecen y amplían</strong> el conocimiento del agente sin vulnerar este blindaje.
          </p>
        </div>
      </div>

      {/* Preguntas Frecuentes (FAQs) */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <HelpCircle className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold">Preguntas Frecuentes (FAQs)</h3>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={addFaq}
            className="h-8 gap-1 text-xs"
          >
            <Plus className="h-3.5 w-3.5" />
            Agregar FAQ
          </Button>
        </div>

        {data.faqs.length === 0 ? (
          <p className="text-xs text-muted-foreground italic p-3 bg-muted/40 rounded-md">
            No hay preguntas frecuentes registradas. Haz clic en &quot;Agregar FAQ&quot; para registrar respuestas oficiales que el bot responderá con precisión.
          </p>
        ) : (
          <div className="space-y-3">
            {data.faqs.map((faq, idx) => (
              <Card key={idx} className="border bg-card/60 shadow-none">
                <CardContent className="p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <Label className="text-xs font-medium text-muted-foreground">
                      Pregunta #{idx + 1}
                    </Label>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => removeFaq(idx)}
                      className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                      title="Eliminar FAQ"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                  <Input
                    placeholder="Ej: ¿Tiene registro sanitario DIGEMID?"
                    value={faq.pregunta}
                    onChange={(e) => updateFaq(idx, "pregunta", e.target.value)}
                    className="h-8 text-xs"
                  />
                  <Label className="text-xs font-medium text-muted-foreground">
                    Respuesta oficial del bot
                  </Label>
                  <Textarea
                    placeholder="Ej: Sí, nuestro producto cuenta con registro sanitario y certificación de origen..."
                    value={faq.respuesta}
                    onChange={(e) => updateFaq(idx, "respuesta", e.target.value)}
                    rows={2}
                    className="text-xs resize-none"
                  />
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Políticas Generales y Garantía */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-primary" />
          <Label className="text-sm font-semibold">Políticas de Envío, Entrega y Garantía</Label>
        </div>
        <p className="text-xs text-muted-foreground">
          Define aquí las condiciones de garantía, cambios, tiempos promedio de entrega o modalidades de pago.
        </p>
        <Textarea
          value={data.politicas}
          onChange={(e) => setData({ ...data, politicas: e.target.value })}
          rows={3}
          className="text-xs"
          placeholder="Ej: Garantía de satisfacción de 30 días. En Lima se paga contraentrega al recibir..."
        />
      </div>

      {/* Promociones Vigentes */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Tag className="h-4 w-4 text-primary" />
          <Label className="text-sm font-semibold">Promociones Temporales y Packs</Label>
        </div>
        <p className="text-xs text-muted-foreground">
          Indica promociones por temporada o combos vigentes que el bot deba conocer y ofrecer.
        </p>
        <Textarea
          value={data.promocionesTemporales}
          onChange={(e) => setData({ ...data, promocionesTemporales: e.target.value })}
          rows={3}
          className="text-xs"
          placeholder="Ej: Promo primavera: 3 frascos de NAC600 por S/ 199 con envío gratis..."
        />
      </div>

      {/* Horarios de Atención */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Clock className="h-4 w-4 text-primary" />
          <Label className="text-sm font-semibold">Horarios de Atención y Despacho</Label>
        </div>
        <p className="text-xs text-muted-foreground">
          Horarios en que el equipo humano revisa pagos, emite guías y realiza despachos en agencias.
        </p>
        <Textarea
          value={data.horariosAtencion}
          onChange={(e) => setData({ ...data, horariosAtencion: e.target.value })}
          rows={2}
          className="text-xs"
          placeholder="Ej: Lunes a Sábado de 8:30 am a 8:00 pm. Despachos diarios a Lima y salidas a provincia por Shalom."
        />
      </div>

      {/* Botón de Guardado */}
      <div className="flex justify-end pt-2">
        <Button onClick={handleSave} disabled={saving} className="gap-2">
          {saving ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Guardando...
            </>
          ) : (
            <>
              <Save className="h-4 w-4" />
              Guardar Reglas y FAQs
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
