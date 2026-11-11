"use client";

import { useState, useMemo } from "react";
import { useDroppable } from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { Search, X } from "lucide-react";
import { DealCard } from "./DealCard";
import { formatCurrency } from "@/lib/constants";
import { cn } from "@/lib/utils";
import type { DealWithContact } from "@/types";

interface KanbanColumnProps {
  id: string;
  name: string;
  color: string;
  deals: DealWithContact[];
}

export function KanbanColumn({ id, name, color, deals }: KanbanColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id });
  const [search, setSearch] = useState("");

  const filteredDeals = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return deals;

    const qDigits = q.replace(/\D/g, "");

    return deals.filter((deal) => {
      // 1. Número de orden (#1053 o 1053) y título
      if (deal.numeroOrden && deal.numeroOrden.toLowerCase().includes(q)) return true;
      if (deal.title && deal.title.toLowerCase().includes(q)) return true;

      // 2. Nombre de cliente
      if (deal.contactName && deal.contactName.toLowerCase().includes(q)) return true;
      if (deal.contact?.name && deal.contact.name.toLowerCase().includes(q)) return true;

      // 3. Teléfono (con formato o solo dígitos)
      if (deal.contactPhone) {
        if (deal.contactPhone.toLowerCase().includes(q)) return true;
        if (qDigits && deal.contactPhone.replace(/\D/g, "").includes(qDigits)) return true;
      }
      if (deal.contact?.phone) {
        if (deal.contact.phone.toLowerCase().includes(q)) return true;
        if (qDigits && deal.contact.phone.replace(/\D/g, "").includes(qDigits)) return true;
      }

      // 4. Ciudad, distrito, dirección, DNI y guía
      if (deal.ciudad && deal.ciudad.toLowerCase().includes(q)) return true;
      if (deal.distrito && deal.distrito.toLowerCase().includes(q)) return true;
      if (deal.direccion && deal.direccion.toLowerCase().includes(q)) return true;
      if (deal.dniCliente && deal.dniCliente.toLowerCase().includes(q)) return true;
      if (deal.numeroGuia && deal.numeroGuia.toLowerCase().includes(q)) return true;
      if (deal.tags && deal.tags.some((t) => t.toLowerCase().includes(q))) return true;

      return false;
    });
  }, [deals, search]);

  const totalValue = deals.reduce((sum, d) => sum + d.value, 0);
  const filteredValue = filteredDeals.reduce((sum, d) => sum + d.value, 0);

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex flex-col w-72 shrink-0 rounded-xl border border-border/60 bg-card transition-colors",
        isOver && "border-primary/50 bg-primary/5",
      )}
    >
      {/* Header columna */}
      <div className="sticky top-0 z-10 flex items-center gap-2 px-3.5 py-2.5 border-b border-border/60 bg-card rounded-t-xl">
        <div
          className="w-2.5 h-2.5 rounded-full shrink-0"
          style={{ backgroundColor: color }}
        />
        <h3 className="text-[13px] font-semibold tracking-tight flex-1 truncate">
          {name}
        </h3>
        <span className="text-[10.5px] font-semibold tabular-nums text-muted-foreground bg-muted rounded-full px-1.5 py-0.5">
          {deals.length}
        </span>
      </div>

      {/* Buscador rápido por columna */}
      <div className="px-2.5 py-1.5 border-b border-border/60 bg-card/60">
        <div className="relative flex items-center">
          <Search className="absolute left-2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar orden, cliente, tel..."
            className="w-full h-7 pl-7 pr-6 text-[11px] rounded-md border border-border/60 bg-muted/30 placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-primary/50 focus:bg-background transition-colors"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              className="absolute right-1.5 text-muted-foreground hover:text-foreground p-0.5 rounded-sm"
              title="Limpiar búsqueda"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Subheader: Valor total y badge de filtro */}
      <div className="px-3.5 py-1.5 border-b border-border/60 bg-muted/20 flex items-center justify-between text-[11px]">
        <p className="text-muted-foreground tabular-nums truncate">
          <span className="font-semibold text-foreground">
            {formatCurrency(search.trim() ? filteredValue : totalValue)}
          </span>{" "}
          en valor
        </p>
        {search.trim() && (
          <span className="shrink-0 text-[10px] font-semibold text-primary bg-primary/10 border border-primary/20 px-1.5 py-0.2 rounded-full">
            {filteredDeals.length} de {deals.length}
          </span>
        )}
      </div>

      {/* Lista de tarjetas con Drag-and-Drop */}
      <SortableContext
        items={filteredDeals.map((d) => d.id)}
        strategy={verticalListSortingStrategy}
      >
        <div className="flex-1 p-2.5 space-y-2 min-h-[200px] max-h-[calc(100vh-260px)] overflow-y-auto">
          {filteredDeals.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border/60 bg-muted/20 p-4 text-center text-[11px] text-muted-foreground">
              {search.trim() ? (
                <div className="space-y-1.5">
                  <p className="font-medium">Sin resultados para &ldquo;{search}&rdquo;</p>
                  <button
                    type="button"
                    onClick={() => setSearch("")}
                    className="text-primary hover:underline text-[10.5px] cursor-pointer"
                  >
                    Borrar filtro
                  </button>
                </div>
              ) : (
                "Sin deals en esta etapa"
              )}
            </div>
          ) : (
            filteredDeals.map((deal) => <DealCard key={deal.id} {...deal} />)
          )}
        </div>
      </SortableContext>
    </div>
  );
}
