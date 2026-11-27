"use client";

import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatCurrency } from "@/lib/constants";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  MoreHorizontal,
  Phone,
  MessageCircle,
  FileText,
  CheckSquare,
  Calendar,
  MapPin,
  Printer,
  Truck,
  UserCheck,
  Clock,
  Package,
  FileImage,
  PackageCheck,
  Landmark,
  CheckCircle2,
  ArrowLeftRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { enlaceLlamadaWhatsApp, PESTANA_WHATSAPP_WEB } from "@/lib/llamada-whatsapp";
import { avatarBg, getInitials } from "@/lib/avatar";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { RotuloMotorizadoModal, type RotuloData } from "./RotuloMotorizadoModal";
import { RotuloShalomModal, type RotuloShalomData } from "./RotuloShalomModal";
import {
  SeguimientoShalomModal,
  type SeguimientoShalomData,
} from "./SeguimientoShalomModal";
import { AsignarVendedorModal } from "./AsignarVendedorModal";
import { useEsAdmin } from "@/lib/use-es-admin";
import { DespacharAliclikModal, type DespacharAliclikModalData } from "./DespacharAliclikModal";
import { LiquidarAliclikModal, type LiquidacionAliclikData } from "./LiquidarAliclikModal";
import { FinanzasShalomModal } from "./FinanzasShalomModal";
import { etiquetaValidacion, tipoValidacion } from "@/lib/pedidos/validar-reglas";
import { saldoPorClaveEntregada, type FinanzasShalom } from "@/lib/finanzas/tags-shalom";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export interface DealCardProps {
  id: string;
  title: string;
  value: number;
  contactId?: string | null;
  contactName?: string | null;
  contactPhone?: string | null;
  contactEmail?: string | null;
  probability: number;
  expectedClose?: Date | string | null;
  notes?: string | null;
  docCount?: number;
  ciudad?: string | null;
  distrito?: string | null;
  direccion?: string | null;
  referencia?: string | null;
  numeroOrden?: string | null;
  dniCliente?: string | null;
  stageKey?: string | null;
  stageName?: string | null;
  pedidoId?: string | null;
  transportadora?: string | null;
  numeroGuia?: string | null;
  codigoRastreo?: string | null;
  claveRecojo?: string | null;
  estadoPedido?: string | null;
  ordenItems?: Array<{ sku?: string; titulo: string; cantidad: number; precioUnitario?: number }> | string | null;
  ordenTotal?: string | null;
  ordenModalidadPago?: string | null;
  ownerId?: string | null;
  ownerName?: string | null;
  tags?: string[];
  liquidacionAliclik?: LiquidacionAliclikData | null;
  finanzasShalom?: FinanzasShalom | null;
  /** Contra entrega por AliClik (Lima o provincia): no lleva guía ni dinero de Shalom. */
  entregaAliclik?: boolean;
}

