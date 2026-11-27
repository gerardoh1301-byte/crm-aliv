"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, Plus, LayoutGrid, List, Settings2, Truck, FileSpreadsheet, Bell } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { Pipeline } from "@/types";
import { useEsAdmin } from "@/lib/use-es-admin";

interface PipelineHeaderProps {
  pipelines: Pipeline[];
  selectedPipelineId: string | null;
  onSelect: (id: string) => void;
  dealCount: number;
  view: "kanban" | "list";
  onViewChange: (view: "kanban" | "list") => void;
  onOpenEditor: () => void;
}

export function PipelineHeader({
  pipelines,
  selectedPipelineId,
  onSelect,
  dealCount,
  view,
  onViewChange,
  onOpenEditor,
}: PipelineHeaderProps) {
  const esAdmin = useEsAdmin();
  const router = useRouter();
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [verificandoShalom, setVerificandoShalom] = useState(false);
  const [sincronizandoSheets, setSincronizandoSheets] = useState(false);

  const handleAbrirSheets = async () => {
    // Abrir hoja en nueva pestaña
    window.open("https://docs.google.com/spreadsheets/d/1vBgWP5MELBc-hiq-Mz4gBJqpxvF2sKTEGhfnddZpkoo/edit", "_blank");
    // Sincronizar en segundo plano
    setSincronizandoSheets(true);
    try {
      const res = await fetch("/api/sheets/sync-envios", { method: "POST" });
      const json = await res.json();
      if (json.ok) {
        toast.success(`Google Sheets actualizado: ${json.total} envíos respaldados`);
      }
    } catch {
      // noop
    } finally {
      setSincronizandoSheets(false);
    }
  };

  const handleVerificarShalom = async (forzar = false) => {
    setVerificandoShalom(true);
    try {
      const res = await fetch("/api/shalom/verificar-envios", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ forzarReenvio: forzar }),
      });
      const json = await res.json();
      if (json.ok && json.data) {
        const { totalVerificados, enDestinoListos, notificacionesEnviadas, yaEntregados } = json.data;
        if (enDestinoListos > 0) {
          toast.success(
            `Shalom: ${enDestinoListos} en agencia (${notificacionesEnviadas} mensajes/recordatorios enviados), ${yaEntregados} entregados`,
            { duration: 6000 }
          );
        } else {
          toast.info(`Shalom: ${totalVerificados} guías consultadas. Ninguna pendiente de llegada.`);
        }
        router.refresh();
      } else {
        toast.error(json.error || "Error al verificar Shalom");
      }
    } catch {
      toast.error("Error de conexión al rastrear Shalom");
    } finally {
      setVerificandoShalom(false);
    }
  };

  const selected =
    pipelines.find((p) => p.id === selectedPipelineId) ?? pipelines[0] ?? null;

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name) {
      toast.error("Nombre requerido");
      return;
    }
    setCreating(true);
    try {
      const res = await fetch("/api/pipelines", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) throw new Error("error");
      const created = (await res.json()) as { id: string };
      toast.success("Pipeline creado");
      setNewName("");
      setCreateOpen(false);
      router.refresh();
      // Select after refresh
      setTimeout(() => onSelect(created.id), 0);
    } catch {
      toast.error("No se pudo crear el pipeline");
    } finally {
      setCreating(false);
    }
  };

  return (
    <>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <button className="flex items-center gap-2 rounded-lg border border-border/60 bg-card px-3 py-2 text-sm font-medium hover:bg-muted/40 transition-colors cursor-pointer min-w-50" />
              }
            >
              <span className="truncate flex-1 text-left">
                {selected?.name ?? "Sin pipeline"}
              </span>
              <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-60">
              {pipelines.map((p) => (
                <DropdownMenuItem
                  key={p.id}
                  onClick={() => onSelect(p.id)}
                  className={cn(
                    "cursor-pointer",
                    p.id === selected?.id && "bg-muted/60"
                  )}
                >
                  <span className="flex-1 truncate">{p.name}</span>
                  {p.isDefault && (
                    <span className="text-[10px] text-muted-foreground">
                      default
                    </span>
                  )}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => setCreateOpen(true)}
                className="cursor-pointer text-primary"
              >
                <Plus className="h-4 w-4" />
                Crear pipeline nuevo
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <span className="text-sm text-muted-foreground tabular-nums">
            {dealCount} {dealCount === 1 ? "oportunidad" : "oportunidades"}
          </span>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleAbrirSheets}
            disabled={sincronizandoSheets}
            className="h-8 gap-1.5 text-xs font-semibold border-emerald-200 dark:border-emerald-900/40 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 cursor-pointer shadow-xs"
            title="Abrir hoja de cálculo de Google Sheets con el respaldo en vivo de todos los despachos, motorizados, guías y claves de retiro Shalom"
          >
            <FileSpreadsheet className={cn("h-3.5 w-3.5", sincronizandoSheets && "animate-pulse")} />
            {sincronizandoSheets ? "Sincronizando..." : "Respaldo Sheets"}
          </Button>

          <div className="inline-flex rounded-lg shadow-xs">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => handleVerificarShalom(false)}
              disabled={verificandoShalom}
              className="h-8 gap-1.5 text-xs font-semibold rounded-r-none border-red-200 dark:border-red-900/40 text-red-700 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 cursor-pointer"
              title="Verificar estado en vivo en Shalom y avisar a nuevas llegadas o recordatorios automáticos (> 20h)"
            >
              <Truck className={cn("h-3.5 w-3.5", verificandoShalom && "animate-pulse")} />
              {verificandoShalom ? "Rastreando..." : "Rastrear Shalom"}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger
                className="flex items-center justify-center h-8 px-1.5 rounded-r-lg border border-l-0 border-red-200 dark:border-red-900/40 text-red-700 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 cursor-pointer disabled:opacity-50"
                disabled={verificandoShalom}
                title="Opciones de rastreo y recordatorio"
              >
                <ChevronDown className="h-3.5 w-3.5" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64">
                <DropdownMenuItem
                  onClick={() => handleVerificarShalom(false)}
                  className="cursor-pointer text-xs"
                >
                  <Truck className="h-3.5 w-3.5 mr-2 text-red-600" />
                  <div>
                    <div className="font-medium">Rastrear estándar</div>
                    <div className="text-[10px] text-muted-foreground">Nuevas llegadas y recordatorios (+20h)</div>
                  </div>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => handleVerificarShalom(true)}
                  className="cursor-pointer text-xs text-red-700 dark:text-red-400 font-medium"
                >
                  <Bell className="h-3.5 w-3.5 mr-2" />
                  <div>
                    <div className="font-semibold">Re-recordar a TODOS</div>
                    <div className="text-[10px] text-muted-foreground">Enviar aviso de urgencia a todos antes de devolución</div>
                  </div>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <div className="inline-flex rounded-lg border border-border/60 bg-card p-0.5">
            <button
              type="button"
              onClick={() => onViewChange("kanban")}
              className={cn(
                "flex h-7 w-7 items-center justify-center rounded-md transition-colors cursor-pointer",
                view === "kanban"
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
              aria-label="Vista kanban"
              title="Kanban"
            >
              <LayoutGrid className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => onViewChange("list")}
              className={cn(
                "flex h-7 w-7 items-center justify-center rounded-md transition-colors cursor-pointer",
                view === "list"
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
              aria-label="Vista lista"
              title="Lista"
            >
              <List className="h-3.5 w-3.5" />
            </button>
          </div>
          {esAdmin && (
          <button
            type="button"
            onClick={onOpenEditor}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-border/60 bg-card text-muted-foreground hover:bg-muted/40 hover:text-foreground transition-colors cursor-pointer"
            aria-label="Editar pipeline"
            title="Editar pipeline"
          >
            <Settings2 className="h-4 w-4" />
          </button>
          )}
        </div>
      </div>

      <Dialog open={createOpen} onOpenChange={(v) => !v && setCreateOpen(false)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Crear pipeline nuevo</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="new-pipeline-name">Nombre</Label>
              <Input
                id="new-pipeline-name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Ej: Funnel redes sociales"
                autoFocus
              />
              <p className="text-xs text-muted-foreground">
                Se creará con etapas por defecto: Prospecto · Contactado · Propuesta · Negociación · Cerrado Ganado · Cerrado Perdido.
              </p>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button
                variant="outline"
                onClick={() => setCreateOpen(false)}
                className="cursor-pointer"
              >
                Cancelar
              </Button>
              <Button
                onClick={handleCreate}
                disabled={creating}
                className="cursor-pointer"
              >
                {creating ? "Creando..." : "Crear"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
