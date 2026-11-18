"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
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
import { PackageCheck, Truck, CheckCircle2, Calendar, Box, AlertCircle } from "lucide-react";

export interface DespacharAliclikModalData {
  dealId?: string;
  contactId?: string | null;
  numeroOrden?: string;
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
  onSuccess?: (nuevaOrden: string) => void;
}

function normalizarMonto(rawTotal: number | undefined | null): string {
  if (!rawTotal || isNaN(rawTotal)) return "119";
  const valor = rawTotal > 500 ? rawTotal / 100 : rawTotal;
  return valor.toFixed(2).replace(/\.00$/, "");
}

function calcularFechaEnvioDefecto(): string {
  const ahora = new Date();
  const offsetPeru = -5 * 60;
  const fechaPeru = new Date(
    ahora.getTime() + (ahora.getTimezoneOffset() + offsetPeru) * 60000
  );
  const hora = fechaPeru.getHours();
  const fechaEnvio = new Date(fechaPeru);
  if (hora >= 12) {
    fechaEnvio.setDate(fechaEnvio.getDate() + 1);
  }
  if (fechaEnvio.getDay() === 0) {
    fechaEnvio.setDate(fechaEnvio.getDate() + 1);
  }
  const dd = String(fechaEnvio.getDate()).padStart(2, "0");
  const mm = String(fechaEnvio.getMonth() + 1).padStart(2, "0");
  const yyyy = fechaEnvio.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
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
  const [total, setTotal] = useState(normalizarMonto(data.total));
  const [cantidad, setCantidad] = useState(3);
  const [fechaEnvio, setFechaEnvio] = useState(calcularFechaEnvioDefecto());
  const [tipoMercancia, setTipoMercancia] = useState("Caja Paquete XS");

  // Sincronizar estado cuando se abre el modal o cambian los datos
  useEffect(() => {
    if (open) {
      setClienteNombre(data.clienteNombre || "");
      setTelefono(data.telefono || "");
      setDni(data.dni || "");
      setAgenciaShalom(data.agenciaShalom || "");
      setDepartamento(data.departamento || "");
      const totNum = parseFloat(normalizarMonto(data.total)) || 119;
      setTotal(String(totNum));

      // Determinar cantidad inicial
      let cantInicial = 1;
      if (data.productos && data.productos.length > 0) {
        cantInicial = data.productos.reduce((acc, p) => acc + (p.cantidad || 1), 0);
      } else if (totNum === 199) {
        cantInicial = 3;
      } else if (totNum === 189) {
        cantInicial = 2;
      }
      setCantidad(cantInicial);
      setFechaEnvio(calcularFechaEnvioDefecto());
      setTipoMercancia("Caja Paquete XS");
    }
  }, [open, data]);

  // Detección proactiva de alias de agencia Shalom Cutervo -> JJ Elías
  const esCutervoIca =
    agenciaShalom.toLowerCase().includes("cutervo") ||
    (agenciaShalom.toLowerCase().includes("ica") && agenciaShalom.toLowerCase().includes("elias"));

  const handleDespachar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!clienteNombre.trim() || !telefono.trim() || !agenciaShalom.trim()) {
      toast.error("Por favor completa Nombre, Teléfono y Agencia Shalom de destino.");
      return;
    }

    setLoading(true);
    try {
      const montoTotal = parseFloat(total) || 119;
      const nombreProd = data.productos?.[0]?.nombre || "NAC600";
      const precioUnit = Math.round((montoTotal / (cantidad || 1)) * 100) / 100;

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
          total: montoTotal,
          fechaEnvio,
          tipoMercancia,
          productos: [
            {
              nombre: nombreProd,
              cantidad: Number(cantidad) || 1,
              precioUnitario: precioUnit,
            },
          ],
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
      <DialogContent className="max-w-lg">
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
              Servicio Completo Shalom AliClik (Alidriver)
            </p>
            <p className="text-muted-foreground text-[11px]">
              Almacén: <strong>WANKLIC GROUP 2</strong> · Mercancía: <strong>{tipoMercancia}</strong> · Despacho: <strong>{fechaEnvio}</strong>.
            </p>
          </div>

          {esCutervoIca && (
            <div className="bg-amber-500/10 border border-amber-500/30 rounded-md p-2 text-xs text-amber-700 dark:text-amber-300 flex items-start gap-2">
              <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
              <div>
                <strong>Resolución de Agencia Shalom Ica:</strong> La sede popularmente conocida como <em>Av. Cutervo</em> está registrada oficialmente en Shalom PRO y AliClik como <strong>ICA AV. JJ ELIAS (DropShalomId: 405)</strong>. El sistema la mapeará automáticamente.
              </div>
            </div>
          )}

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

          <div className="grid grid-cols-3 gap-2.5">
            <div>
              <Label className="text-xs">DNI Destinatario</Label>
              <Input
                value={dni}
                onChange={(e) => setDni(e.target.value)}
                className="h-8 text-xs mt-1"
                placeholder="8 dígitos"
              />
            </div>
            <div>
              <Label className="text-xs">Unidades</Label>
              <Input
                value={cantidad}
                onChange={(e) => setCantidad(parseInt(e.target.value) || 1)}
                type="number"
                min="1"
                max="10"
                className="h-8 text-xs mt-1"
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

          <div className="grid grid-cols-2 gap-2.5">
            <div>
              <Label className="text-xs flex items-center gap-1">
                <Calendar className="h-3 w-3" /> Fecha Envío AliClik
              </Label>
              <Input
                value={fechaEnvio}
                onChange={(e) => setFechaEnvio(e.target.value)}
                required
                className="h-8 text-xs mt-1"
                placeholder="DD/MM/YYYY"
              />
            </div>
            <div>
              <Label className="text-xs flex items-center gap-1">
                <Box className="h-3 w-3" /> Tipo de Mercancía
              </Label>
              <Input
                value={tipoMercancia}
                onChange={(e) => setTipoMercancia(e.target.value)}
                required
                className="h-8 text-xs mt-1"
                placeholder="Caja Paquete XS"
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
              placeholder="Ej: ICA / ICA / ICA / ICA AV. JJ ELIAS"
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
