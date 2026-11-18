"use client";

import { useState, useEffect } from "react";
import { MapPin, Save, CheckCircle2, Building2, User, Truck, Box } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { DespacharAliclikModal, type DespacharAliclikModalData } from "@/components/pipeline/DespacharAliclikModal";

interface Props {
  contactId: string;
  contactName: string;
  contactPhone: string | null;
  customFields?: Record<string, unknown> | null;
}

export function DatosEntregaPanel({
  contactId,
  contactName,
  contactPhone,
  customFields,
}: Props) {
  const fields = customFields || {};

  const [agenciaShalom, setAgenciaShalom] = useState(
    (fields.agencia_shalom as string) ||
    (fields.direccion_envio as string)?.includes("Shalom")
      ? (fields.direccion_envio as string)
      : ""
  );
  const [dni, setDni] = useState(
    (fields.dni_ruc as string) || (fields.dni as string) || ""
  );
  const [ciudad, setCiudad] = useState(
    (fields.departamento_ciudad as string) || (fields.ciudad as string) || ""
  );
  const [direccion, setDireccion] = useState(
    (fields.direccion_envio as string) || ""
  );
  const [saving, setSaving] = useState(false);
  const [modalAliclikOpen, setModalAliclikOpen] = useState(false);

  useEffect(() => {
    const f = customFields || {};
    const ag =
      (f.agencia_shalom as string) ||
      (typeof f.direccion_envio === "string" && f.direccion_envio.toLowerCase().includes("shalom")
        ? f.direccion_envio
        : "");
    setAgenciaShalom(ag);
    setDni((f.dni_ruc as string) || (f.dni as string) || "");
    setCiudad((f.departamento_ciudad as string) || (f.ciudad as string) || "");
    setDireccion((f.direccion_envio as string) || "");
  }, [contactId, customFields]);

  const guardarDatos = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/contacts/${contactId}/entrega`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agenciaShalom: agenciaShalom.trim(),
          dni: dni.trim(),
          ciudad: ciudad.trim(),
          direccion: direccion.trim(),
        }),
      });

      if (!res.ok) {
        throw new Error("No se pudo guardar la información de entrega");
      }

      toast.success("✅ Datos de entrega y agencia Shalom actualizados en Pipeline y AliClik");
      window.dispatchEvent(new Event("pipeline:refresh"));
      window.dispatchEvent(new Event("conversations:refresh"));
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Error al guardar");
    } finally {
      setSaving(false);
    }
  };

  const modalAliclikData: DespacharAliclikModalData = {
    contactId,
    clienteNombre: contactName,
    telefono: contactPhone || "",
    dni: dni.trim() || null,
    departamento: ciudad.trim() || null,
    provincia: ciudad.trim() || null,
    distrito: null,
    agenciaShalom: agenciaShalom.trim() || direccion.trim() || "",
    total: 139, // Termix o el total actual del pedido
    productosResumen: "2 Tobilleras Termix",
  };

  return (
    <div className="px-4 py-4 border-b border-border bg-muted/20 space-y-3">
      <div className="flex items-center justify-between">
        <Label className="text-xs font-semibold text-foreground uppercase tracking-wider flex items-center gap-1.5">
          <MapPin className="h-3.5 w-3.5 text-primary" />
          Agencia Shalom y Destino
        </Label>
        <span className="text-[10px] font-medium text-muted-foreground bg-primary/10 text-primary px-1.5 py-0.5 rounded">
          Auto-sincronizado
        </span>
      </div>

      <div className="space-y-2">
        <div>
          <Label className="text-[11px] font-medium text-muted-foreground flex items-center gap-1 mb-1">
            <Building2 className="h-3 w-3 text-amber-600 dark:text-amber-400" />
            Agencia Shalom de Destino
          </Label>
          <Input
            value={agenciaShalom}
            onChange={(e) => setAgenciaShalom(e.target.value)}
            placeholder="Ej: Shalom Jr. Ica - Huancayo"
            className="h-8 text-xs font-medium bg-background"
          />
          {ciudad.toLowerCase().includes("huancayo") && !agenciaShalom && (
            <button
              type="button"
              onClick={() => setAgenciaShalom("Shalom Jr. Ica - Huancayo")}
              className="mt-1 text-[10.5px] text-primary hover:underline font-medium cursor-pointer"
            >
              + Sugerir: Shalom Jr. Ica - Huancayo
            </button>
          )}
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label className="text-[11px] font-medium text-muted-foreground flex items-center gap-1 mb-1">
              <User className="h-3 w-3" />
              DNI Destinatario
            </Label>
            <Input
              value={dni}
              onChange={(e) => setDni(e.target.value.replace(/\D/g, "").slice(0, 8))}
              placeholder="8 dígitos"
              maxLength={8}
              className="h-8 text-xs bg-background"
            />
          </div>
          <div>
            <Label className="text-[11px] font-medium text-muted-foreground mb-1 block">
              Ciudad / Depto
            </Label>
            <Input
              value={ciudad}
              onChange={(e) => setCiudad(e.target.value)}
              placeholder="Ej: Huancayo"
              className="h-8 text-xs bg-background"
            />
          </div>
        </div>

        <div>
          <Label className="text-[11px] font-medium text-muted-foreground mb-1 block">
            Dirección / Referencia del cliente
          </Label>
          <Input
            value={direccion}
            onChange={(e) => setDireccion(e.target.value)}
            placeholder="Ej: jr lima 80 - huancayo"
            className="h-8 text-xs bg-background"
          />
        </div>

        <div className="pt-1 flex flex-col gap-1.5">
          <Button
            type="button"
            size="sm"
            onClick={guardarDatos}
            disabled={saving}
            className="w-full h-8 text-xs cursor-pointer font-medium"
          >
            <Save className="h-3.5 w-3.5 mr-1.5" />
            {saving ? "Guardando..." : "Guardar en Pipeline y AliClik"}
          </Button>

          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setModalAliclikOpen(true)}
            className="w-full h-7 text-[11px] cursor-pointer text-primary border-primary/30 hover:bg-primary/5"
          >
            <Truck className="h-3 w-3 mr-1.5" />
            Abrir Despacho AliClik
          </Button>
        </div>
      </div>

      <DespacharAliclikModal
        open={modalAliclikOpen}
        onOpenChange={setModalAliclikOpen}
        data={modalAliclikData}
        onSuccess={(nuevaOrden) => {
          toast.success(`Orden ${nuevaOrden} creada con éxito en AliClik`);
        }}
      />
    </div>
  );
}
