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

  // Tarjeta compacta: nombre, monto, productos, destino y UNA accion principal segun la
  // etapa. Asignar, marcar courier, rotulos y accesos van en el menu "⋯".
  const etapaTemprana =
    !pedidoId &&
    (/consulta|carrito|intenci/.test(stageKeyLower) || /consulta|intenci/.test(stageNameLower));
  const accionPrincipal: "shalom" | "motorizado" | null = etapaTemprana
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

        {/* Accion principal segun la etapa */}
        {accionPrincipal === "shalom" && (
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
              "w-full h-7 text-[11px] font-semibold gap-1.5 shadow-none cursor-pointer",
              currentNumeroGuia
                ? "bg-red-500/10 hover:bg-red-500/20 text-red-700 dark:text-red-400 border-red-500/30"
                : "bg-amber-500/10 hover:bg-amber-500/20 text-amber-700 dark:text-amber-400 border-amber-500/30",
            )}
          >
            <Truck className="h-3.5 w-3.5 shrink-0" aria-hidden />
            <span className="truncate">
              {currentNumeroGuia ? `Shalom #${currentNumeroGuia}` : "Registrar guía Shalom"}
            </span>
          </Button>
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

        {/* Pie: contacto rapido, asesor y menu */}
        <div className="flex items-center gap-2.5 pt-2 border-t border-border/40 text-muted-foreground" onClick={(e) => e.stopPropagation()}>
          {contactPhone ? (
            <a
              href={`tel:${contactPhone}`}
              title={`Llamar a ${contactPhone}`}
              {...pararArrastre}
              className="p-1 -m-1 rounded hover:bg-muted hover:text-primary"
            >
              <Phone className="h-3.5 w-3.5" aria-hidden />
            </a>
          ) : null}
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
