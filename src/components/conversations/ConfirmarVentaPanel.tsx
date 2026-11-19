"use client";

import { useState, useEffect, useCallback } from "react";
import { ShoppingBag, Check, Edit2, Sparkles, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface Props {
  contactId: string;
  contactName: string;
  tags?: string[];
  customFields?: Record<string, unknown> | null;
  onVentaConfirmada?: () => void;
}

interface DatosVenta {
  ok: boolean;
  tieneVenta: boolean;
  producto: string | null;
  cantidad: number;
  total: number;
  adelanto: number;
  saldo: number;
  numeroOrden: string | null;
}

const PACKS_TERMIX = [
  { cant: 1, total: 79, label: "1x Tobillera (S/ 79)" },
  { cant: 2, total: 139, label: "2x Tobilleras Promo (S/ 139)", recomendado: true },
  { cant: 3, total: 189, label: "3x Tobilleras (S/ 189)" },
];

const PACKS_NAC = [
  { cant: 1, total: 119, label: "1x Frasco (S/ 119)" },
  { cant: 2, total: 169, label: "2x Frascos (S/ 169)" },
  { cant: 3, total: 199, label: "3x Frascos Promo (S/ 199)", recomendado: true },
];

export function ConfirmarVentaPanel({
  contactId,
  contactName,
  tags = [],
  customFields,
  onVentaConfirmada,
}: Props) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editando, setEditando] = useState(false);
  const [datosActuales, setDatosActuales] = useState<DatosVenta | null>(null);

  // Formulario
  const [productoSeleccionado, setProductoSeleccionado] = useState<"termix" | "nac" | "otro">("termix");
  const [productoTexto, setProductoTexto] = useState("Tobillera Termix");
  const [cantidad, setCantidad] = useState(2);
  const [totalVenta, setTotalVenta] = useState(139);
  const [adelanto, setAdelanto] = useState(20);

  const saldoACobrar = Math.max(0, totalVenta - adelanto);

  const cargarVenta = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(`/api/contacts/${contactId}/venta`);
      if (!res.ok) return;
      const data = (await res.json()) as DatosVenta;
      setDatosActuales(data);

      if (data.tieneVenta && data.producto && data.total > 0) {
        setEditando(false);
        const prod = data.producto;
        if (/termix|tobillera/i.test(prod)) {
          setProductoSeleccionado("termix");
          setProductoTexto("Tobillera Termix");
        } else if (/nac|nad/i.test(prod)) {
          setProductoSeleccionado("nac");
          setProductoTexto("NAC600 + NAD+");
        } else {
          setProductoSeleccionado("otro");
          setProductoTexto(prod);
        }
        setCantidad(data.cantidad || 1);
        setTotalVenta(data.total);
        setAdelanto(data.adelanto || 20);
      } else {
        // Inicializar sugerencia según tags o contexto
        setEditando(true);
        const tieneTagTermix = tags.some((t) => /termix/i.test(t));
        const tieneTagNac = tags.some((t) => /nac/i.test(t));
        if (tieneTagNac && !tieneTagTermix) {
          setProductoSeleccionado("nac");
          setProductoTexto("NAC600 + NAD+");
          setCantidad(3);
          setTotalVenta(199);
        } else {
          setProductoSeleccionado("termix");
          setProductoTexto("Tobillera Termix");
          setCantidad(2);
          setTotalVenta(139);
        }
      }
    } catch (err) {
      console.warn("Error cargando venta de contacto:", err);
    } finally {
      setLoading(false);
    }
  }, [contactId, tags]);

  useEffect(() => {
    void cargarVenta();
  }, [cargarVenta]);

  const seleccionarProducto = (tipo: "termix" | "nac" | "otro") => {
    setProductoSeleccionado(tipo);
    if (tipo === "termix") {
      setProductoTexto("Tobillera Termix");
      setCantidad(2);
      setTotalVenta(139);
    } else if (tipo === "nac") {
      setProductoTexto("NAC600 + NAD+");
      setCantidad(3);
      setTotalVenta(199);
    } else {
      setProductoTexto("");
      setCantidad(1);
      setTotalVenta(100);
    }
  };

  const seleccionarPack = (cant: number, total: number) => {
    setCantidad(cant);
    setTotalVenta(total);
  };

  const guardarVenta = async () => {
    if (!productoTexto.trim()) {
      toast.error("Ingresa el nombre del producto");
      return;
    }
    if (isNaN(totalVenta) || totalVenta <= 0) {
      toast.error("El monto total debe ser mayor a 0");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch(`/api/contacts/${contactId}/venta`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          producto: productoTexto.trim(),
          cantidad,
          total: totalVenta,
          adelanto,
        }),
      });

      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || "No se pudo guardar la venta");
      }

      toast.success(
        `✅ Venta confirmada: ${cantidad}x ${productoTexto} por S/ ${totalVenta} (Saldo a cobrar: S/ ${saldoACobrar})`
      );

      setEditando(false);
      await cargarVenta();
      onVentaConfirmada?.();

      // Refrescar vistas globales y pipeline
      window.dispatchEvent(new Event("pipeline:refresh"));
      window.dispatchEvent(new Event("contact:updated"));
    } catch (err: any) {
      toast.error(err.message || "Error al confirmar venta");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="px-4 py-4 border-b border-border text-xs text-muted-foreground flex items-center gap-2">
        <RefreshCw className="h-3.5 w-3.5 animate-spin" />
        <span>Cargando datos de venta...</span>
      </div>
    );
  }

  // Vista resumida cuando ya está confirmada y no se está editando
  if (datosActuales?.tieneVenta && datosActuales.producto && datosActuales.total > 0 && !editando) {
    return (
      <div className="px-4 py-4 border-b border-border space-y-3 bg-emerald-50/40 dark:bg-emerald-950/20">
        <div className="flex items-center justify-between">
          <Label className="text-xs font-bold text-emerald-800 dark:text-emerald-300 uppercase tracking-wider flex items-center gap-1.5">
            <ShoppingBag className="h-3.5 w-3.5 text-emerald-600" />
            Venta Confirmada
          </Label>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setEditando(true)}
            className="h-7 text-xs px-2 text-muted-foreground hover:text-foreground cursor-pointer"
          >
            <Edit2 className="h-3 w-3 mr-1" />
            Modificar
          </Button>
        </div>

        <div className="rounded-lg border border-emerald-200 dark:border-emerald-800 bg-card p-3 space-y-2 shadow-2xs">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-xs font-bold text-foreground">
                {datosActuales.cantidad}x {datosActuales.producto}
              </p>
              {datosActuales.numeroOrden && (
                <p className="text-[11px] font-mono text-muted-foreground">
                  Orden: {datosActuales.numeroOrden}
                </p>
              )}
            </div>
            <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-900 text-emerald-800 dark:text-emerald-200">
              S/ {Number(datosActuales.total).toFixed(2)}
            </span>
          </div>

          <div className="pt-2 border-t border-border/60 flex items-center justify-between text-[11px]">
            <span className="text-muted-foreground">Adelanto pagado:</span>
            <span className="font-medium text-emerald-700 dark:text-emerald-400">
              - S/ {Number(datosActuales.adelanto || 20).toFixed(2)}
            </span>
          </div>

          <div className="flex items-center justify-between text-xs font-bold text-foreground pt-1 bg-amber-50 dark:bg-amber-950/40 px-2 py-1.5 rounded-md border border-amber-200/70 dark:border-amber-900/60">
            <span className="text-amber-900 dark:text-amber-200">Saldo a cobrar:</span>
            <span className="text-amber-900 dark:text-amber-100 font-mono text-sm">
              S/ {Number(datosActuales.saldo).toFixed(2)}
            </span>
          </div>
        </div>
      </div>
    );
  }

  // Vista de edición / confirmación
  return (
    <div className="px-4 py-4 border-b border-border space-y-3.5 bg-card">
      <div className="flex items-center justify-between">
        <Label className="text-xs font-bold text-foreground uppercase tracking-wider flex items-center gap-1.5">
          <ShoppingBag className="h-3.5 w-3.5 text-primary" />
          Confirmar Producto y Venta
        </Label>
        {datosActuales?.tieneVenta && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setEditando(false)}
            className="h-6 text-[11px] px-2 text-muted-foreground"
          >
            Cancelar
          </Button>
        )}
      </div>

      <p className="text-[11px] text-muted-foreground leading-snug">
        Elige el producto y pack acordado. Se actualizará la cartilla en el Pipeline y el saldo exacto para Shalom/motorizado.
      </p>

      {/* Selector de Producto Principal */}
      <div className="space-y-1.5">
        <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
          1. Producto
        </span>
        <div className="grid grid-cols-2 gap-1.5">
          <button
            type="button"
            onClick={() => seleccionarProducto("termix")}
            className={cn(
              "px-2.5 py-2 rounded-lg border text-left transition-all cursor-pointer text-xs font-medium",
              productoSeleccionado === "termix"
                ? "border-primary bg-primary/10 text-primary font-bold shadow-2xs"
                : "border-border hover:bg-muted text-muted-foreground"
            )}
          >
            🦵 Tobillera Termix
          </button>
          <button
            type="button"
            onClick={() => seleccionarProducto("nac")}
            className={cn(
              "px-2.5 py-2 rounded-lg border text-left transition-all cursor-pointer text-xs font-medium",
              productoSeleccionado === "nac"
                ? "border-primary bg-primary/10 text-primary font-bold shadow-2xs"
                : "border-border hover:bg-muted text-muted-foreground"
            )}
          >
            🌿 NAC600 + NAD+
          </button>
        </div>

        {productoSeleccionado === "otro" && (
          <Input
            value={productoTexto}
            onChange={(e) => setProductoTexto(e.target.value)}
            placeholder="Nombre del producto..."
            className="h-8 text-xs mt-1"
          />
        )}
      </div>

      {/* Packs Rápidos */}
      {(productoSeleccionado === "termix" || productoSeleccionado === "nac") && (
        <div className="space-y-1.5">
          <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
            <Sparkles className="h-3 w-3 text-amber-500" />
            2. Seleccionar Pack / Cantidad
          </span>
          <div className="flex flex-col gap-1.5">
            {(productoSeleccionado === "termix" ? PACKS_TERMIX : PACKS_NAC).map((pack) => {
              const esActivo = cantidad === pack.cant && totalVenta === pack.total;
              return (
                <button
                  key={pack.cant}
                  type="button"
                  onClick={() => seleccionarPack(pack.cant, pack.total)}
                  className={cn(
                    "w-full flex items-center justify-between px-2.5 py-2 rounded-md border text-xs transition-all cursor-pointer",
                    esActivo
                      ? "border-primary bg-primary/15 text-primary font-bold shadow-2xs"
                      : "border-border hover:bg-muted/70 text-foreground"
                  )}
                >
                  <div className="flex items-center gap-1.5">
                    {esActivo && <Check className="h-3 w-3 text-primary shrink-0" />}
                    <span>{pack.label}</span>
                  </div>
                  <span className="text-[10px] font-semibold text-muted-foreground font-mono">
                    Saldo S/ {pack.total - 20}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Ajustes Manuales de Montos */}
      <div className="grid grid-cols-2 gap-2 pt-1 border-t border-border/50">
        <div>
          <Label className="text-[10px] uppercase font-bold text-muted-foreground">
            Cantidad
          </Label>
          <Input
            type="number"
            min={1}
            value={cantidad}
            onChange={(e) => setCantidad(Math.max(1, parseInt(e.target.value, 10) || 1))}
            className="h-8 text-xs mt-1"
          />
        </div>
        <div>
          <Label className="text-[10px] uppercase font-bold text-muted-foreground">
            Total Venta (S/)
          </Label>
          <Input
            type="number"
            min={1}
            value={totalVenta}
            onChange={(e) => setTotalVenta(Number(e.target.value) || 0)}
            className="h-8 text-xs mt-1 font-semibold"
          />
        </div>
      </div>

      {/* Cuadro de Desglose y Saldo */}
      <div className="rounded-lg border border-border bg-muted/40 p-2.5 space-y-1.5 text-xs">
        <div className="flex justify-between text-muted-foreground text-[11px]">
          <span>Monto total:</span>
          <span className="font-medium text-foreground">S/ {totalVenta.toFixed(2)}</span>
        </div>
        <div className="flex justify-between text-muted-foreground text-[11px]">
          <span>Adelanto pagado:</span>
          <span className="font-medium text-emerald-600 dark:text-emerald-400">
            - S/ {adelanto.toFixed(2)}
          </span>
        </div>
        <div className="pt-1.5 border-t border-border flex items-center justify-between font-bold">
          <span className="text-amber-800 dark:text-amber-300">Saldo a cobrar al cliente:</span>
          <span className="text-amber-900 dark:text-amber-100 font-mono text-sm">
            S/ {saldoACobrar.toFixed(2)}
          </span>
        </div>
      </div>

      <Button
        type="button"
        size="sm"
        disabled={saving || !totalVenta}
        onClick={guardarVenta}
        className="w-full h-8 text-xs font-semibold cursor-pointer shadow-2xs"
      >
        {saving ? (
          <>
            <RefreshCw className="h-3 w-3 animate-spin mr-1.5" />
            Guardando venta...
          </>
        ) : (
          <>
            <Check className="h-3.5 w-3.5 mr-1.5" />
            Guardar y Confirmar Venta
          </>
        )}
      </Button>
    </div>
  );
}