export function DealCard({
  id,
  title,
  value,
  contactId,
  contactName,
  contactPhone,
  probability,
  expectedClose,
  docCount = 0,
  ciudad,
  distrito,
  direccion,
  referencia,
  numeroOrden,
  dniCliente,
  stageKey,
  stageName,
  pedidoId,
  transportadora,
  numeroGuia,
  codigoRastreo,
  claveRecojo,
  estadoPedido,
  ordenItems,
  ordenTotal,
  ordenModalidadPago,
  ownerId,
  ownerName,
  tags = [],
  liquidacionAliclik,
  finanzasShalom,
  entregaAliclik = false,
}: DealCardProps) {
  const router = useRouter();
  // 26/11: dinero (liquidación, finanzas Shalom) y llamadas con IA solo para el administrador.
  const esAdmin = useEsAdmin();
  const [rotuloOpen, setRotuloOpen] = useState(false);
  const [rotuloShalomOpen, setRotuloShalomOpen] = useState(false);
  const [shalomOpen, setShalomOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [aliclikModalOpen, setAliclikModalOpen] = useState(false);
  const [liquidarOpen, setLiquidarOpen] = useState(false);
  const [validando, setValidando] = useState(false);
  const [currentLiquidacion, setCurrentLiquidacion] = useState<LiquidacionAliclikData | null>(
    liquidacionAliclik ?? null
  );
  const [currentOwnerId, setCurrentOwnerId] = useState<string | null>(ownerId ?? null);
  const [currentOwnerName, setCurrentOwnerName] = useState<string | null>(ownerName ?? null);
  const [currentNumeroGuia, setCurrentNumeroGuia] = useState<string | null>(numeroGuia ?? null);
  const [currentCodigoRastreo, setCurrentCodigoRastreo] = useState<string | null>(codigoRastreo ?? null);
  const [currentClaveRecojo, setCurrentClaveRecojo] = useState<string | null>(claveRecojo ?? null);
  const [currentDireccion, setCurrentDireccion] = useState<string | null>(direccion ?? null);
  const [currentTags, setCurrentTags] = useState<string[]>(tags || []);

  const [finanzasOpen, setFinanzasOpen] = useState(false);
  const [currentFinanzas, setCurrentFinanzas] = useState<FinanzasShalom | null>(finanzasShalom ?? null);
  const [llamandoIA, setLlamandoIA] = useState(false);

  const dispararLlamadaIA = async () => {
    if (llamandoIA) return;
    if (!pedidoId && !numeroOrden) {
      toast.info("Esta tarjeta no tiene un pedido asociado aún");
      return;
    }
    setLlamandoIA(true);
    try {
      const res = await fetch("/api/voice/llamar-pedido", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(pedidoId ? { pedidoId } : { numeroOrden }),
          forzar: true,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        toast.success(`📞 Sofía (IA) está llamando a ${contactName || contactPhone || numeroOrdenLimpio}...`);
        router.refresh();
      } else {
        toast.error(data.motivo || data.error || "No se pudo iniciar la llamada con IA");
      }
    } catch {
      toast.error("Error de red al iniciar la llamada con IA");
    } finally {
      setLlamandoIA(false);
    }
  };

  useEffect(() => {
    setCurrentLiquidacion(liquidacionAliclik ?? null);
  }, [liquidacionAliclik]);

  useEffect(() => {
    setCurrentFinanzas(finanzasShalom ?? null);
  }, [finanzasShalom]);

  useEffect(() => {
    setCurrentOwnerId(ownerId ?? null);
    setCurrentOwnerName(ownerName ?? null);
  }, [ownerId, ownerName]);

  useEffect(() => {
    setCurrentNumeroGuia(numeroGuia ?? null);
    setCurrentCodigoRastreo(codigoRastreo ?? null);
    setCurrentClaveRecojo(claveRecojo ?? null);
    setCurrentDireccion(direccion ?? null);
  }, [numeroGuia, codigoRastreo, claveRecojo, direccion]);

  useEffect(() => {
    setCurrentTags(tags || []);
  }, [tags]);

  const isPendienteCourier = currentTags.some(
    (t) =>
      t.toLowerCase().includes("pendiente") &&
      t.toLowerCase().includes("courier"),
  );

  // Cambiar contra entrega (AliClik) ↔ agencia Shalom (26/11).
  const cambiarEntrega = async (destino: "shalom" | "cod", confirmado = false): Promise<void> => {
    if (!pedidoId) {
      toast.info("Esta tarjeta no tiene pedido asociado");
      return;
    }
    if (!confirmado) {
      const texto =
        destino === "shalom"
          ? "¿Cambiar este pedido a agencia Shalom (adelanto S/20)?"
          : "¿Cambiar este pedido a contra entrega por AliClik?";
      if (!window.confirm(texto)) return;
    }
    try {
      const res = await fetch("/api/pedidos/cambiar-entrega", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pedidoId, destino, confirmado }),
      });
      const data = (await res.json().catch(() => ({}))) as { mensaje?: string; error?: string; confirmar?: boolean };
      if (res.status === 409 && data.confirmar) {
        if (window.confirm(`${data.error}\n\n¿Ya lo anulaste? Aceptar = cambiar igual.`)) await cambiarEntrega(destino, true);
        return;
      }
      if (!res.ok) {
        toast.error(data.error || "No se pudo cambiar el tipo de entrega");
        return;
      }
      toast.success(data.mensaje || "Tipo de entrega cambiado");
      router.refresh();
    } catch {
      toast.error("No se pudo cambiar el tipo de entrega");
    }
  };

  const togglePendienteCourier = async () => {
    if (!contactId) {
      toast.info("Operación sin contacto asignado");
      return;
    }

    const tagNombre = "pendiente de courier";
    let nextTags: string[];
    const yaTiene = currentTags.some((t) => t.toLowerCase() === tagNombre);

    if (yaTiene) {
      nextTags = currentTags.filter((t) => t.toLowerCase() !== tagNombre);
    } else {
      nextTags = [...currentTags, tagNombre];
    }

    setCurrentTags(nextTags);

    try {
      const res = await fetch(`/api/contacts/${contactId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tags: nextTags }),
      });

      if (!res.ok) {
        throw new Error("No se pudo actualizar la marca");
      }

      if (yaTiene) {
        toast.info("Marca 'Pendiente de Courier' retirada");
      } else {
        toast.success("📦 Pedido marcado: Pendiente de asignación de courier");
      }
      router.refresh();
    } catch {
      setCurrentTags(currentTags);
      toast.error("Error al actualizar la marca del pedido");
    }
  };
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  // Limpieza de telefono para llamada y enlace directo de WhatsApp
  const rawDigits = (contactPhone ?? "").replace(/\D/g, "");
  const waNumber =
    rawDigits.length === 9 && rawDigits.startsWith("9")
      ? `51${rawDigits}`
      : rawDigits;

  const closeDateFormatted = expectedClose
    ? new Date(expectedClose).toLocaleDateString("es-PE", {
        day: "2-digit",
        month: "short",
      })
    : null;

  // Detección de orden de Lima para despacho con motorizado vs Shalom / Provincia
  const ciudadLower = (ciudad || "").toLowerCase();
  const distritoLower = (distrito || "").toLowerCase();
  const transportadoraLower = (transportadora || "").toLowerCase();

  // Es Lima solo si la ciudad o distrito explícitamente es Lima o Callao
  const esLima =
    ciudadLower.includes("lima") ||
    ciudadLower.includes("callao") ||
    distritoLower.includes("lima") ||
    distritoLower.includes("callao");

  // Es Provincia / Shalom si la ciudad no es Lima o la transportadora indica Shalom
  const esProvincia = Boolean(ciudadLower) && !esLima;
  // Pagado directo (Yape, Plin o tarjeta) con entrega propia: no pasa por AliClik ni por Shalom
  const pagoDirecto = ["yape", "plin", "tarjeta"].includes((ordenModalidadPago || "").toLowerCase());
  const esShalom = !pagoDirecto && !entregaAliclik && (
    transportadoraLower.includes("shalom") ||
    esProvincia ||
    Boolean(currentNumeroGuia) ||
    Boolean(currentClaveRecojo));

  // Aplica cuando la orden está confirmada, preparando o en reparto
  const stageKeyLower = (stageKey || "").toLowerCase();
  const stageNameLower = (stageName || "").toLowerCase();
  const esEntregado =
    stageKeyLower === "entregado" ||
    stageNameLower.includes("entregado") ||
    stageNameLower.includes("cobrado");
  // Regla: en "Entregado y Cobrado" la clave ya se entregó, así que el saldo Shalom está cobrado
  const saldoShalomVisible: number | null =
    currentFinanzas?.saldoMonto ?? (esEntregado ? saldoPorClaveEntregada(value / 100, currentFinanzas) : null);
  const soles = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));
  // Mejora 3: lo que registró el bot espera validación humana; aún no es despacho.
  const porValidar = stageKeyLower === "por_validar";
  const esConfirmadoODespacho =
    !porValidar &&
    (stageKeyLower.includes("confirmad") ||
    stageKeyLower.includes("reparto") ||
    stageKeyLower.includes("enviad") ||
    stageKeyLower.includes("preparand") ||
    stageNameLower.includes("confirmad") ||
    stageNameLower.includes("reparto") ||
    stageNameLower.includes("camino") ||
    stageNameLower.includes("despachad"));

  const tieneDatosEnvio = Boolean(direccion || ciudad || distrito || numeroOrden);

  // Botón Rótulo Motorizado: Si es Lima y tiene datos de envío
  const mostrarBotonRotulo = esLima && tieneDatosEnvio;
  // Botón de Seguimiento Shalom: Si es Provincia o Shalom (siempre disponible para registrar/ver datos)
  const mostrarBotonShalom = !entregaAliclik && (esShalom || esProvincia || !esLima || Boolean(currentNumeroGuia));
  // Botón Rótulo Shalom (Imagen): Siempre disponible como opción adicional
  const mostrarBotonShalomRotulo = !entregaAliclik && (esShalom || esProvincia || !esLima) && tieneDatosEnvio;

  const numeroOrdenLimpio =
    numeroOrden ||
    (title.startsWith("#") ? title.split("·")[0].trim() : "PEDIDO-ALIV");

  const rotuloData: RotuloData = {
    numeroOrden: numeroOrdenLimpio,
    clienteNombre: contactName || "Cliente Aliv",
    telefono: contactPhone || "",
    dni: dniCliente || null,
    ciudad: ciudad || "Lima",
    distrito: distrito || null,
    direccion: direccion || "",
    referencia: referencia || null,
    total: value || 0,
  };

  const rotuloShalomData: RotuloShalomData = {
    pedidoId: pedidoId || null,
    dealId: id,
    numeroOrden: currentNumeroGuia || numeroOrdenLimpio,
    codigo: currentCodigoRastreo || currentClaveRecojo || null,
    numeroGuia: currentNumeroGuia || null,
    codigoRastreo: currentCodigoRastreo || null,
    claveRecojo: currentClaveRecojo || null,
    destinatario: contactName || "Cliente Aliv",
    dni: dniCliente || null,
    departamento: ciudad || null,
    provincia: ciudad || null,
    distrito: distrito || null,
    ciudad: ciudad || "Provincia",
    direccion: currentDireccion || direccion || "",
    referencia: referencia || null,
    modalidad: "TERRESTRE",
    tipoEntrega: "En agencia",
    telefono: contactPhone || null,
    total: ordenTotal ? Number(ordenTotal) : (value ? (value > 500 ? value / 100 : value) : 0),
    productosResumen: Array.isArray(ordenItems)
      ? ordenItems.map((it: any) => `${it.cantidad ?? 1}x ${it.titulo ?? it.title ?? "Producto"}`).join(", ")
      : title,
  };

  const shalomData: SeguimientoShalomData = {
    pedidoId: pedidoId || null,
    dealId: id,
    contactId: contactId || null,
    numeroOrden: numeroOrdenLimpio,
    clienteNombre: contactName || "Cliente Aliv",
    telefono: contactPhone || "",
    dni: dniCliente || null,
    ciudad: ciudad || "Provincia",
    distrito: distrito || null,
    direccion: currentDireccion || direccion || "",
    referencia: referencia || null,
    total: value || 0,
    numeroGuia: currentNumeroGuia || null,
    codigoRastreo: currentCodigoRastreo || null,
    claveRecojo: currentClaveRecojo || null,
    transportadora: transportadora || "Shalom",
    estadoPedido: estadoPedido || null,
    fleteShalom: currentFinanzas?.fleteShalom ?? null,
  };

  const parsedOrdenItems: any[] = (() => {
    if (Array.isArray(ordenItems)) return ordenItems;
    if (typeof ordenItems === "string") {
      try {
        const parsed = JSON.parse(ordenItems);
        if (Array.isArray(parsed)) return parsed;
      } catch {}
    }
    return [];
  })();

  const totAliclik = ordenTotal ? Number(ordenTotal) : (value ? (value > 500 ? value / 100 : value) : 119);

  const despacharAliclikData: DespacharAliclikModalData = {
    dealId: id,
    contactId: contactId || null,
    numeroOrden: numeroOrdenLimpio,
    clienteNombre: contactName || "Cliente Aliv",
    telefono: contactPhone || "",
    dni: dniCliente || null,
    departamento: ciudad || null,
    provincia: ciudad || null,
    distrito: distrito || null,
    agenciaShalom: currentDireccion || direccion || "",
    total: totAliclik,
    productosResumen: parsedOrdenItems.length > 0
      ? parsedOrdenItems.map((it: any) => `${it.cantidad ?? 1}x ${it.titulo ?? it.title ?? "Producto"}`).join(", ")
      : title,
    productos: parsedOrdenItems.length > 0
      ? parsedOrdenItems.map((it: any) => {
          const rawNom = String(it.titulo ?? it.title ?? it.nombre ?? title ?? "");
          const esTermix = /termix|tobill/i.test(rawNom) || Math.round(totAliclik) === 79 || Math.round(totAliclik) === 139;
          const nombreOficial = esTermix ? "TERMIX TOBILLERA" : "NAC600";
          let cant = Number(it.cantidad ?? it.quantity ?? 1) || 1;
          if (cant === 1) {
            if (esTermix && Math.round(totAliclik) === 139) cant = 2;
            else if (esTermix && Math.round(totAliclik) === 189) cant = 3;
            else if (!esTermix && Math.round(totAliclik) === 199) cant = 3;
            else if (!esTermix && Math.round(totAliclik) === 189) cant = 2;
          }
          return {
            nombre: nombreOficial,
            cantidad: cant,
            precioUnitario: cant > 0 ? Math.round((totAliclik / cant) * 100) / 100 : totAliclik,
          };
        })
      : (() => {
          const esTermix = /termix|tobill/i.test(title || "") || Math.round(totAliclik) === 79 || Math.round(totAliclik) === 139;
          const nombreOficial = esTermix ? "TERMIX TOBILLERA" : "NAC600";
          const cant = esTermix
            ? (Math.round(totAliclik) === 139 ? 2 : Math.round(totAliclik) === 189 ? 3 : 1)
            : (Math.round(totAliclik) === 199 ? 3 : Math.round(totAliclik) === 189 ? 2 : 1);
          return [{
            nombre: nombreOficial,
            cantidad: cant,
            precioUnitario: Math.round((totAliclik / cant) * 100) / 100,
          }];
        })(),
  };

  const handleContactNavigate = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (contactId) {
      router.push(`/contacts/${contactId}`);
    } else {
      toast.info("Operación sin contacto asignado");
    }
  };

  // Tarjeta compacta: nombre, monto, productos, destino y UNA accion principal segun la
  // etapa. Asignar, marcar courier, rotulos y accesos van en el menu "⋯".
  const etapaTemprana =
    !pedidoId &&
    (/consulta|carrito|intenci/.test(stageKeyLower) || /consulta|intenci/.test(stageNameLower));
  const accionPrincipal: "shalom" | "motorizado" | null = etapaTemprana || porValidar
    ? null
    : mostrarBotonShalom && !esLima
      ? "shalom"
      : mostrarBotonRotulo
        ? "motorizado"
        : mostrarBotonShalom
          ? "shalom"
          : null;

  const itemsList: Array<{ titulo: string; cantidad: number }> = (() => {
    let crudos: unknown = ordenItems;
    if (typeof crudos === "string") {
      try {
        crudos = JSON.parse(crudos);
      } catch {
        crudos = null;
      }
    }
    if (!Array.isArray(crudos)) return [];
    return crudos.map((it: { titulo?: string; title?: string; cantidad?: number; quantity?: number }) => ({
      titulo: it.titulo ?? it.title ?? "Producto",
      cantidad: Number(it.cantidad ?? it.quantity ?? 1),
    }));
  })();
  const resumenItems = itemsList.map((it) => `${it.cantidad}x ${it.titulo}`).join(" · ");
  const pararArrastre = {
    onPointerDown: (e: React.PointerEvent) => e.stopPropagation(),
  };

  return (
    <Card
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className="group relative p-3 cursor-grab active:cursor-grabbing border-border/60 hover:border-primary/30 hover:shadow-md transition-all select-none"
    >
      <div className="space-y-2">
        {/* Cabecera: cliente y monto */}
        <div className="flex items-start gap-2">
          <div
            className={cn(
              "h-7 w-7 shrink-0 rounded-full flex items-center justify-center text-[10px] font-bold",
              avatarBg(contactName ?? "?"),
            )}
            aria-hidden
          >
            {getInitials(contactName)}
          </div>
          <div className="min-w-0 flex-1">
            <p
              onClick={handleContactNavigate}
              className="text-[13px] font-semibold leading-snug line-clamp-2 hover:text-primary cursor-pointer"
              title="Ver ficha del contacto"
            >
              {contactName || title}
            </p>
            {numeroOrden && <p className="text-[10.5px] font-mono text-muted-foreground">{numeroOrden}</p>}
          </div>
          {value > 0 && (
            <p className="text-sm font-bold tabular-nums text-foreground shrink-0">{formatCurrency(value)}</p>
          )}
        </div>

        {/* Productos en una linea */}
        {resumenItems && (
          <div className="flex items-center gap-1.5 text-[11px] text-foreground/85 min-w-0" title={resumenItems}>
            <Package className="h-3.5 w-3.5 shrink-0 text-amber-600" aria-hidden />
            <span className="truncate">{resumenItems}</span>
            {ordenModalidadPago && ordenModalidadPago !== "contraentrega" && (
              <span className="ml-auto shrink-0 text-[9px] uppercase text-muted-foreground border border-border/60 rounded px-1">
                {ordenModalidadPago.replace(/_/g, " ")}
              </span>
            )}
          </div>
        )}

        {/* Destino */}
        {(ciudad || distrito) && (
          <div
            className="flex items-center gap-1.5 text-[11px] text-muted-foreground min-w-0"
            title={[ciudad, distrito, direccion].filter(Boolean).join(" — ")}
          >
            <MapPin className="h-3.5 w-3.5 shrink-0 text-emerald-600" aria-hidden />
            <span className="truncate">
              <span className="font-medium text-foreground/90">
                {ciudad}
                {distrito && distrito.toLowerCase() !== (ciudad ?? "").toLowerCase() ? ` · ${distrito}` : ""}
              </span>
              {!direccion && <span className="text-amber-700 dark:text-amber-400"> · sin dirección</span>}
            </span>
          </div>
        )}

        {isPendienteCourier && (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-500/15 text-amber-800 dark:text-amber-300 border border-amber-500/35">
            <Clock className="h-2.5 w-2.5" aria-hidden />
            Pendiente de courier
          </span>
        )}

        {/* Mejora 3: «Confirmado por bot (por validar)» -> una persona valida y pasa a despacho */}
        {porValidar && pedidoId && (
          <div className="space-y-1.5">
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-500/15 text-amber-800 dark:text-amber-300 border border-amber-500/35">
              {etiquetaValidacion(tipoValidacion({ estado: estadoPedido ?? null, modalidadPago: ordenModalidadPago ?? null }))}
            </span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={validando}
              {...pararArrastre}
              onClick={async (e) => {
                e.stopPropagation();
                setValidando(true);
                try {
                  const r = await fetch("/api/pedidos/validar", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ pedidoId }),
                  });
                  const d = await r.json().catch(() => ({}));
                  if (!r.ok) throw new Error(d.error || "No se pudo validar");
                  if (d.mensajeEnviado) toast.success("✅ Pedido validado y cliente avisado");
                  else toast.warning("Pedido validado, pero el mensaje al cliente no salió (revisa el chat)");
                  router.refresh();
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : "No se pudo validar");
                } finally {
                  setValidando(false);
                }
              }}
              className="w-full h-7 text-[11px] font-semibold gap-1.5 shadow-none cursor-pointer bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 border-emerald-500/30"
            >
              <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden />
              {validando ? "Validando…" : "Validar y confirmar"}
            </Button>
          </div>
        )}

        {/* Accion principal segun la etapa */}
        {accionPrincipal === "shalom" && (
          <div className="flex items-center gap-1.5 w-full">
            <Button
              type="button"
              size="sm"
              variant="outline"
              {...pararArrastre}
              onClick={(e) => {
                e.stopPropagation();
                setShalomOpen(true);
              }}
              className={cn(
                "flex-1 h-7 text-[11px] font-semibold gap-1.5 shadow-none cursor-pointer",
                currentNumeroGuia
                  ? "bg-red-500/10 hover:bg-red-500/20 text-red-700 dark:text-red-400 border-red-500/30"
                  : "bg-amber-500/10 hover:bg-amber-500/20 text-amber-700 dark:text-amber-400 border-amber-500/30",
              )}
            >
              <Truck className="h-3.5 w-3.5 shrink-0" aria-hidden />
              <span className="truncate">
                {currentNumeroGuia ? `Shalom #${currentNumeroGuia}` : "Guía Shalom"}
              </span>
            </Button>
          </div>
        )}
        {accionPrincipal === "motorizado" && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            {...pararArrastre}
            onClick={(e) => {
              e.stopPropagation();
              setRotuloOpen(true);
            }}
            className="w-full h-7 text-[11px] font-semibold gap-1.5 shadow-none cursor-pointer bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 border-emerald-500/30"
          >
            <Printer className="h-3.5 w-3.5 shrink-0" aria-hidden />
            Rótulo motorizado
          </Button>
        )}

        {/* Botón de Confirmación de Liquidación AliClik en BCP (para Contra Entrega) o resumen BCP Shalom */}
        {esAdmin && (<>
        {esShalom && !currentLiquidacion && (esConfirmadoODespacho || esEntregado) ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            {...pararArrastre}
            onClick={(e) => {
              e.stopPropagation();
              setFinanzasOpen(true);
            }}
            className={cn(
              "w-full h-7 text-[11px] font-semibold gap-1.5 shadow-none cursor-pointer",
              currentFinanzas?.fleteShalom !== null && currentFinanzas?.fleteShalom !== undefined &&
                (!esEntregado || saldoShalomVisible !== null)
                ? "bg-emerald-600/15 hover:bg-emerald-600/25 text-emerald-800 dark:text-emerald-300 border-emerald-600/40"
                : "bg-amber-500/15 hover:bg-amber-500/25 text-amber-800 dark:text-amber-300 border-amber-500/40"
            )}
            title="Registrar el flete Shalom pagado, el adelanto y el saldo cobrado"
          >
            <Landmark className="h-3.5 w-3.5 shrink-0" aria-hidden />
            <span className="truncate">
              {/* El estado va primero: con el flete cargado el texto se cortaba en «co…» y
                  parecía que el saldo no se había marcado como cobrado (Juan #LEG-1048, 22/11). */}
              {currentFinanzas || saldoShalomVisible !== null
                ? `${saldoShalomVisible !== null ? `Cobrado S/${soles(saldoShalomVisible)}` : "Saldo pendiente"} · Envío ${currentFinanzas?.fleteShalom != null ? `S/${soles(currentFinanzas.fleteShalom)}` : "?"}`
                : "Registrar dinero Shalom"}
            </span>
          </Button>
        ) : (esEntregado || Boolean(currentLiquidacion)) && (
          pagoDirecto && !currentLiquidacion ? (
            <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-[10px] font-medium text-emerald-800 dark:text-emerald-300">
              🏦 Cobrado por {(ordenModalidadPago || "").toUpperCase()} al BCP: S/{" "}
              {(ordenTotal ? Number(ordenTotal) : value > 500 ? value / 100 : value).toFixed(2)}
            </div>
          ) : !esShalom || Boolean(currentLiquidacion) ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              {...pararArrastre}
              onClick={(e) => {
                e.stopPropagation();
                setLiquidarOpen(true);
              }}
              className={cn(
                "w-full h-7 text-[11px] font-bold gap-1.5 shadow-none cursor-pointer",
                currentLiquidacion
                  ? "bg-emerald-600/15 hover:bg-emerald-600/25 text-emerald-800 dark:text-emerald-300 border-emerald-600/40"
                  : "bg-amber-500/15 hover:bg-amber-500/25 text-amber-800 dark:text-amber-300 border-amber-500/40"
              )}
              title="Confirmar monto liquidado por AliClik y depositado en Cuenta BCP"
            >
              {currentLiquidacion ? (
                <>
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-600" aria-hidden />
                  <span className="truncate">
                    Liquidado BCP: S/ {currentLiquidacion.montoNeto.toFixed(2)}
                  </span>
                </>
              ) : (
                <>
                  <Landmark className="h-3.5 w-3.5 shrink-0 text-amber-600" aria-hidden />
                  <span className="truncate">Confirmar Liquidación AliClik (BCP)</span>
                </>
              )}
            </Button>
          ) : (
            <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-[10px] font-medium text-emerald-800 dark:text-emerald-300 flex items-center justify-between">
              <span>
                🏦 BCP: S/20 + Saldo S/
                {Math.max(
                  0,
                  (ordenTotal
                    ? Number(ordenTotal)
                    : value > 500
                      ? value / 100
                      : value) - 20
                ).toFixed(0)}
              </span>
              <span className="text-muted-foreground">Env. -S/2 · FF -S/3</span>
            </div>
          )
        )}
        </>)}

        {/* Pie: contacto rapido, asesor y menu */}
        <div className="flex items-center gap-2 pt-2 border-t border-border/40 text-muted-foreground" onClick={(e) => e.stopPropagation()}>
          {contactPhone ? (
            <a
              href={enlaceLlamadaWhatsApp(contactPhone)}
              target={PESTANA_WHATSAPP_WEB}
              rel="noopener noreferrer"
              title={`Llamar por WhatsApp Web a ${contactPhone}`}
              {...pararArrastre}
              className="p-1 -m-1 rounded hover:bg-muted hover:text-primary"
            >
              <Phone className="h-3.5 w-3.5" aria-hidden />
            </a>
          ) : null}
          {esAdmin && contactPhone && (pedidoId || numeroOrden) && !esEntregado && stageKeyLower !== "cancelado_rechazado" && (
            <button
              type="button"
              disabled={llamandoIA}
              title={`Llamar ahora con Sofía (IA) para confirmar ${numeroOrdenLimpio}`}
              {...pararArrastre}
              onClick={dispararLlamadaIA}
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-violet-500/40 bg-violet-500/10 text-violet-700 dark:text-violet-300 hover:bg-violet-500/20 text-[10px] font-semibold cursor-pointer disabled:opacity-50"
            >
              <Phone className="h-2.5 w-2.5 shrink-0" aria-hidden />
              {llamandoIA ? "Llamando..." : "Llamar IA"}
            </button>
          )}
          <button
            type="button"
            title="Abrir chat"
            {...pararArrastre}
            onClick={() => router.push(contactId ? `/conversations/${contactId}` : "/conversations")}
            className="p-1 -m-1 rounded hover:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 cursor-pointer"
          >
            <MessageCircle className="h-3.5 w-3.5" aria-hidden />
          </button>
          {closeDateFormatted && (
            <span className="inline-flex items-center gap-1 text-[10px] tabular-nums" title="Cierre estimado">
              <Calendar className="h-3 w-3" aria-hidden />
              {closeDateFormatted}
            </span>
          )}
          <button
            type="button"
            {...pararArrastre}
            onClick={() => (contactId ? setAssignOpen(true) : toast.info("Operación sin contacto asignado"))}
            title={currentOwnerName ? `Asesor: ${currentOwnerName} (clic para reasignar)` : "Asignar asesor"}
            className={cn(
              "ml-auto truncate max-w-[110px] text-[10px] font-medium px-1.5 py-0.5 rounded border cursor-pointer",
              currentOwnerName
                ? "border-border/60 hover:bg-muted text-foreground/80"
                : "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300",
            )}
          >
            {currentOwnerName ? currentOwnerName.replace(/\s*\(.*\)$/, "") : "Sin asesor"}
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger
              {...pararArrastre}
              render={<Button variant="ghost" size="sm" className="h-6 w-6 p-0 cursor-pointer" aria-label="Más acciones" />}
            >
              <MoreHorizontal className="h-4 w-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" onPointerDown={(e) => e.stopPropagation()}>
              {mostrarBotonShalom && accionPrincipal !== "shalom" && (
                <DropdownMenuItem onClick={() => setShalomOpen(true)}>
                  <Truck className="h-4 w-4" /> {currentNumeroGuia ? `Guía Shalom #${currentNumeroGuia}` : "Registrar guía Shalom"}
                </DropdownMenuItem>
              )}
              {mostrarBotonShalomRotulo && (
                <DropdownMenuItem onClick={() => setRotuloShalomOpen(true)}>
                  <FileImage className="h-4 w-4" /> Rótulo Shalom (imagen)
                </DropdownMenuItem>
              )}
              {mostrarBotonRotulo && accionPrincipal !== "motorizado" && (
                <DropdownMenuItem onClick={() => setRotuloOpen(true)}>
                  <Printer className="h-4 w-4" /> Rótulo motorizado
                </DropdownMenuItem>
              )}
              {esAdmin && esShalom && (
                <DropdownMenuItem onClick={() => setFinanzasOpen(true)} className="cursor-pointer">
                  <Landmark className="h-4 w-4" /> Dinero Shalom (flete, adelanto, saldo)
                </DropdownMenuItem>
              )}
              {esAdmin && (
                <DropdownMenuItem onClick={() => setLiquidarOpen(true)} className="text-amber-700 dark:text-amber-400 font-semibold cursor-pointer">
                  <Landmark className="h-4 w-4 text-amber-600" /> {currentLiquidacion ? `Editar Liquidación BCP (S/ ${currentLiquidacion.montoNeto.toFixed(2)})` : "Confirmar Liquidación AliClik (BCP)"}
                </DropdownMenuItem>
              )}
              {pedidoId && !pagoDirecto && !esEntregado && (
                <DropdownMenuItem onClick={() => cambiarEntrega(esShalom ? "cod" : "shalom")}>
                  <ArrowLeftRight className="h-4 w-4" /> {esShalom ? "Cambiar a contra entrega (AliClik)" : "Cambiar a agencia Shalom"}
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={togglePendienteCourier}>
                <Truck className="h-4 w-4" /> {isPendienteCourier ? "Quitar pendiente de courier" : "Marcar pendiente de courier"}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => (contactId ? setAssignOpen(true) : toast.info("Operación sin contacto asignado"))}>
                <UserCheck className="h-4 w-4" /> {currentOwnerName ? "Reasignar asesor" : "Asignar asesor"}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => contactId && router.push(`/contacts/${contactId}#documentos`)}>
                <FileText className="h-4 w-4" /> Documentos{docCount > 0 ? ` (${docCount})` : ""}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => router.push(contactId ? `/activities?contactId=${contactId}` : "/activities")}>
                <CheckSquare className="h-4 w-4" /> Actividades
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {mostrarBotonRotulo && (
        <RotuloMotorizadoModal
          open={rotuloOpen}
          onOpenChange={setRotuloOpen}
          data={rotuloData}
        />
      )}

      {mostrarBotonShalomRotulo && (
        <RotuloShalomModal
          open={rotuloShalomOpen}
          onOpenChange={setRotuloShalomOpen}
          data={rotuloShalomData}
          onUpdated={(guia, codigo, clave, nuevaAgencia) => {
            setCurrentNumeroGuia(guia || null);
            setCurrentCodigoRastreo(codigo || null);
            setCurrentClaveRecojo(clave || null);
            if (nuevaAgencia) setCurrentDireccion(nuevaAgencia);
          }}
          onAbrirSeguimientoCompleto={() => setShalomOpen(true)}
        />
      )}

      {mostrarBotonShalom && (
        <SeguimientoShalomModal
          open={shalomOpen}
          onOpenChange={setShalomOpen}
          data={{ ...shalomData, productos: itemsList }}
          onUpdated={(guia, codigo, clave, nuevaAgencia) => {
            setCurrentNumeroGuia(guia || null);
            setCurrentCodigoRastreo(codigo || null);
            setCurrentClaveRecojo(clave || null);
            if (nuevaAgencia) setCurrentDireccion(nuevaAgencia);
          }}
          onAbrirRotulo={() => setRotuloShalomOpen(true)}
        />
      )}

      {contactId && (
        <AsignarVendedorModal
          open={assignOpen}
          onOpenChange={setAssignOpen}
          contactId={contactId}
          clienteNombre={contactName || "Cliente"}
          numeroOrden={numeroOrdenLimpio}
          currentOwnerId={currentOwnerId}
          currentOwnerName={currentOwnerName}
          onAssigned={(newId, newName) => {
            setCurrentOwnerId(newId);
            setCurrentOwnerName(newName);
          }}
        />
      )}

      <DespacharAliclikModal
        open={aliclikModalOpen}
        onOpenChange={setAliclikModalOpen}
        data={despacharAliclikData}
        onSuccess={(nuevaOrden) => {
          toast.success(`Orden ${nuevaOrden} creada en AliClik. Servicio de despacho y rotulado asignado a Alidriver.`);
        }}
      />

      <LiquidarAliclikModal
        open={liquidarOpen}
        onOpenChange={setLiquidarOpen}
        dealId={id}
        pedidoId={pedidoId}
        contactId={contactId}
        numeroOrden={numeroOrdenLimpio}
        clienteNombre={contactName || "Cliente Aliv"}
        totalCobrado={ordenTotal ? Number(ordenTotal) : value}
        liquidacionActual={currentLiquidacion}
        onSuccess={(liq) => {
          setCurrentLiquidacion(liq);
        }}
      />

      {esShalom && (
        <FinanzasShalomModal
          open={finanzasOpen}
          onOpenChange={setFinanzasOpen}
          dealId={id}
          pedidoId={pedidoId}
          numeroOrden={numeroOrdenLimpio}
          clienteNombre={contactName || "Cliente Aliv"}
          total={ordenTotal ? Number(ordenTotal) : value > 500 ? value / 100 : value}
          actual={currentFinanzas}
          onSuccess={(f) => setCurrentFinanzas(f)}
        />
      )}
    </Card>
  );
}
