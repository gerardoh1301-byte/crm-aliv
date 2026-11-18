"use client";

import { useEffect, useState } from "react";
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
import { Landmark, CheckCircle2, Calculator, CreditCard, Banknote } from "lucide-react";

export interface LiquidacionAliclikData {
  montoNeto: number;
  montoBruto: number;
  costoEnvio: number;
  costoFulfillment: number;
  comisionPos: number;
  fecha: string;
  metodoCobro: string;
  nroOperacion: string;
}

export interface LiquidarAliclikModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dealId: string;
  pedidoId?: string | null;
  contactId?: string | null;
  numeroOrden?: string | null;
  clienteNombre: string;
  totalCobrado: number;
  liquidacionActual?: LiquidacionAliclikData | null;
  onSuccess?: (liq: LiquidacionAliclikData) => void;
}

function hoyIso(): string {
  const ahora = new Date();
  const offsetPeru = -5 * 60;
  const fechaPeru = new Date(
    ahora.getTime() + (ahora.getTimezoneOffset() + offsetPeru) * 60000
  );
  return fechaPeru.toISOString().slice(0, 10);
}

export function LiquidarAliclikModal({
  open,
  onOpenChange,
  dealId,
  pedidoId,
  contactId,
  numeroOrden,
  clienteNombre,
  totalCobrado,
  liquidacionActual,
  onSuccess,
}: LiquidarAliclikModalProps) {
  const montoInicial =
    totalCobrado > 500 ? Math.round(totalCobrado) / 100 : totalCobrado || 119;

  const [loading, setLoading] = useState(false);
  const [metodoCobro, setMetodoCobro] = useState<"EFECTIVO" | "POS">("EFECTIVO");
  const [montoBruto, setMontoBruto] = useState<string>(String(montoInicial));
  const [costoEnvio, setCostoEnvio] = useState<string>("13.50");
  const [costoFulfillment, setCostoFulfillment] = useState<string>("3.00");
  const [comisionPos, setComisionPos] = useState<string>("0.00");
  const [montoNeto, setMontoNeto] = useState<string>(
    String(Math.max(0, Math.round((montoInicial - 13.5 - 3) * 100) / 100))
  );
  const [fechaLiquidacion, setFechaLiquidacion] = useState<string>(hoyIso());
  const [nroOperacion, setNroOperacion] = useState<string>("");
  const [edicionManualNeto, setEdicionManualNeto] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (liquidacionActual) {
      setMetodoCobro(
        liquidacionActual.metodoCobro === "POS" || liquidacionActual.comisionPos > 0
          ? "POS"
          : "EFECTIVO"
      );
      setMontoBruto(String(liquidacionActual.montoBruto));
      setCostoEnvio(String(liquidacionActual.costoEnvio));
      setCostoFulfillment(String(liquidacionActual.costoFulfillment));
      setComisionPos(String(liquidacionActual.comisionPos));
      setMontoNeto(String(liquidacionActual.montoNeto));
      setFechaLiquidacion(liquidacionActual.fecha || hoyIso());
      setNroOperacion(liquidacionActual.nroOperacion || "");
      setEdicionManualNeto(false);
    } else {
      const bruto =
        totalCobrado > 500 ? Math.round(totalCobrado) / 100 : totalCobrado || 119;
      setMetodoCobro("EFECTIVO");
      setMontoBruto(String(bruto));
      setCostoEnvio("13.50");
      setCostoFulfillment("3.00");
      setComisionPos("0.00");
      const netoCalc = Math.max(0, Math.round((bruto - 13.5 - 3) * 100) / 100);
      setMontoNeto(netoCalc.toFixed(2));
      setFechaLiquidacion(hoyIso());
      setNroOperacion("");
      setEdicionManualNeto(false);
    }
  }, [open, totalCobrado, liquidacionActual]);

  const recalcularNeto = (
    brutoStr: string,
    envioStr: string,
    ffStr: string,
    posStr: string
  ) => {
    const b = parseFloat(brutoStr) || 0;
    const e = parseFloat(envioStr) || 0;
    const f = parseFloat(ffStr) || 0;
    const p = parseFloat(posStr) || 0;
    const neto = Math.max(0, Math.round((b - e - f - p) * 100) / 100);
    setMontoNeto(neto.toFixed(2));
  };

  const cambiarMetodo = (nuevoMetodo: "EFECTIVO" | "POS") => {
    setMetodoCobro(nuevoMetodo);
    const b = parseFloat(montoBruto) || 0;
    const nuevaComision =
      nuevoMetodo === "POS" ? (Math.round(b * 0.05 * 100) / 100).toFixed(2) : "0.00";
    setComisionPos(nuevaComision);
    setEdicionManualNeto(false);
    recalcularNeto(montoBruto, costoEnvio, costoFulfillment, nuevaComision);
  };

  const handleConfirmar = async () => {
    const netoNum = parseFloat(montoNeto) || 0;
    if (netoNum <= 0) {
      toast.error("Ingresa un monto neto liquidado mayor a S/ 0.00");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/pedidos/liquidar-aliclik", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dealId,
          pedidoId,
          contactId,
          numeroOrden,
          montoNeto: netoNum,
          montoBruto: parseFloat(montoBruto) || netoNum,
          costoEnvio: parseFloat(costoEnvio) || 0,
          costoFulfillment: parseFloat(costoFulfillment) || 0,
          comisionPos: parseFloat(comisionPos) || 0,
          metodoCobro,
          fechaLiquidacion,
          nroOperacion,
        }),
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) {
        throw new Error(json.error || "No se pudo registrar la liquidación");
      }

      toast.success(
        `✅ Liquidación de S/ ${netoNum.toFixed(2)} confirmada en cuenta BCP y sincronizada con el ERP`
      );
      onSuccess?.(json.liquidacion);
      window.dispatchEvent(new Event("pipeline:refresh"));
      onOpenChange(false);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Error al registrar liquidación"
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Landmark className="h-5 w-5 text-emerald-600" />
            Confirmar Liquidación AliClik en BCP
          </DialogTitle>
          <DialogDescription className="text-xs">
            Confirma el monto neto que AliClik liquidó por este pedido Contra Entrega y que ya se encuentra depositado en tu cuenta BCP. Se registrará automáticamente como ingreso en el Libro Diario del ERP.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-1">
          <div className="rounded-lg border border-emerald-200 dark:border-emerald-900 bg-emerald-50/70 dark:bg-emerald-950/30 px-3 py-2 text-xs flex items-center justify-between">
            <div>
              <span className="text-muted-foreground">Cliente: </span>
              <span className="font-semibold text-foreground">{clienteNombre}</span>
            </div>
            {numeroOrden && (
              <span className="font-mono font-bold text-emerald-700 dark:text-emerald-300">
                #{String(numeroOrden).replace(/^#/, "")}
              </span>
            )}
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-medium">
              ¿Cómo cobró Alidriver al cliente?
            </Label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => cambiarMetodo("EFECTIVO")}
                className={`flex items-center justify-center gap-1.5 h-8 px-2.5 rounded-md border text-xs font-medium cursor-pointer transition-colors ${
                  metodoCobro === "EFECTIVO"
                    ? "border-emerald-600 bg-emerald-600 text-white"
                    : "border-border bg-background hover:bg-muted text-foreground"
                }`}
              >
                <Banknote className="h-3.5 w-3.5" />
                Efectivo / Transf. (0%)
              </button>
              <button
                type="button"
                onClick={() => cambiarMetodo("POS")}
                className={`flex items-center justify-center gap-1.5 h-8 px-2.5 rounded-md border text-xs font-medium cursor-pointer transition-colors ${
                  metodoCobro === "POS"
                    ? "border-blue-600 bg-blue-600 text-white"
                    : "border-border bg-background hover:bg-muted text-foreground"
                }`}
              >
                <CreditCard className="h-3.5 w-3.5" />
                POS / QR / Yape (5%)
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            <div>
              <Label className="text-[11px] text-muted-foreground mb-1 block">
                Cobro Bruto al Cliente (S/)
              </Label>
              <Input
                type="number"
                step="0.01"
                value={montoBruto}
                onChange={(e) => {
                  const val = e.target.value;
                  setMontoBruto(val);
                  const b = parseFloat(val) || 0;
                  const pos =
                    metodoCobro === "POS"
                      ? (Math.round(b * 0.05 * 100) / 100).toFixed(2)
                      : comisionPos;
                  if (metodoCobro === "POS") setComisionPos(pos);
                  if (!edicionManualNeto) {
                    recalcularNeto(val, costoEnvio, costoFulfillment, pos);
                  }
                }}
                className="h-8 text-xs font-semibold"
              />
            </div>

            <div>
              <Label className="text-[11px] text-muted-foreground mb-1 block">
                Envío Alidriver (-) (S/)
              </Label>
              <Input
                type="number"
                step="0.01"
                value={costoEnvio}
                onChange={(e) => {
                  setCostoEnvio(e.target.value);
                  if (!edicionManualNeto) {
                    recalcularNeto(montoBruto, e.target.value, costoFulfillment, comisionPos);
                  }
                }}
                className="h-8 text-xs"
              />
            </div>

            <div>
              <Label className="text-[11px] text-muted-foreground mb-1 block">
                Fulfillment Almacén (-) (S/)
              </Label>
              <Input
                type="number"
                step="0.01"
                value={costoFulfillment}
                onChange={(e) => {
                  setCostoFulfillment(e.target.value);
                  if (!edicionManualNeto) {
                    recalcularNeto(montoBruto, costoEnvio, e.target.value, comisionPos);
                  }
                }}
                className="h-8 text-xs"
              />
            </div>

            <div>
              <Label className="text-[11px] text-muted-foreground mb-1 block">
                Comisión POS 5% (-) (S/)
              </Label>
              <Input
                type="number"
                step="0.01"
                value={comisionPos}
                onChange={(e) => {
                  setComisionPos(e.target.value);
                  if (!edicionManualNeto) {
                    recalcularNeto(montoBruto, costoEnvio, costoFulfillment, e.target.value);
                  }
                }}
                className="h-8 text-xs"
              />
            </div>
          </div>

          <div className="rounded-lg border-2 border-emerald-500/70 bg-emerald-50/50 dark:bg-emerald-950/20 p-3 space-y-1.5">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-bold text-emerald-900 dark:text-emerald-200 flex items-center gap-1.5">
                <Calculator className="h-3.5 w-3.5 text-emerald-600" />
                Monto Neto Liquidado en Cuenta BCP (S/)
              </Label>
              {edicionManualNeto && (
                <button
                  type="button"
                  onClick={() => {
                    setEdicionManualNeto(false);
                    recalcularNeto(montoBruto, costoEnvio, costoFulfillment, comisionPos);
                  }}
                  className="text-[10px] text-emerald-700 underline cursor-pointer"
                >
                  Autocalcular
                </button>
              )}
            </div>
            <Input
              type="number"
              step="0.01"
              value={montoNeto}
              onChange={(e) => {
                setEdicionManualNeto(true);
                setMontoNeto(e.target.value);
              }}
              className="h-9 text-sm font-bold text-emerald-800 dark:text-emerald-200 bg-background border-emerald-400"
            />
            <p className="text-[10.5px] text-muted-foreground">
              Este monto exacto se registrará como <b>Ingreso (+) en Cuenta BCP</b> en el Libro Diario del ERP.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            <div>
              <Label className="text-[11px] text-muted-foreground mb-1 block">
                Fecha de Depósito en BCP
              </Label>
              <Input
                type="date"
                value={fechaLiquidacion}
                onChange={(e) => setFechaLiquidacion(e.target.value)}
                className="h-8 text-xs"
              />
            </div>
            <div>
              <Label className="text-[11px] text-muted-foreground mb-1 block">
                N° Operación / Nota (Opcional)
              </Label>
              <Input
                value={nroOperacion}
                onChange={(e) => setNroOperacion(e.target.value)}
                placeholder="Ej. Liquidación AliClik"
                className="h-8 text-xs"
              />
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={loading}
          >
            Cancelar
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={handleConfirmar}
            disabled={loading}
            className="bg-emerald-600 hover:bg-emerald-700 text-white cursor-pointer"
          >
            <CheckCircle2 className="h-4 w-4 mr-1.5" />
            {loading ? "Registrando en BCP y ERP..." : "Confirmar Depósito en BCP"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
