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
import { Wallet, CheckCircle2 } from "lucide-react";
import type { FinanzasShalom } from "@/lib/finanzas/tags-shalom";

export interface FinanzasShalomModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dealId: string;
  pedidoId?: string | null;
  numeroOrden?: string | null;
  clienteNombre: string;
  total: number;
  actual?: FinanzasShalom | null;
  onSuccess?: (f: FinanzasShalom) => void;
}

function hoyPeru(): string {
  const d = new Date(Date.now() - 5 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

const txt = (n: number | null | undefined) => (n === null || n === undefined ? "" : String(n));

export function FinanzasShalomModal({
  open,
  onOpenChange,
  dealId,
  pedidoId,
  numeroOrden,
  clienteNombre,
  total,
  actual,
  onSuccess,
}: FinanzasShalomModalProps) {
  const [loading, setLoading] = useState(false);
  const [flete, setFlete] = useState("");
  const [fleteCuenta, setFleteCuenta] = useState("BCP");
  const [fleteFecha, setFleteFecha] = useState(hoyPeru());
  const [adelanto, setAdelanto] = useState("20");
  const [adelantoOp, setAdelantoOp] = useState("");
  const [saldo, setSaldo] = useState("");
  const [saldoOp, setSaldoOp] = useState("");
  const [saldoFecha, setSaldoFecha] = useState(hoyPeru());

  useEffect(() => {
    if (!open) return;
    setFlete(txt(actual?.fleteShalom));
    setFleteCuenta(actual?.fleteCuenta || "BCP");
    setFleteFecha(actual?.fleteFecha || hoyPeru());
    setAdelanto(actual?.adelantoMonto !== null && actual?.adelantoMonto !== undefined ? String(actual.adelantoMonto) : "20");
    setAdelantoOp(actual?.adelantoOp || "");
    setSaldo(txt(actual?.saldoMonto));
    setSaldoOp(actual?.saldoOp || "");
    setSaldoFecha(actual?.saldoFecha || hoyPeru());
  }, [open, actual]);

  const adelantoNum = parseFloat(adelanto) || 0;
  const saldoSugerido = Math.max(0, Math.round((total - adelantoNum) * 100) / 100);

  const guardar = async () => {
    if (!flete && !saldo && !adelanto) {
      toast.error("Completa al menos un dato");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/pedidos/finanzas-shalom", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dealId,
          pedidoId,
          numeroOrden,
          fleteShalom: flete === "" ? null : Number(flete),
          fleteCuenta,
          fleteFecha,
          adelantoMonto: adelanto === "" ? null : Number(adelanto),
          adelantoOp,
          saldoMonto: saldo === "" ? null : Number(saldo),
          saldoOp,
          saldoFecha,
          saldoCuenta: "BCP",
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) throw new Error(json.error || "No se pudo guardar");
      toast.success("Dinero del pedido guardado y enviado al ERP");
      onSuccess?.(json.finanzasShalom);
      window.dispatchEvent(new Event("pipeline:refresh"));
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al guardar");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Wallet className="h-5 w-5 text-emerald-600" />
            Dinero del pedido Shalom
          </DialogTitle>
          <DialogDescription className="text-xs">
            Registra lo que realmente pagaste y cobraste. El ERP lo usa para el Libro Diario y la
            ganancia real del pedido. Deja vacío lo que aún no pasó.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-1">
          <div className="rounded-lg border bg-muted/40 px-3 py-2 text-xs flex items-center justify-between">
            <span>
              <span className="text-muted-foreground">Cliente: </span>
              <b>{clienteNombre}</b>
            </span>
            <span className="font-mono font-bold">
              {numeroOrden ? `#${String(numeroOrden).replace(/^#/, "")}` : ""} · S/ {total.toFixed(2)}
            </span>
          </div>

          <fieldset className="space-y-1.5">
            <Label className="text-xs font-semibold">1. Envío Shalom que pagaste</Label>
            <div className="grid grid-cols-3 gap-2">
              <Input type="number" step="0.01" min="0" placeholder="Ej. 10.00" value={flete}
                onChange={(e) => setFlete(e.target.value)} className="h-8 text-xs" aria-label="Flete Shalom" />
              <select value={fleteCuenta} onChange={(e) => setFleteCuenta(e.target.value)}
                className="h-8 rounded-md border bg-background px-2 text-xs" aria-label="Pagado con">
                <option value="BCP">BCP / Yape</option>
                <option value="EFECTIVO">Efectivo</option>
              </select>
              <Input type="date" value={fleteFecha} onChange={(e) => setFleteFecha(e.target.value)}
                className="h-8 text-xs" aria-label="Fecha del pago" />
            </div>
          </fieldset>

          <fieldset className="space-y-1.5">
            <Label className="text-xs font-semibold">2. Adelanto recibido</Label>
            <div className="grid grid-cols-2 gap-2">
              <Input type="number" step="0.01" min="0" value={adelanto}
                onChange={(e) => setAdelanto(e.target.value)} className="h-8 text-xs" aria-label="Adelanto" />
              <Input placeholder="N° operación Yape/BCP" value={adelantoOp}
                onChange={(e) => setAdelantoOp(e.target.value)} className="h-8 text-xs" aria-label="Operación del adelanto" />
            </div>
          </fieldset>

          <fieldset className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-semibold">3. Saldo que pagó antes de la clave</Label>
              <button type="button" className="text-[10.5px] underline text-emerald-700 cursor-pointer"
                onClick={() => setSaldo(saldoSugerido.toFixed(2))}>
                Usar S/ {saldoSugerido.toFixed(2)}
              </button>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <Input type="number" step="0.01" min="0" placeholder="Monto" value={saldo}
                onChange={(e) => setSaldo(e.target.value)} className="h-8 text-xs" aria-label="Saldo cobrado" />
              <Input placeholder="N° operación" value={saldoOp}
                onChange={(e) => setSaldoOp(e.target.value)} className="h-8 text-xs" aria-label="Operación del saldo" />
              <Input type="date" value={saldoFecha} onChange={(e) => setSaldoFecha(e.target.value)}
                className="h-8 text-xs" aria-label="Fecha del saldo" />
            </div>
          </fieldset>

          <p className="text-[10.5px] text-muted-foreground">
            Los S/ 5 de AliClik (empaque y llevar a la agencia) salen de la billetera AliClik y el ERP
            los registra solos.
          </p>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={loading}>
            Cancelar
          </Button>
          <Button type="button" size="sm" onClick={guardar} disabled={loading}
            className="bg-emerald-600 hover:bg-emerald-700 text-white cursor-pointer">
            <CheckCircle2 className="h-4 w-4 mr-1.5" />
            {loading ? "Guardando..." : "Guardar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
