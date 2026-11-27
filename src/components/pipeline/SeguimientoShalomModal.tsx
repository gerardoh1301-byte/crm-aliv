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
  Package,
  FileImage,
  MessageCircle,
} from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { GuiaPdfDrive } from "./GuiaPdfDrive";

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
  /** Flete que se le pagó a Shalom (soles), si ya se registró. */
  fleteShalom?: number | null;
  /** Productos de la orden, para ver qué se empaca y envía sin salir del modal. */
  productos?: Array<{ titulo?: string | null; cantidad?: number | null }> | null;
}

interface SeguimientoShalomModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  data: SeguimientoShalomData;
  onUpdated?: (
    numeroGuia: string,
    codigoRastreo: string,
    claveRecojo: string,
    agencia?: string,
    nuevoTotal?: number
  ) => void;
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
  const fleteInicial = data.fleteShalom === null || data.fleteShalom === undefined ? "" : String(data.fleteShalom);
  const [flete, setFlete] = useState(fleteInicial);
  const [estado, setEstado] = useState(data.estadoPedido || "enviado");
  const [saving, setSaving] = useState(false);
  const [sendingAuto, setSendingAuto] = useState(false);
  const [sendingClaveAuto, setSendingClaveAuto] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copiedClave, setCopiedClave] = useState(false);

  // Normalización de centavos vs soles para valor del pedido
  const totalBase =
    data.total > 1000
      ? Math.round(data.total) / 100
      : Number(data.total || 0);
  const [totalSoles, setTotalSoles] = useState(totalBase);
  const [adelantoSoles, setAdelantoSoles] = useState(20);
  const saldoSoles = Math.max(0, totalSoles - adelantoSoles);

  const destinoLimpio = [
    data.ciudad,
    data.distrito && data.distrito.toLowerCase() !== data.ciudad?.toLowerCase()
      ? data.distrito
      : null,
  ]
    .filter(Boolean)
    .join(" - ");

  // Inicializar agencia/destino con la dirección guardada o con ciudad/distrito
  const initialDestino =
    (data.direccion && data.direccion.trim()) ||
    destinoLimpio ||
    "Agencia Shalom";

  const [agenciaDestino, setAgenciaDestino] = useState(initialDestino);

  // Mensaje inicial de envío (NUNCA incluye la clave secreta de recojo para asegurar el cobro del saldo)
  const generarTextoSeguimiento = () => {
    const guiaText = numeroGuia.trim() || "(En proceso de emisión)";
    const codigoText = codigoRastreo.trim() || "(En proceso)";
    const agenciaText = agenciaDestino.trim() || destinoLimpio || "Provincia";

    return `¡Hola, ${data.clienteNombre.split(" ")[0]}! 👋 Te saluda Aliv Perú.
Te compartimos los datos de tu envío por *Shalom Empresarial* 🚚📦:

• *N° de Orden Shalom:* ${guiaText}
• *Código de Orden:* ${codigoText}
• *Destino / Agencia:* ${agenciaText}

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

¿Me confirmas con un *OK* que recibiste estos datos? Así te aviso por aquí apenas tu pedido llegue a la agencia 🙌`;
  };

  // Mensaje posterior cuando el cliente ya transfirió el saldo restante
  const generarTextoClave = () => {
    const agenciaText = agenciaDestino.trim() || destinoLimpio || "Agencia Shalom";

    return `¡Pago del saldo de S/ ${saldoSoles.toFixed(2)} confirmado con éxito! 🙌🎉

🔑 Tu *Clave / Código de Recojo en Agencia Shalom* es: *${claveRecojo.trim()}*
📦 N° de Orden Shalom: ${numeroGuia.trim() || data.numeroOrden}
🏷️ Código de Orden: ${codigoRastreo.trim() || "-"}
📍 Destino: ${agenciaText}

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
        agencia: agenciaDestino.trim(),
        total: totalSoles,
        estado,
      }),
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(json.error || "No se pudo guardar el seguimiento");
    }

    if (json.advertencia) {
      toast.warning(json.advertencia, { duration: 7000 });
    }
    await guardarFlete();
    return json;
  };

  /**
   * El flete va al mismo registro que «Dinero del pedido» (solo la etiqueta del flete;
   * adelanto y saldo no se tocan). Si falla, el seguimiento igual queda guardado.
   */
  const guardarFlete = async () => {
    const valor = flete.trim().replace(",", ".");
    if (!valor || valor === fleteInicial) return;
    const numero = Number(valor);
    if (!Number.isFinite(numero) || numero < 0) {
      toast.warning("El flete Shalom no es un número válido: no se guardó");
      return;
    }
    const res = await fetch("/api/pedidos/finanzas-shalom", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dealId: data.dealId, pedidoId: data.pedidoId, numeroOrden: data.numeroOrden, fleteShalom: numero }),
    }).catch(() => null);
    const j = res ? await res.json().catch(() => ({})) : {};
    if (!res?.ok || !j.ok) {
      toast.warning(`El flete no se guardó: ${j.error || (res?.status === 403 ? "solo un administrador puede registrarlo" : "error de conexión")}`, { duration: 7000 });
      return;
    }
    window.dispatchEvent(new Event("pipeline:refresh"));
  };

  const handleGuardar = async () => {
    setSaving(true);
    try {
      const resData = await guardarEnBaseDeDatos();
      onUpdated?.(numeroGuia.trim(), codigoRastreo.trim(), claveRecojo.trim(), agenciaDestino.trim(), totalSoles);
      if (!resData?.advertencia) {
        toast.success("Seguimiento de Shalom guardado exitosamente");
      }
      onOpenChange(false);
      router.refresh();
    } catch (e: any) {
      toast.error(e.message || "Error al guardar seguimiento");
    } finally {
      setSaving(false);
    }
  };

  const getCleanPhone = () => {
    const raw = (data.telefono || "").replace(/\D/g, "");
    if (!raw) return "";
    return raw.length === 9 ? `51${raw}` : raw;
  };

  const handleAbrirWhatsAppWeb = (tipo: "seguimiento" | "clave") => {
    const phone = getCleanPhone();
    if (!phone) {
      toast.error("No hay número de teléfono registrado para este cliente");
      return;
    }
    const texto = tipo === "clave" ? generarTextoClave() : generarTextoSeguimiento();
    navigator.clipboard.writeText(texto);
    toast.success("Mensaje copiado. Abriendo WhatsApp...", { duration: 3000 });
    window.open(
      `https://wa.me/${phone}?text=${encodeURIComponent(texto)}`,
      "_blank",
      "noopener,noreferrer"
    );
  };

  // Envío automático del mensaje de seguimiento por WhatsApp
  const handleEnviarAuto = async () => {
    if (!numeroGuia.trim()) {
      toast.error("Ingresa el N° de Orden de Shalom antes de enviar");
      return;
    }

    setSendingAuto(true);
    const texto = generarTextoSeguimiento();
    const phone = getCleanPhone();

    try {
      // 1. Guardar primero en la base de datos
      await guardarEnBaseDeDatos();
      onUpdated?.(numeroGuia.trim(), codigoRastreo.trim(), claveRecojo.trim(), agenciaDestino.trim(), totalSoles);

      // 2. Enviar por WhatsApp vía API
      if (phone) {
        const res = await fetch("/api/whatsapp/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            to: `+${phone}`,
            contactId: data.contactId,
            text: texto,
          }),
        });

        const json = await res.json().catch(() => ({}));

        if (res.ok && json.success) {
          toast.success("✅ ¡Mensaje de seguimiento enviado por WhatsApp al cliente!");
          onOpenChange(false);
          router.refresh();
          return;
        }

        // Si la ventana de 24h está cerrada por Meta
        if (json.outsideWindow || res.status === 403) {
          navigator.clipboard.writeText(texto);
          toast.warning(
            "⚠️ Ventana de 24h cerrada por Meta. Abriendo WhatsApp Web con el mensaje listo...",
            { duration: 5000 }
          );
          window.open(
            `https://wa.me/${phone}?text=${encodeURIComponent(texto)}`,
            "_blank",
            "noopener,noreferrer"
          );
          onOpenChange(false);
          router.refresh();
          return;
        }

        // Si la API devolvió otro error
        navigator.clipboard.writeText(texto);
        toast.error(
          json.error || "No se pudo enviar por API; abriendo WhatsApp Web...",
          { duration: 5000 }
        );
        window.open(
          `https://wa.me/${phone}?text=${encodeURIComponent(texto)}`,
          "_blank",
          "noopener,noreferrer"
        );
        onOpenChange(false);
        router.refresh();
        return;
      }

      // Fallback: Si no hay teléfono
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
    const phone = getCleanPhone();

    // Entregar la clave implica que el saldo ya se verificó: se registra como cobrado y
    // la tarjeta pasa a «Entregado y cobrado». Se llama cuando la clave sale por API o
    // queda lista en WhatsApp Web / portapapeles para enviarla a mano.
    let pedidoIdGuardado: string | null = data.pedidoId ?? null;
    const registrarEntrega = async () => {
      if (!pedidoIdGuardado) {
        toast.warning("Clave enviada, pero no encontré el pedido para registrar el saldo; hazlo a mano.");
        return;
      }
      try {
        const r = await fetch("/api/pedidos/clave-entregada", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pedidoId: pedidoIdGuardado }),
        });
        const j = await r.json().catch(() => ({}));
        if (r.ok && j.ok) {
          toast.success(
            j.saldoRegistrado != null
              ? `💰 Saldo de S/ ${Number(j.saldoRegistrado).toFixed(2)} registrado y pedido en «Entregado y cobrado»`
              : "📦 Pedido en «Entregado y cobrado»"
          );
        } else {
          toast.error(j.texto || j.error || "No se pudo registrar el saldo ni mover la tarjeta; hazlo a mano.", {
            duration: 7000,
          });
        }
      } catch {
        toast.error("No se pudo registrar el saldo ni mover la tarjeta; hazlo a mano.", { duration: 7000 });
      }
    };

    try {
      const guardado = await guardarEnBaseDeDatos();
      pedidoIdGuardado = guardado?.pedido?.id ?? pedidoIdGuardado;
      onUpdated?.(numeroGuia.trim(), codigoRastreo.trim(), claveRecojo.trim(), agenciaDestino.trim(), totalSoles);

      if (phone) {
        const res = await fetch("/api/whatsapp/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            to: `+${phone}`,
            contactId: data.contactId,
            text: texto,
            // La clave sale del número del vendedor dueño del cliente (27/11).
            desdeNumeroVendedor: true,
          }),
        });

        const json = await res.json().catch(() => ({}));

        if (res.ok && json.success) {
          toast.success("✅ ¡Clave de recojo enviada por WhatsApp al cliente!");
          await registrarEntrega();
          onOpenChange(false);
          router.refresh();
          return;
        }

        // Si la ventana de 24h está cerrada por Meta
        if (json.outsideWindow || res.status === 403) {
          navigator.clipboard.writeText(texto);
          toast.warning(
            "⚠️ Ventana de 24h cerrada por Meta. Abriendo WhatsApp Web con el mensaje listo...",
            { duration: 5000 }
          );
          window.open(
            `https://wa.me/${phone}?text=${encodeURIComponent(texto)}`,
            "_blank",
            "noopener,noreferrer"
          );
          await registrarEntrega();
          onOpenChange(false);
          router.refresh();
          return;
        }

        // Si la API devolvió otro error
        navigator.clipboard.writeText(texto);
        toast.error(
          json.error || "No se pudo enviar por API; abriendo WhatsApp Web...",
          { duration: 5000 }
        );
        window.open(
          `https://wa.me/${phone}?text=${encodeURIComponent(texto)}`,
          "_blank",
          "noopener,noreferrer"
        );
        await registrarEntrega();
        onOpenChange(false);
        router.refresh();
        return;
      }

      navigator.clipboard.writeText(texto);
      toast.info("Clave guardada y mensaje copiado al portapapeles");
      await registrarEntrega();
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
      <DialogContent className="max-w-md sm:max-w-md max-h-[92vh] overflow-y-auto p-5 bg-card">
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
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
            <span className="text-muted-foreground">
              DNI:{" "}
              <span className="font-mono font-semibold text-foreground select-all">
                {data.dni?.trim() || "sin registrar"}
              </span>
            </span>
            <span className="text-muted-foreground">
              Celular:{" "}
              <span className="font-mono font-semibold text-foreground select-all">
                {(data.telefono || "").replace(/^\+?51/, "").trim() || "sin registrar"}
              </span>
            </span>
          </div>
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

          {(data.productos?.length ?? 0) > 0 && (
            <div className="pt-1.5 border-t border-red-200/50 dark:border-red-900/30">
              <p className="text-[10px] text-muted-foreground">Producto</p>
              <ul className="space-y-0.5">
                {data.productos!.map((it, i) => (
                  <li key={i} className="font-semibold text-sm text-foreground flex items-center gap-1.5">
                    <Package className="h-3.5 w-3.5 text-red-500 shrink-0" />
                    <span className="font-extrabold">{Number(it.cantidad) || 1}x</span>
                    <span className="truncate">{it.titulo || "Producto"}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="grid grid-cols-2 gap-2 pt-1.5 border-t border-red-200/50 dark:border-red-900/30">
            <div>
              <p className="text-[10px] text-muted-foreground">Destino / Agencia</p>
              <p className="font-semibold text-foreground flex items-center gap-1">
                <MapPin className="h-3 w-3 text-red-500 shrink-0" />
                <span className="truncate">{agenciaDestino.trim() || destinoLimpio || "En agencia"}</span>
              </p>
            </div>
            <div className="bg-white/80 dark:bg-card/80 p-1.5 rounded border border-red-100 dark:border-red-900/30">
              <div className="flex justify-between items-center text-[10px] text-muted-foreground">
                <span>Total orden:</span>
                <div className="flex items-center gap-0.5">
                  <span className="text-[10px] font-medium text-foreground">S/</span>
                  <input
                    type="number"
                    step="1"
                    value={totalSoles}
                    onChange={(e) => setTotalSoles(Number(e.target.value) || 0)}
                    className="w-16 h-5 text-right px-1 font-mono text-[11px] font-semibold text-foreground bg-white dark:bg-background border border-red-200 dark:border-red-900/40 rounded focus:outline-none focus:ring-1 focus:ring-red-500"
                    title="Editar monto total de la orden si varió el pedido o precio"
                  />
                </div>
              </div>
              <div className="flex justify-between items-center text-[10px] text-emerald-700 dark:text-emerald-400 mt-1">
                <span>Adelanto pago:</span>
                <div className="flex items-center gap-0.5">
                  <span className="text-[10px] font-medium">- S/</span>
                  <input
                    type="number"
                    step="1"
                    value={adelantoSoles}
                    onChange={(e) => setAdelantoSoles(Number(e.target.value) || 0)}
                    className="w-14 h-5 text-right px-1 font-mono text-[11px] font-semibold text-emerald-700 dark:text-emerald-400 bg-white dark:bg-background border border-emerald-200 dark:border-emerald-900/40 rounded focus:outline-none focus:ring-1 focus:ring-emerald-500"
                    title="Editar monto del adelanto pagado"
                  />
                </div>
              </div>
              <div className="flex justify-between items-center text-[11px] font-bold text-red-700 dark:text-red-400 pt-1 border-t border-dashed border-red-200 mt-1">
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

          {data.pedidoId && (
            <GuiaPdfDrive
              pedidoId={data.pedidoId}
              antesDeSubir={async () => {
                if (!numeroGuia.trim()) return;
                await guardarEnBaseDeDatos();
                onUpdated?.(numeroGuia.trim(), codigoRastreo.trim(), claveRecojo.trim(), agenciaDestino.trim(), totalSoles);
              }}
              onLeido={(n, c) => {
                if (n && !numeroGuia.trim()) setNumeroGuia(n);
                if (c && !codigoRastreo.trim()) setCodigoRastreo(c);
              }}
            />
          )}

          <div className="space-y-1">
            <Label htmlFor="shalom-flete" className="text-xs font-semibold">
              Flete pagado a Shalom (S/):
            </Label>
            <Input
              id="shalom-flete"
              type="number"
              step="0.01"
              min="0"
              placeholder="Ej. 10.00"
              value={flete}
              onChange={(e) => setFlete(e.target.value)}
              className="text-xs h-8 w-32 tabular-nums"
            />
            <p className="text-[10px] text-muted-foreground leading-tight">
              Se guarda junto con la guía y pasa al ERP como costo del pedido (cuenta BCP, fecha de hoy).
            </p>
          </div>

          {/* Campo editable: Agencia Shalom / Destino de Entrega */}
          <div className="space-y-1 pt-0.5">
            <div className="flex justify-between items-center">
              <Label htmlFor="shalom-agencia" className="text-xs font-semibold flex items-center gap-1">
                <MapPin className="h-3 w-3 text-red-600" />
                <span>Agencia Shalom de Entrega (Destino):</span>
              </Label>
              <span className="text-[9.5px] text-muted-foreground">
                Cambia aquí si solicitó otra agencia
              </span>
            </div>
            <Input
              id="shalom-agencia"
              placeholder="Ej. Chiclayo - Av. Bolognesi / Agencia Central"
              value={agenciaDestino}
              onChange={(e) => setAgenciaDestino(e.target.value)}
              className="text-xs font-medium h-8"
            />
          </div>

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
            <p className="text-[10px] text-muted-foreground leading-tight">
              💡 Si Shalom registró esta clave en la agencia física, puedes guardarla y enviarla sin restricción (el sistema te avisará si se utilizó antes, pero no te bloqueará).
            </p>
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
          {/* Fila 1: Seguimiento inicial (N° orden, código y saldo) */}
          <div className="flex items-center gap-1.5">
            <Button
              type="button"
              variant="default"
              size="sm"
              disabled={sendingAuto || saving}
              onClick={handleEnviarAuto}
              className="flex-1 h-8.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs gap-1.5 shadow-sm cursor-pointer"
              title="Guarda y envía el mensaje de seguimiento de Shalom por WhatsApp al cliente"
            >
              {sendingAuto ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span>Enviando WhatsApp...</span>
                </>
              ) : (
                <>
                  <Send className="h-3.5 w-3.5" />
                  <span>Enviar WhatsApp (Seguimiento)</span>
                </>
              )}
            </Button>

            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => handleAbrirWhatsAppWeb("seguimiento")}
              className="text-xs h-8.5 px-2.5 text-emerald-700 dark:text-emerald-400 border-emerald-500/30 hover:bg-emerald-50 dark:hover:bg-emerald-950/20 font-medium cursor-pointer"
              title="Abrir directamente en WhatsApp Web con el mensaje de seguimiento"
            >
              <MessageCircle className="h-3.5 w-3.5 mr-1" />
              <span>Web</span>
            </Button>

            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleCopiarMensaje}
              className="text-xs h-8.5 px-2.5 cursor-pointer"
              title="Copiar mensaje con orden, código y saldo al portapapeles"
            >
              {copied ? (
                <Check className="h-3.5 w-3.5 text-emerald-600" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
            </Button>
          </div>

          {/* Fila 2: Clave Secreta de Recojo (cuando existe) */}
          {claveRecojo.trim() && (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 space-y-1.5">
              <div className="flex items-center justify-between text-[11px] font-semibold text-amber-800 dark:text-amber-300">
                <span className="flex items-center gap-1">
                  <Lock className="h-3 w-3" />
                  Clave de Recojo: <span className="font-mono bg-amber-200 dark:bg-amber-900 px-1.5 py-0.5 rounded font-bold">{claveRecojo.trim()}</span>
                </span>
                <span className="text-[10px] text-muted-foreground">Enviar solo tras pago del saldo</span>
              </div>
              <div className="flex items-center gap-1.5">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={sendingClaveAuto}
                  onClick={handleEnviarClaveAuto}
                  className="flex-1 text-xs h-8 bg-amber-600 hover:bg-amber-700 text-white border-amber-600 font-bold cursor-pointer"
                  title="Envía la clave por WhatsApp (o abre WhatsApp Web si la ventana de 24 h está cerrada). Al enviarla, el saldo queda registrado como cobrado y el pedido pasa a Entregado y cobrado."
                >
                  {sendingClaveAuto ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                      Enviando clave...
                    </>
                  ) : (
                    <>
                      <Lock className="h-3.5 w-3.5 mr-1" />
                      🔒 Enviar Clave Auto
                    </>
                  )}
                </Button>

                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => handleAbrirWhatsAppWeb("clave")}
                  className="text-xs h-8 px-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-medium cursor-pointer"
                  title="Abrir directamente en WhatsApp Web con la clave de recojo lista para enviar"
                >
                  <MessageCircle className="h-3.5 w-3.5 mr-1" />
                  <span>Web</span>
                </Button>

                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleCopiarMensajeClave}
                  className="text-xs h-8 px-2.5 bg-card hover:bg-accent border-border cursor-pointer"
                  title="Copiar mensaje con la clave de recojo al portapapeles"
                >
                  {copiedClave ? (
                    <Check className="h-3.5 w-3.5 text-emerald-600" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                </Button>
              </div>
            </div>
          )}

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
