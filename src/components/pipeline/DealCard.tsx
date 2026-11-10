"use client";

import { useState } from "react";
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
} from "lucide-react";
import { cn } from "@/lib/utils";
import { avatarBg, getInitials } from "@/lib/avatar";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { RotuloMotorizadoModal, type RotuloData } from "./RotuloMotorizadoModal";

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
}: DealCardProps) {
  const router = useRouter();
  const [rotuloOpen, setRotuloOpen] = useState(false);
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

  // Detección de orden de Lima para despacho con motorizado
  const ciudadLower = (ciudad || "").toLowerCase();
  const esLima =
    ciudadLower.includes("lima") ||
    ciudadLower.includes("callao") ||
    (!ciudadLower && Boolean(direccion));

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

  const mostrarBotonRotulo = esLima && esConfirmadoODespacho;

  const numeroOrdenLimpio =
    numeroOrden ||
    (title.startsWith("#") ? title.split("·")[0].trim() : "PEDIDO-LIMA");

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

        <div
          onClick={handleContactNavigate}
          className="flex items-center gap-2 cursor-pointer group/contact"
        >
          <div
            className={cn(
              "h-5 w-5 shrink-0 rounded-full flex items-center justify-center text-[9px] font-semibold transition-transform group-hover/contact:scale-110",
              avatarBg(contactName ?? "?"),
            )}
          >
            {getInitials(contactName)}
          </div>
          <span className="text-[11.5px] text-muted-foreground group-hover/contact:text-foreground truncate flex-1 transition-colors">
            {contactName || "Sin contacto"}
          </span>
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

        {/* Botón de Rótulo Motorizado (Solo para órdenes de Lima/Callao confirmadas o en despacho) */}
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
            <Printer className="h-3.5 w-3.5" />
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

          {/* 2. WhatsApp / Mensaje */}
          {waNumber ? (
            <a
              href={`https://wa.me/${waNumber}`}
              target="_blank"
              rel="noopener noreferrer"
              title={`Chatear por WhatsApp con ${contactPhone}`}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
              className="p-1 -m-1 rounded hover:bg-emerald-500/10 hover:text-emerald-600 transition-all active:scale-90"
            >
              <MessageCircle className="h-3.5 w-3.5" aria-hidden />
            </a>
          ) : (
            <button
              type="button"
              title="Abrir bandeja de mensajes"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                router.push("/conversations");
              }}
              className="p-1 -m-1 rounded hover:bg-muted hover:text-primary transition-all active:scale-90"
            >
              <MessageCircle className="h-3.5 w-3.5" aria-hidden />
            </button>
          )}

          {/* 3. Etiquetas / Ficha del Contacto */}
          <button
            type="button"
            title="Ver ficha y etiquetas del contacto"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              if (contactId) router.push(`/contacts/${contactId}`);
              else toast.info("Operación sin contacto asignado");
            }}
            className="p-1 -m-1 rounded hover:bg-muted hover:text-primary transition-all active:scale-90 cursor-pointer"
          >
            <Tag className="h-3.5 w-3.5" aria-hidden />
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
    </Card>
  );
}
