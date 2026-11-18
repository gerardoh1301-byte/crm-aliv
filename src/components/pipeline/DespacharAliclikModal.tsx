"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Truck, CheckCircle2, PackageCheck } from "lucide-react";

export interface DespacharAliclikModalData {
  dealId: string;
  contactId?: string | null;
  numeroOrden: string;
  clienteNombre: string;
  telefono: string;
  dni?: string | null;
  departamento?: string | null;
  provincia?: string | null;
  distrito?: string | null;
  agenciaShalom?: string | null;
  total: number;
  productosResumen?: string;
  productos?: Array<{ nombre: string; cantidad: number; precioUnitario: number }>;
}

interface DespacharAliclikModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  data: DespacharAliclikModalData;
  onSuccess?: (ordenAliClik: string) => void;
}

export function DespacharAliclikModal({
  open,
  onOpenChange,
  data,
  onSuccess,
}: DespacharAliclikModalProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [clienteNombre, setClienteNombre] = useState(data.clienteNombre || "");
  const [telefono, setTelefono] = useState(data.telefono || "");
  const [dni, setDni] = useState(data.dni || "");
  const [agenciaShalom, setAgenciaShalom] = useState(data.agenciaShalom || "");
  const [departamento, setDepartamento] = useState(data.departamento || "");
  const [total, setTotal] = useState(String(data.total || 119));

  const handleDespachar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!clienteNombre.trim() || !telefono.trim() || !agenciaShalom.trim()) {
      toast.error("Por favor completa Nombre, Teléfono y Agencia Shalom de destino.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/aliclik/crear-orden", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dealId: data.dealId,
          contactId: data.contactId,
          clienteNombre,
          clienteTelefono: telefono,
          clienteDni: dni,
          departamento,
          agenciaShalomNombre: agenciaShalom,
          total: parseFloat(total) || 119,
          productos: data.productos && data.productos.length > 0
            ? data.productos
            : [{ nombre: data.productosResumen || "NAC600", cantidad: 1, precioUnitario: parseFloat(total) || 119 }],
        }),
      });

      const resData = await res.json();
      if (!res.ok || !resData.ok) {
        throw new Error(resData.error || "No se pudo registrar la orden en AliClik");
      }

      toast.success(resData.mensaje || `Orden ${resData.ordenAliClik} registrada en AliClik`);
      if (onSuccess) {
        onSuccess(resData.ordenAliClik);
      }
      onOpenChange(false);
      router.refresh();
    } catch (err: any) {
      toast.error(err.message || "Error al conectar con AliClik");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-2 text-primary font-bold">
            <PackageCheck className="h-5 w-5" />
            <DialogTitle>Despachar con AliClik</DialogTitle>
          </div>
          <DialogDescription>
            Registra este pedido en AliClik para que <strong>Alidriver lo recoja en el almacén</strong> y <strong>AliClik genere la guía y rótulo en Shalom PRO</strong> de manera 100% automática.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleDespachar} className="space-y-3.5 py-2 text-sm">
          <div className="bg-primary/10 border border-primary/20 rounded-md p-2.5 text-xs text-primary-foreground space-y-1">
            <p className="font-semibold text-primary flex items-center gap-1.5">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Servicio Completo Shalom AliClik
            </p>
            <p className="text-muted-foreground text-[11px]">
              Almacén: <strong>WANKLIC GROUP 2</strong> · Courier: <strong>Alidriver</strong>. Tú no tienes que imprimir rótulos ni llevarlo a la agencia.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            <div>
              <Label className="text-xs">Cliente / Destinatario</Label>
              <Input
                value={clienteNombre}
                onChange={(e) => setClienteNombre(e.target.value)}
                required
                className="h-8 text-xs mt-1"
                placeholder="Nombres y Apellidos"
              />
            </div>
            <div>
              <Label className="text-xs">Celular WhatsApp</Label>
              <Input
                value={telefono}
                onChange={(e) => setTelefono(e.target.value)}
                required
                className="h-8 text-xs mt-1"
                placeholder="987654321"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            <div>
              <Label className="text-xs">DNI del Destinatario</Label>
              <Input
                value={dni}
                onChange={(e) => setDni(e.target.value)}
                className="h-8 text-xs mt-1"
                placeholder="8 dígitos"
              />
            </div>
            <div>
              <Label className="text-xs">Cobro Total (S/)</Label>
              <Input
                value={total}
                onChange={(e) => setTotal(e.target.value)}
                type="number"
                step="0.01"
                className="h-8 text-xs mt-1"
              />
            </div>
          </div>

          <div>
            <Label className="text-xs">Agencia Shalom de Destino</Label>
            <Input
              value={agenciaShalom}
              onChange={(e) => setAgenciaShalom(e.target.value)}
              required
              className="h-8 text-xs mt-1"
              placeholder="Ej: SHALOM - PISCO CENTRO / JR GRAU"
            />
          </div>

          <div>
            <Label className="text-xs">Departamento / Ciudad</Label>
            <Input
              value={departamento}
              onChange={(e) => setDepartamento(e.target.value)}
              className="h-8 text-xs mt-1"
              placeholder="Ej: Ica, Piura, Cusco..."
            />
          </div>

          <DialogFooter className="pt-2 gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
              disabled={loading}
            >
              Cancelar
            </Button>
            <Button type="submit" size="sm" disabled={loading} className="gap-1.5">
              <Truck className="h-4 w-4" />
              {loading ? "Registrando en AliClik..." : "Enviar a AliClik"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
