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
  Save,
  MapPin,
  Send,
  Loader2,
  Sparkles,
  Lock,
  FileImage,
} from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";

export interface SeguimientoShalomData {
  pedidoId?: string | null;
  dealId?: string | null;
  contactId?: string | null;
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
  codigoRastreo?: string | null;
  claveRecojo?: string | null;
  transportadora?: string | null;
  estadoPedido?: string | null;
}

interface SeguimientoShalomModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  data: SeguimientoShalomData;
  onUpdated?: (numeroGuia: string, codigoRastreo: string, claveRecojo: string) => void;
  onAbrirRotulo?: () => void;
}

export function SeguimientoShalomModal({
  open,
  onOpenChange,
  data,
  onUpdated,
  onAbrirRotulo,
}: SeguimientoShalomModalProps) {
  const router = useRouter();

  // Si vino "103386936/7MJM" en numeroGuia, desglosar automáticamente
  const initialGuia = (data.numeroGuia || "").trim();
  const initialCodigo = (data.codigoRastreo || "").trim();

  let defaultGuia = initialGuia;
  let defaultCodigo = initialCodigo;
  if (initialGuia.includes("/") && !initialCodigo) {
    const [g, c] = initialGuia.split("/").map((s) => s.trim());
    defaultGuia = g || "";
    defaultCodigo = c || "";
  }

  const [numeroGuia, setNumeroGuia] = useState(defaultGuia);
  const [codigoRastreo, setCodigoRastreo] = useState(defaultCodigo);
  const [claveRecojo, setClaveRecojo] = useState(data.claveRecojo || "");
  const [estado, setEstado] = useState(data.estadoPedido || "enviado");
  const [saving, setSaving] = useState(false);
  const [sendingAuto, setSendingAuto] = useState(false);
  const [sendingClaveAuto, setSendingClaveAuto] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copiedClave, setCopiedClave] = useState(false);

  // Normalización de centavos vs soles para valor del pedido
  const totalSoles =
    data.total > 1000
      ? Math.round(data.total) / 100
      : Number(data.total || 0);
  const adelantoSoles = 20;
  const saldoSoles = Math.max(0, totalSoles - adelantoSoles);

  const destinoLimpio = [
    data.ciudad,
    data.distrito && data.distrito.toLowerCase() !== data.ciudad?.toLowerCase()
      ? data.distrito
      : null,
  ]
    .filter(Boolean)
    .join(" - ");

  // Mensaje inicial de envío (NUNCA incluye la clave secreta de recojo para asegurar el cobro del saldo)
  const generarTextoSeguimiento = () => {
    const guiaText = numeroGuia.trim() || "(En proceso de emisión)";
    const codigoText = codigoRastreo.trim() || "(En proceso)";

    return `¡Hola, ${data.clienteNombre.split(" ")[0]}! 👋 Te saluda Aliv Perú.
Te compartimos los datos de tu envío por *Shalom Empresarial* 🚚📦:

• *N° de Orden Shalom:* ${guiaText}
• *Código de Orden:* ${codigoText}
• *Destino / Agencia:* ${destinoLimpio || "Provincia"}

💰 *Detalle de Pago:*
• Monto total del pedido: S/ ${totalSoles.toFixed(2)}
• Adelanto de envío recibido: - S/ ${adelantoSoles.toFixed(2)}
━━━━━━━━━━━━━━━━━━━━
👉 *Saldo restante por pagar al retirar:* *S/ ${saldoSoles.toFixed(2)}*

🔒 *Clave de Recojo en Agencia:*
Tu clave secreta de recojo te la enviaremos por aquí en cuanto confirmes el pago del saldo restante de *S/ ${saldoSoles.toFixed(2)}* a nuestro Yape / Plin (*951365418* - Gerardo Huaynalaya).

🔍 *Rastrea tu paquete en tiempo real:*
Ingresa a 👉 https://shalom.com.pe/rastrea/
Coloca tu *N° de Orden* (${guiaText}) y tu *Código* (${codigoText}) para ver dónde se encuentra tu envío.

¡Muchas gracias por tu compra en Aliv Perú! 🌿`;
  };

  // Mensaje posterior cuando el cliente ya transfirió el saldo restante
  const generarTextoClave = () => {
    return `¡Pago del saldo de S/ ${saldoSoles.toFixed(2)} confirmado con éxito! 🙌🎉

🔑 Tu *Clave / Código de Recojo en Agencia Shalom* es: *${claveRecojo.trim()}*
📦 N° de Orden Shalom: ${numeroGuia.trim() || data.numeroOrden}
🏷️ Código de Orden: ${codigoRastreo.trim() || "-"}
📍 Destino: ${destinoLimpio || "Agencia Shalom"}

Recuerda acudir con tu DNI físico original para el retiro. ¡Que disfrutes tus productos Aliv! 💚`;
  };

  const handleCopiarMensaje = () => {
    const texto = generarTextoSeguimiento();
    navigator.clipboard.writeText(texto);
    setCopied(true);
    toast.success("Mensaje copiado (código de recojo reservado)");
    setTimeout(() => setCopied(false), 2500);
  };

  const handleCopiarMensajeClave = () => {
    if (!claveRecojo.trim()) {
      toast.error("Registra primero la clave de recojo de Shalom");
      return;
    }
    const texto = generarTextoClave();
    navigator.clipboard.writeText(texto);
    setCopiedClave(true);
    toast.success("Mensaje con Clave de Recojo copiado para WhatsApp");
    setTimeout(() => setCopiedClave(false), 2500);
  };

  const guardarEnBaseDeDatos = async () => {
    const res = await fetch("/api/pedidos/seguimiento", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        pedidoId: data.pedidoId,
        dealId: data.dealId,
        numeroOrden: data.numeroOrden,
        transportadora: "Shalom",
        numeroGuia: numeroGuia.trim(),
        codigoRastreo: codigoRastreo.trim(),
        claveRecojo: claveRecojo.trim(),
        estado,
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || "No se pudo guardar el seguimiento");
    }
  };

  const handleGuardar = async () => {
    setSaving(true);
    try {
      await guardarEnBaseDeDatos();
      onUpdated?.(numeroGuia.trim(), codigoRastreo.trim(), claveRecojo.trim());
      toast.success("Seguimiento de Shalom guardado exitosamente");
      onOpenChange(false);
      router.refresh();
    } catch (e: any) {
      toast.error(e.message || "Error al guardar seguimiento");
    } finally {
      setSaving(false);
    }
  };

  // Envío automático del mensaje de seguimiento por WhatsApp
  const handleEnviarAuto = async () => {
    if (!numeroGuia.trim()) {
      toast.error("Ingresa el N° de Orden de Shalom antes de enviar");
      return;
    }

    setSendingAuto(true);
    const texto = generarTextoSeguimiento();

    try {
      // 1. Guardar primero en la base de datos
      await guardarEnBaseDeDatos();
      onUpdated?.(numeroGuia.trim(), codigoRastreo.trim(), claveRecojo.trim());

      // 2. Enviar por WhatsApp vía API
      if (data.telefono) {
        const res = await fetch("/api/whatsapp/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            to: data.telefono,
            contactId: data.contactId,
            text: texto,
          }),
        });

        if (res.ok) {
          toast.success("✅ ¡Mensaje de seguimiento enviado por WhatsApp al cliente!");
          onOpenChange(false);
          router.refresh();
          return;
        }
      }

      // Fallback: Si no hay teléfono o ventana cerrada, copiar al portapapeles
      navigator.clipboard.writeText(texto);
      toast.info("Seguimiento guardado y mensaje copiado al portapapeles");
      onOpenChange(false);
      router.refresh();
    } catch (err: any) {
      navigator.clipboard.writeText(texto);
      toast.error(err.message || "No se pudo enviar auto; mensaje copiado al portapapeles");
    } finally {
      setSendingAuto(false);
    }
  };

  // Envío automático de la clave de recojo tras confirmar el pago
  const handleEnviarClaveAuto = async () => {
    if (!claveRecojo.trim()) {
      toast.error("Registra la clave de recojo antes de enviar");
      return;
    }

    setSendingClaveAuto(true);
    const texto = generarTextoClave();

    try {
      await guardarEnBaseDeDatos();
      onUpdated?.(numeroGuia.trim(), codigoRastreo.trim(), claveRecojo.trim());

      if (data.telefono) {
        const res = await fetch("/api/whatsapp/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            to: data.telefono,
            contactId: data.contactId,
            text: texto,
          }),
        });

        if (res.ok) {
          toast.success("✅ ¡Clave de recojo enviada por WhatsApp al cliente!");
          onOpenChange(false);
          router.refresh();
          return;
        }
      }

      navigator.clipboard.writeText(texto);
      toast.info("Clave guardada y mensaje copiado al portapapeles");
      onOpenChange(false);
      router.refresh();
    } catch (err: any) {
      navigator.clipboard.writeText(texto);
      toast.error(err.message || "Error al enviar clave auto; copiada al portapapeles");
    } finally {
      setSendingClaveAuto(false);
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
              href="https://shalom.com.pe/rastrea/"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-[11px] font-semibold text-red-600 hover:text-red-700 bg-white dark:bg-card px-2 py-1 rounded border border-red-200 shadow-2xs transition-colors"
            >
              <span>shalom.com.pe/rastrea</span>
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>

          <div className="grid grid-cols-2 gap-2 pt-1.5 border-t border-red-200/50 dark:border-red-900/30">
            <div>
              <p className="text-[10px] text-muted-foreground">Destino / Agencia</p>
              <p className="font-semibold text-foreground flex items-center gap-1">
                <MapPin className="h-3 w-3 text-red-500 shrink-0" />
                <span className="truncate">{destinoLimpio || "En agencia"}</span>
              </p>
            </div>
            <div className="bg-white/80 dark:bg-card/80 p-1.5 rounded border border-red-100 dark:border-red-900/30">
              <div className="flex justify-between text-[10px] text-muted-foreground">
                <span>Total orden:</span>
                <span className="tabular-nums">S/ {totalSoles.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-[10px] text-emerald-700 dark:text-emerald-400">
                <span>Adelanto pago:</span>
                <span className="tabular-nums">- S/ {adelantoSoles.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-[11px] font-bold text-red-700 dark:text-red-400 pt-0.5 border-t border-dashed border-red-200 mt-0.5">
                <span>Saldo a cobrar:</span>
                <span className="tabular-nums text-foreground">S/ {saldoSoles.toFixed(2)}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Formulario para registrar / editar Guía, Código de Rastreo y Clave Secreta */}
        <div className="space-y-2.5 py-1">
          <div className="grid grid-cols-2 gap-2.5">
            <div className="space-y-1">
              <Label htmlFor="shalom-guia" className="text-xs font-semibold">
                N° de Orden Shalom:
              </Label>
              <Input
                id="shalom-guia"
                placeholder="Ej. 103386936"
                value={numeroGuia}
                onChange={(e) => setNumeroGuia(e.target.value.trim())}
                className="text-xs font-mono h-8 font-semibold"
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="shalom-codigo" className="text-xs font-semibold">
                Código de Orden:
              </Label>
              <Input
                id="shalom-codigo"
                placeholder="Ej. 7MJM"
                value={codigoRastreo}
                onChange={(e) => setCodigoRastreo(e.target.value.toUpperCase().trim())}
                className="text-xs font-mono font-bold tracking-wider h-8 uppercase"
              />
            </div>
          </div>
          <p className="text-[10px] text-muted-foreground leading-tight">
            ℹ️ Ambos datos figuran en el rótulo de Shalom y son requeridos para consultar en <strong className="text-red-600">shalom.com.pe/rastrea</strong>.
          </p>

          <div className="space-y-1 pt-1">
            <div className="flex justify-between items-center">
              <Label htmlFor="shalom-clave" className="text-xs font-semibold flex items-center gap-1">
                <Lock className="h-3 w-3 text-amber-600" />
                <span>Clave Secreta de Recojo en Agencia:</span>
              </Label>
              <span className="text-[9.5px] text-amber-700 dark:text-amber-400 font-semibold bg-amber-500/10 px-1.5 py-0.2 rounded">
                🔒 No compartir hasta pagar saldo
              </span>
            </div>
            <Input
              id="shalom-clave"
              placeholder="Ej. 1330"
              value={claveRecojo}
              onChange={(e) => setClaveRecojo(e.target.value.toUpperCase().trim())}
              className="text-xs font-mono font-bold tracking-wider h-8"
            />
          </div>

          <div className="space-y-1">
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

        {/* Acciones de Envío Automático y Copia */}
        <div className="flex flex-col gap-2 pt-2 border-t border-border/50">
          {/* Botón Principal: Envío Automático WhatsApp */}
          <Button
            type="button"
            variant="default"
            size="sm"
            disabled={sendingAuto || saving}
            onClick={handleEnviarAuto}
            className="w-full h-8.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs gap-1.5 shadow-sm cursor-pointer"
            title="Guarda y envía el mensaje de seguimiento de Shalom automáticamente por WhatsApp al cliente"
          >
            {sendingAuto ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                <span>Enviando WhatsApp al cliente...</span>
              </>
            ) : (
              <>
                <Send className="h-3.5 w-3.5" />
                <span>Enviar WhatsApp Automático (Seguimiento y Saldo)</span>
              </>
            )}
          </Button>

          <div className="flex items-center justify-between gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleCopiarMensaje}
              className="text-xs h-8 flex-1"
              title="Copiar mensaje con orden, código y saldo al portapapeles"
            >
              {copied ? (
                <>
                  <Check className="h-3.5 w-3.5 mr-1 text-emerald-600" />
                  Copiado (Sin clave)
                </>
              ) : (
                <>
                  <Copy className="h-3.5 w-3.5 mr-1" />
                  Copiar Mensaje
                </>
              )}
            </Button>

            {claveRecojo.trim() && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={sendingClaveAuto}
                onClick={handleEnviarClaveAuto}
                className="text-xs h-8 flex-1 bg-amber-500/10 hover:bg-amber-500/20 text-amber-700 dark:text-amber-400 border-amber-500/30 font-semibold"
                title="Enviar la clave de recojo automáticamente por WhatsApp tras confirmar el pago del saldo"
              >
                {sendingClaveAuto ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                    Enviando clave...
                  </>
                ) : (
                  <>
                    <Lock className="h-3.5 w-3.5 mr-1" />
                    Enviar Clave Auto
                  </>
                )}
              </Button>
            )}
          </div>

          <div className="flex items-center justify-between gap-2 pt-1 border-t border-border/30">
            {onAbrirRotulo && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  onOpenChange(false);
                  onAbrirRotulo();
                }}
                className="text-xs h-8 text-red-600 border-red-200 hover:bg-red-50 dark:hover:bg-red-950/30 font-semibold gap-1.5 cursor-pointer"
                title="Generar la imagen oficial del rótulo Shalom para este paquete"
              >
                <FileImage className="h-3.5 w-3.5" />
                <span>Ver Rótulo (Imagen)</span>
              </Button>
            )}

            <div className="flex items-center gap-2 ml-auto">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => onOpenChange(false)}
                className="text-xs h-8"
              >
                Cancelar
              </Button>
              <Button
                type="button"
                variant="default"
                size="sm"
                disabled={saving || sendingAuto}
                onClick={handleGuardar}
                className="text-xs h-8 bg-red-600 hover:bg-red-700 text-white font-semibold cursor-pointer"
              >
                <Save className="h-3.5 w-3.5 mr-1.5" />
                {saving ? "Guardando..." : "Guardar sin Enviar"}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
