"use client";

import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatCurrency } from "@/lib/constants";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  GripVertical,
  Phone,
  MessageCircle,
  Tag,
  FileText,
  CheckSquare,
  Calendar,
  MapPin,
  Printer,
  Truck,
  UserCheck,
  Clock,
  X,
  Package,
  FileImage,
} from "lucide-react";
import { cn } from "@/lib/utils";
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
}: DealCardProps) {
  const router = useRouter();
  const [rotuloOpen, setRotuloOpen] = useState(false);
  const [rotuloShalomOpen, setRotuloShalomOpen] = useState(false);
  const [shalomOpen, setShalomOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [currentOwnerId, setCurrentOwnerId] = useState<string | null>(ownerId ?? null);
  const [currentOwnerName, setCurrentOwnerName] = useState<string | null>(ownerName ?? null);
  const [currentNumeroGuia, setCurrentNumeroGuia] = useState<string | null>(numeroGuia ?? null);
  const [currentCodigoRastreo, setCurrentCodigoRastreo] = useState<string | null>(codigoRastreo ?? null);
  const [currentClaveRecojo, setCurrentClaveRecojo] = useState<string | null>(claveRecojo ?? null);
  const [currentTags, setCurrentTags] = useState<string[]>(tags || []);

  useEffect(() => {
    setCurrentOwnerId(ownerId ?? null);
    setCurrentOwnerName(ownerName ?? null);
  }, [ownerId, ownerName]);

  useEffect(() => {
    setCurrentNumeroGuia(numeroGuia ?? null);
    setCurrentCodigoRastreo(codigoRastreo ?? null);
    setCurrentClaveRecojo(claveRecojo ?? null);
  }, [numeroGuia, codigoRastreo, claveRecojo]);

  useEffect(() => {
    setCurrentTags(tags || []);
  }, [tags]);

  const isPendienteCourier = currentTags.some(
    (t) =>
      t.toLowerCase().includes("pendiente") &&
      t.toLowerCase().includes("courier"),
  );

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
  const esShalom =
    transportadoraLower.includes("shalom") ||
    esProvincia ||
    Boolean(currentNumeroGuia) ||
    Boolean(currentClaveRecojo);

  // Aplica cuando la orden está confirmada, preparando o en reparto
  const stageKeyLower = (stageKey || "").toLowerCase();
  const stageNameLower = (stageName || "").toLowerCase();
  const esConfirmadoODespacho =
    stageKeyLower.includes("confirmad") ||
    stageKeyLower.includes("reparto") ||
    stageKeyLower.includes("enviad") ||
    stageKeyLower.includes("preparand") ||
    stageNameLower.includes("confirmad") ||
    stageNameLower.includes("reparto") ||
    stageNameLower.includes("camino") ||
    stageNameLower.includes("despachad");

  const tieneDatosEnvio = Boolean(direccion || ciudad || distrito || numeroOrden);

  // Botón Rótulo Motorizado: Si es Lima y tiene datos de envío
  const mostrarBotonRotulo = esLima && tieneDatosEnvio;
  // Botón de Seguimiento Shalom: Si es Provincia o Shalom (siempre disponible para registrar/ver datos)
  const mostrarBotonShalom = esShalom || esProvincia || !esLima || Boolean(currentNumeroGuia);
  // Botón Rótulo Shalom (Imagen): Siempre disponible como opción adicional
  const mostrarBotonShalomRotulo = (esShalom || esProvincia || !esLima) && tieneDatosEnvio;

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
    direccion: direccion || "",
    referencia: referencia || null,
    modalidad: "TERRESTRE",
    tipoEntrega: "En agencia",
    telefono: contactPhone || null,
    total: value || 0,
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
    direccion: direccion || "",
    referencia: referencia || null,
    total: value || 0,
    numeroGuia: currentNumeroGuia || null,
    codigoRastreo: currentCodigoRastreo || null,
    claveRecojo: currentClaveRecojo || null,
    transportadora: transportadora || "Shalom",
    estadoPedido: estadoPedido || null,
  };

  const handleContactNavigate = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (contactId) {
      router.push(`/contacts/${contactId}`);
    } else {
      toast.info("Operación sin contacto asignado");
    }
  };

  return (
    <Card
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className="group relative p-3.5 cursor-grab active:cursor-grabbing border-border/60 hover:border-primary/30 hover:shadow-md transition-all select-none"
    >
      <GripVertical
        aria-hidden
        className="absolute top-2 right-2 h-3.5 w-3.5 text-muted-foreground/60 opacity-0 group-hover:opacity-100 transition-opacity"
      />
      <div className="space-y-2.5">
        <p
          onClick={handleContactNavigate}
          className="text-[13px] font-semibold leading-snug line-clamp-2 pr-4 hover:text-primary transition-colors cursor-pointer"
          title="Ver ficha del contacto"
        >
          {title}
        </p>

        <p className="text-base font-bold tabular-nums text-foreground">
          {formatCurrency(value)}
        </p>

        {/* Cantidad y productos comprados en el pedido */}
        {(() => {
          let itemsList: Array<{ titulo: string; cantidad: number; precioUnitario?: number }> = [];
          if (Array.isArray(ordenItems) && ordenItems.length > 0) {
            itemsList = ordenItems.map((it: any) => ({
              titulo: it.titulo ?? it.title ?? "Producto",
              cantidad: Number(it.cantidad ?? it.quantity ?? 1),
              precioUnitario: it.precioUnitario ? Number(it.precioUnitario) : undefined,
            }));
          } else if (typeof ordenItems === "string" && ordenItems.trim()) {
            try {
              const parsed = JSON.parse(ordenItems);
              if (Array.isArray(parsed) && parsed.length > 0) {
                itemsList = parsed.map((it: any) => ({
                  titulo: it.titulo ?? it.title ?? "Producto",
                  cantidad: Number(it.cantidad ?? it.quantity ?? 1),
                  precioUnitario: it.precioUnitario ? Number(it.precioUnitario) : undefined,
                }));
              }
            } catch {
              // ignore
            }
          }

          // Fallback por titulo o valor si no hay items registrados
          if (itemsList.length === 0) {
            const matchQty = title.match(/(\d+)\s*x/i);
            if (matchQty) {
              const qty = parseInt(matchQty[1], 10);
              const cleanTitle = title.replace(/^#\w+\s*·\s*/, "").replace(/^\d+x\s*/i, "").trim();
              itemsList = [{ titulo: cleanTitle || "Producto", cantidad: qty }];
            } else if (value > 0) {
              const soles = Math.round(value / 100);
              const cleanTitle = title.replace(/^#\w+\s*·\s*/, "").trim();
              let inferredQty = 1;
              if (soles === 199 || soles === 219) inferredQty = 3;
              else if (soles === 169 || soles === 179 || soles === 189) inferredQty = 2;
              else if (soles === 119 || soles === 99) inferredQty = 1;
              itemsList = [{ titulo: cleanTitle || "Producto", cantidad: inferredQty }];
            }
          }

          if (itemsList.length === 0) return null;

          const totalCant = itemsList.reduce((acc, it) => acc + (it.cantidad || 1), 0);

          return (
            <div className="rounded-md border border-amber-200/90 bg-amber-50/70 dark:border-amber-900/40 dark:bg-amber-950/20 px-2.5 py-1.5 space-y-1">
              <div className="flex items-center justify-between text-[11px] font-semibold text-amber-950 dark:text-amber-200">
                <span className="flex items-center gap-1.5">
                  <Package className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
                  <span>
                    Pedido: <strong className="text-amber-900 dark:text-amber-100 font-bold">{totalCant} {totalCant === 1 ? "unidad" : "unidades"}</strong>
                  </span>
                </span>
                {ordenModalidadPago && (
                  <span className="text-[9px] font-medium text-muted-foreground uppercase px-1 py-0.2 rounded bg-background/70 border border-border/50">
                    {ordenModalidadPago.replace(/_/g, " ")}
                  </span>
                )}
              </div>
              <div className="space-y-0.5 pt-1 border-t border-amber-200/60 dark:border-amber-900/40">
                {itemsList.map((it, idx) => (
                  <div key={idx} className="text-[11.5px] leading-tight text-foreground font-medium flex items-center justify-between gap-1">
                    <span className="truncate">
                      <span className="font-bold text-amber-700 dark:text-amber-400">{it.cantidad}x</span> {it.titulo}
                    </span>
                    {it.precioUnitario ? (
                      <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">
                        S/ {(it.precioUnitario * it.cantidad).toFixed(2)}
                      </span>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          );
        })()}

        {/* Fila 1: Cliente con avatar e initials y NOMBRE COMPLETO en 1 o 2 lineas sin truncar */}
        <div
          onClick={handleContactNavigate}
          className="flex items-start gap-2 cursor-pointer group/contact min-w-0 pt-0.5"
          title={`Ver ficha de: ${contactName || "Sin contacto"}`}
        >
          <div
            className={cn(
              "h-6 w-6 shrink-0 rounded-full flex items-center justify-center text-[10px] font-bold transition-transform group-hover/contact:scale-110 mt-0.5",
              avatarBg(contactName ?? "?"),
            )}
          >
            {getInitials(contactName)}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[12.5px] font-bold text-foreground group-hover/contact:text-primary leading-snug line-clamp-2 transition-colors">
              {contactName || "Sin contacto"}
            </p>
          </div>
        </div>

        {/* Fila 2: Asesor Asignado y Botón Rápido */}
        <div className="flex items-center justify-between gap-1.5 pl-8 text-[11px]">
          <div className="flex items-center gap-1 min-w-0">
            <span className="text-[10px] text-muted-foreground font-medium shrink-0">
              Asesor:
            </span>
            <span
              onClick={(e) => {
                if (contactId) {
                  e.stopPropagation();
                  setAssignOpen(true);
                }
              }}
              className={cn(
                "text-[10px] font-semibold px-1.5 py-0.2 rounded cursor-pointer transition-colors truncate max-w-[110px]",
                currentOwnerName
                  ? "text-emerald-700 bg-emerald-500/10 border border-emerald-500/25 dark:text-emerald-300 hover:bg-emerald-500/20"
                  : "text-amber-700 bg-amber-500/10 border border-amber-500/25 dark:text-amber-300 hover:bg-amber-500/20",
              )}
              title="Clic para cambiar vendedor asignado"
            >
              ({currentOwnerName || "Sin asignar"})
            </span>
          </div>

          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              if (contactId) {
                setAssignOpen(true);
              } else {
                toast.info("Operación sin contacto asignado");
              }
            }}
            className={cn(
              "shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 text-[9.5px] rounded-md border transition-all cursor-pointer shadow-2xs active:scale-95",
              currentOwnerName
                ? "bg-muted/40 hover:bg-muted text-muted-foreground hover:text-foreground border-border/70 font-medium"
                : "bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border-emerald-500/30 font-semibold",
            )}
            title={currentOwnerName ? `Reasignar vendedor (actual: ${currentOwnerName})` : "Asignar vendedor a este cliente"}
          >
            <UserCheck className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />
            <span>{currentOwnerName ? "Reasignar" : "Asignar"}</span>
          </button>
        </div>

        {/* Fila 3: Marca / Etiqueta de 'Pendiente de Courier' */}
        <div className="flex items-center gap-1 pl-8">
          {isPendienteCourier ? (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-500/15 text-amber-800 dark:text-amber-300 border border-amber-500/35 shadow-2xs">
              <Clock className="h-2.5 w-2.5 text-amber-600 dark:text-amber-400 animate-pulse shrink-0" />
              <span>Pendiente de Courier</span>
              <button
                type="button"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  togglePendienteCourier();
                }}
                title="Quitar marca de pendiente de courier"
                className="ml-0.5 p-0.5 hover:text-destructive cursor-pointer rounded hover:bg-amber-500/20"
              >
                <X className="h-2.5 w-2.5" />
              </button>
            </span>
          ) : (
            <button
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                togglePendienteCourier();
              }}
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9.5px] text-muted-foreground/80 hover:text-amber-700 dark:hover:text-amber-300 hover:bg-amber-500/10 border border-dashed border-border/70 hover:border-amber-500/30 transition-all cursor-pointer"
              title="Marcar pedido como pendiente de asignación de courier"
            >
              <Truck className="h-2.5 w-2.5 text-muted-foreground shrink-0" />
              <span>+ Marcar Pendiente Courier</span>
            </button>
          )}
        </div>

        {/* Destino y dirección de entrega recopilada */}
        {(direccion || ciudad || distrito) && (
          <div
            onClick={handleContactNavigate}
            title={[ciudad, distrito && distrito.toLowerCase() !== ciudad?.toLowerCase() ? distrito : null, direccion]
              .filter(Boolean)
              .join(" — ")}
            className="flex items-start gap-1.5 text-[11px] text-muted-foreground bg-muted/40 hover:bg-muted/70 rounded px-2 py-1.5 border border-border/40 transition-colors cursor-pointer"
          >
            <MapPin className="h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400 mt-0.5" />
            <div className="leading-tight min-w-0 flex-1">
              {ciudad && (
                <span className="font-semibold text-foreground mr-1">
                  {ciudad}
                  {distrito && distrito.toLowerCase() !== ciudad.toLowerCase() ? ` (${distrito})` : ""}
                  :
                </span>
              )}
              <span className="line-clamp-2 text-foreground/80">
                {direccion || "Dirección pendiente"}
              </span>
            </div>
          </div>
        )}

        {/* Botón de Seguimiento Shalom: Registro y gestión de Guía, N° Orden y Código (función original) */}
        {mostrarBotonShalom && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={(e) => {
              e.stopPropagation();
              setShalomOpen(true);
            }}
            title={
              currentNumeroGuia
                ? `Guía Shalom: ${currentNumeroGuia}${currentCodigoRastreo ? ` (Cód: ${currentCodigoRastreo})` : ""}${currentClaveRecojo ? ` (Clave: ${currentClaveRecojo})` : ""}`
                : "Registrar datos y guía de Shalom (N° orden, código y clave)"
            }
            className={cn(
              "w-full h-7 text-[11px] font-bold flex items-center justify-center gap-1.5 shadow-none transition-all cursor-pointer",
              currentNumeroGuia
                ? "bg-red-500/10 hover:bg-red-500/20 text-red-700 dark:text-red-400 border border-red-500/30"
                : "bg-amber-500/10 hover:bg-amber-500/20 text-amber-700 dark:text-amber-400 border border-amber-500/30"
            )}
          >
            <Truck className="h-3.5 w-3.5 shrink-0 text-red-600" />
            <span className="truncate">
              {currentNumeroGuia
                ? `Shalom: #${currentNumeroGuia}${currentCodigoRastreo ? ` · Cód: ${currentCodigoRastreo}` : ""}${currentClaveRecojo ? ` · ${currentClaveRecojo}` : ""}`
                : "Registrar Guía Shalom"}
            </span>
          </Button>
        )}

        {/* Botón Adicional de Rótulo Shalom (Generar imagen oficial de etiqueta para paquete) */}
        {mostrarBotonShalomRotulo && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={(e) => {
              e.stopPropagation();
              setRotuloShalomOpen(true);
            }}
            title="Generar e imprimir imagen oficial de rótulo / etiqueta Shalom para el paquete"
            className="w-full h-7 text-[11px] font-bold bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 border border-slate-300 dark:border-slate-700 flex items-center justify-center gap-1.5 shadow-none transition-all cursor-pointer"
          >
            <FileImage className="h-3.5 w-3.5 text-red-600 shrink-0" />
            <span className="truncate">Rótulo Shalom (Imagen)</span>
          </Button>
        )}

        {/* Botón de Rótulo Motorizado (Para órdenes de Lima/Callao) */}
        {mostrarBotonRotulo && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={(e) => {
              e.stopPropagation();
              setRotuloOpen(true);
            }}
            title="Generar e imprimir rótulo 10.5 × 9.0 cm para motorizado"
            className="w-full h-7 text-[11px] font-bold bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30 flex items-center justify-center gap-1.5 shadow-none transition-all cursor-pointer"
          >
            <Printer className="h-3.5 w-3.5 shrink-0" />
            <span>Rótulo Motorizado (10.5×9 cm)</span>
          </Button>
        )}

        <div className="flex items-center gap-2 pt-1">
          <div className="h-1 flex-1 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-primary rounded-full transition-all"
              style={{ width: `${probability}%` }}
            />
          </div>
          <span className="text-[10.5px] font-medium text-muted-foreground tabular-nums">
            {probability}%
          </span>
        </div>

        {/* Barra interactiva de acciones rápidas */}
        <div
          className="flex items-center gap-3 pt-2 mt-1 border-t border-border/40 text-muted-foreground/75"
          onClick={(e) => e.stopPropagation()}
        >
          {/* 1. Teléfono */}
          {contactPhone ? (
            <a
              href={`tel:${contactPhone}`}
              title={`Llamar a ${contactPhone}`}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
              className="p-1 -m-1 rounded hover:bg-muted hover:text-primary transition-all active:scale-90"
            >
              <Phone className="h-3.5 w-3.5" aria-hidden />
            </a>
          ) : (
            <button
              type="button"
              title="Sin teléfono registrado"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                toast.info("Contacto sin teléfono registrado");
              }}
              className="p-1 -m-1 rounded hover:bg-muted hover:text-muted-foreground opacity-40 transition-all cursor-not-allowed"
            >
              <Phone className="h-3.5 w-3.5" aria-hidden />
            </button>
          )}

          {/* 2. Mensaje / Chat en apartado Conversaciones */}
          <button
            type="button"
            title="Abrir chat en apartado Conversaciones"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              if (contactId) {
                router.push(`/conversations/${contactId}`);
              } else {
                router.push("/conversations");
              }
            }}
            className="p-1 -m-1 rounded hover:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 transition-all active:scale-90 cursor-pointer"
          >
            <MessageCircle className="h-3.5 w-3.5" aria-hidden />
          </button>

          {/* 4. Documentos / Notas */}
          <button
            type="button"
            title={
              docCount > 0
                ? `${docCount} documento${docCount === 1 ? "" : "s"} en la ficha`
                : "Ver documentos y notas"
            }
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              if (contactId) router.push(`/contacts/${contactId}#documentos`);
              else toast.info("Operación sin contacto asignado");
            }}
            className={cn(
              "inline-flex items-center gap-1 p-1 -m-1 rounded hover:bg-muted transition-all active:scale-90 cursor-pointer",
              docCount > 0
                ? "text-primary font-semibold hover:text-primary"
                : "hover:text-primary",
            )}
          >
            <FileText className="h-3.5 w-3.5" aria-hidden />
            {docCount > 0 && (
              <span className="text-[10px] tabular-nums">{docCount}</span>
            )}
          </button>

          {/* 5. Tareas / Actividades */}
          <button
            type="button"
            title="Ver actividades y tareas pendientes"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              router.push(
                contactId ? `/activities?contactId=${contactId}` : "/activities",
              );
            }}
            className="p-1 -m-1 rounded hover:bg-muted hover:text-primary transition-all active:scale-90 cursor-pointer"
          >
            <CheckSquare className="h-3.5 w-3.5" aria-hidden />
          </button>

          {/* 6. Calendario / Fecha de Cierre Estimado */}
          <button
            type="button"
            title={
              closeDateFormatted
                ? `Cierre estimado: ${closeDateFormatted}`
                : "Ver calendario de seguimiento"
            }
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              router.push("/activities");
            }}
            className={cn(
              "inline-flex items-center gap-1 p-1 -m-1 rounded hover:bg-muted transition-all active:scale-90 cursor-pointer",
              closeDateFormatted
                ? "text-primary font-semibold hover:text-primary"
                : "hover:text-primary",
            )}
          >
            <Calendar className="h-3.5 w-3.5" aria-hidden />
            {closeDateFormatted && (
              <span className="text-[10px] tabular-nums">
                {closeDateFormatted}
              </span>
            )}
          </button>
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
          onUpdated={(guia, codigo, clave) => {
            setCurrentNumeroGuia(guia || null);
            setCurrentCodigoRastreo(codigo || null);
            setCurrentClaveRecojo(clave || null);
          }}
          onAbrirSeguimientoCompleto={() => setShalomOpen(true)}
        />
      )}

      {mostrarBotonShalom && (
        <SeguimientoShalomModal
          open={shalomOpen}
          onOpenChange={setShalomOpen}
          data={shalomData}
          onUpdated={(guia, codigo, clave) => {
            setCurrentNumeroGuia(guia || null);
            setCurrentCodigoRastreo(codigo || null);
            setCurrentClaveRecojo(clave || null);
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
    </Card>
  );
}
