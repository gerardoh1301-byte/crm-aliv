"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Truck,
  ExternalLink,
  Copy,
  Check,
  PackageCheck,
  Save,
  MapPin,
  Clock,
} from "lucide-react";
import { toast } from "sonner";
import { formatCurrency } from "@/lib/constants";
import { useRouter } from "next/navigation";

export interface SeguimientoShalomData {
  pedidoId?: string | null;
  dealId?: string | null;
  numeroOrden: string;
  clienteNombre: string;
  telefono?: string | null;
  dni?: string | null;
  ciudad?: string | null;
  distrito?: string | null;
  direccion?: string | null;
  referencia?: string | null;
  total: number;
  numeroGuia?: string | null;
  claveRecojo?: string | null;
  transportadora?: string | null;
  estadoPedido?: string | null;
}

interface SeguimientoShalomModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  data: SeguimientoShalomData;
}

export function SeguimientoShalomModal({
  open,
  onOpenChange,
  data,
}: SeguimientoShalomModalProps) {
  const router = useRouter();
  const [numeroGuia, setNumeroGuia] = useState(data.numeroGuia || "");
  const [claveRecojo, setClaveRecojo] = useState(data.claveRecojo || "");
  const [estado, setEstado] = useState(data.estadoPedido || "enviado");
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);

  const adelanto = 20;
  const saldo = Math.max(0, data.total - adelanto);
  const destinoLimpio = [
    data.ciudad,
    data.distrito && data.distrito.toLowerCase() !== data.ciudad?.toLowerCase()
      ? data.distrito
      : null,
  ]
    .filter(Boolean)
    .join(" - ");

  const handleCopiarMensaje = () => {
    const texto = `¡Hola, ${data.clienteNombre.split(" ")[0]}! 👋 Te saluda Aliv Perú.
Te compartimos los datos de seguimiento de tu paquete enviado por *Shalom Empresarial* 🚚📦:

• *N° de Orden:* ${data.numeroOrden}
• *N° de Guía:* ${numeroGuia.trim() || "(En proceso de emisión)"}
${claveRecojo.trim() ? `• *Clave / Código de recojo:* ${claveRecojo.trim()}\n` : ""}• *Destino / Agencia:* ${destinoLimpio || "Provincia"}
• *Saldo a pagar al retirar:* ${formatCurrency(saldo)} (Adelanto registrado: S/ 20.00)

🔍 Puedes rastrear tu envío en tiempo real ingresando tu guía aquí:
👉 https://rastreo.shalom.pe/

Recuerda llevar tu DNI físico para el retiro. ¡Muchas gracias por tu compra en Aliv Perú! 🌿`;

    navigator.clipboard.writeText(texto);
    setCopied(true);
    toast.success("Mensaje para el cliente copiado al portapapeles");
    setTimeout(() => setCopied(false), 2500);
  };

  const handleGuardar = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/pedidos/seguimiento", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pedidoId: data.pedidoId,
          dealId: data.dealId,
          numeroOrden: data.numeroOrden,
          transportadora: "Shalom",
          numeroGuia: numeroGuia.trim(),
          claveRecojo: claveRecojo.trim(),
          estado,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "No se pudo guardar el seguimiento");
      }

      toast.success("Seguimiento de Shalom guardado exitosamente");
      onOpenChange(false);
      router.refresh();
    } catch (e: any) {
      toast.error(e.message || "Error al guardar seguimiento");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md p-5 bg-card">
        <DialogHeader className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-red-500/10 text-red-600 font-bold">
              <Truck className="h-4 w-4" />
            </span>
            <DialogTitle className="text-base font-bold flex items-center gap-2">
              Seguimiento de Envío Shalom
            </DialogTitle>
          </div>
          <DialogDescription className="text-xs text-muted-foreground">
            Orden <span className="font-semibold text-foreground">{data.numeroOrden}</span> ·{" "}
            {data.clienteNombre} ({destinoLimpio || "Provincia"})
          </DialogDescription>
        </DialogHeader>

        {/* Ficha Resumen de Envío Shalom */}
        <div className="bg-red-50/50 dark:bg-red-950/20 border border-red-200/80 dark:border-red-900/40 rounded-lg p-3 space-y-2 text-xs">
          <div className="flex justify-between items-start">
            <div>
              <p className="text-[10px] font-bold text-red-700 dark:text-red-400 uppercase tracking-wide">
                Transportadora
              </p>
              <p className="font-extrabold text-sm text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                SHALOM EMPRESARIAL
              </p>
            </div>
            <a
              href="https://rastreo.shalom.pe/"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-[11px] font-semibold text-red-600 hover:text-red-700 bg-white dark:bg-card px-2 py-1 rounded border border-red-200 shadow-xs transition-colors"
            >
              <span>rastreo.shalom.pe</span>
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>

          <div className="grid grid-cols-2 gap-2 pt-1 border-t border-red-200/50 dark:border-red-900/30">
            <div>
              <p className="text-[10px] text-muted-foreground">Destino / Agencia</p>
              <p className="font-semibold text-foreground flex items-center gap-1">
                <MapPin className="h-3 w-3 text-red-500 shrink-0" />
                <span className="truncate">{destinoLimpio || "En agencia"}</span>
              </p>
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground">Saldo a cobrar en Agencia</p>
              <p className="font-bold text-foreground">
                {formatCurrency(saldo)}{" "}
                <span className="text-[10px] font-normal text-muted-foreground">
                  (Adelanto: S/ 20)
                </span>
              </p>
            </div>
          </div>
        </div>

        {/* Formulario para registrar / editar Guía y Clave */}
        <div className="space-y-3 py-1">
          <div className="space-y-1.5">
            <Label htmlFor="shalom-guia" className="text-xs font-semibold">
              N° de Guía / N° de Orden Shalom:
            </Label>
            <Input
              id="shalom-guia"
              placeholder="Ej. 103265650"
              value={numeroGuia}
              onChange={(e) => setNumeroGuia(e.target.value)}
              className="text-xs font-mono h-8"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="shalom-clave" className="text-xs font-semibold">
              Código / Clave de Recojo en Agencia:
            </Label>
            <Input
              id="shalom-clave"
              placeholder="Ej. 9JJ3"
              value={claveRecojo}
              onChange={(e) => setClaveRecojo(e.target.value.toUpperCase())}
              className="text-xs font-mono font-bold tracking-wider h-8"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="shalom-estado" className="text-xs font-semibold">
              Estado de la orden:
            </Label>
            <select
              id="shalom-estado"
              value={estado}
              onChange={(e) => setEstado(e.target.value)}
              className="w-full text-xs h-8 px-2.5 rounded-md border border-input bg-background text-foreground"
            >
              <option value="confirmado">Confirmado (Preparando en almacén)</option>
              <option value="enviado">En camino / Despachado (En ruta)</option>
              <option value="entregado">Entregado y Cobrado</option>
            </select>
          </div>
        </div>

        {/* Acciones */}
        <div className="flex items-center justify-between gap-2 pt-2 border-t border-border/50">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleCopiarMensaje}
            className="text-xs h-9"
          >
            {copied ? (
              <>
                <Check className="h-3.5 w-3.5 mr-1 text-emerald-600" />
                Copiado
              </>
            ) : (
              <>
                <Copy className="h-3.5 w-3.5 mr-1" />
                Copiar WhatsApp
              </>
            )}
          </Button>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
              className="text-xs h-9"
            >
              Cancelar
            </Button>
            <Button
              type="button"
              variant="default"
              size="sm"
              disabled={saving}
              onClick={handleGuardar}
              className="text-xs h-9 bg-red-600 hover:bg-red-700 text-white font-semibold"
            >
              <Save className="h-3.5 w-3.5 mr-1.5" />
              {saving ? "Guardando..." : "Guardar Seguimiento"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
