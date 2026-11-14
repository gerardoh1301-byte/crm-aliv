"use client";

import { useMemo, useState, useEffect, useSyncExternalStore } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { KanbanBoard } from "./KanbanBoard";
import { PipelineHeader } from "./PipelineHeader";
import { PipelineToolbar } from "./PipelineToolbar";
import { PipelineEditor } from "./PipelineEditor";
import { DealsListView } from "./DealsListView";
import { DEFAULT_FILTERS, DEFAULT_SORT } from "./types";
import type { PipelineFilters, PipelineSort } from "./types";
import { applyFilters, applySort } from "./filterSort";
import type { Pipeline, PipelineColumn, DealWithContact } from "@/types";
import { Kanban, X } from "lucide-react";

interface PipelineWorkspaceProps {
  pipelines: Pipeline[];
  deals: DealWithContact[];
}

const STORAGE_KEY = "propcrm:selectedPipelineId";

function subscribeToStorage(callback: () => void) {
  if (typeof window === "undefined") return () => {};
  window.addEventListener("storage", callback);
  return () => window.removeEventListener("storage", callback);
}

export function PipelineWorkspace({ pipelines, deals }: PipelineWorkspaceProps) {
  const storedId = useSyncExternalStore(
    subscribeToStorage,
    () => (typeof window !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null),
    () => null
  );
  const [overrideId, setOverrideId] = useState<string | null>(null);
  const [view, setView] = useState<"kanban" | "list">("kanban");
  const [filters, setFilters] = useState<PipelineFilters>(DEFAULT_FILTERS);
  const [sort, setSort] = useState<PipelineSort>(DEFAULT_SORT);
  const [editorOpen, setEditorOpen] = useState(false);

  const validStoredId =
    storedId && pipelines.some((p) => p.id === storedId) ? storedId : null;
  const selectedPipelineId =
    overrideId ?? validStoredId ?? pipelines[0]?.id ?? null;

  const setSelectedPipelineId = (id: string) => {
    setOverrideId(id);
    if (typeof window !== "undefined") {
      localStorage.setItem(STORAGE_KEY, id);
    }
  };

  const searchParams = useSearchParams();
  const router = useRouter();

  const urlContactId = searchParams.get("contactId");
  const urlSearch = searchParams.get("search");

  // Si viene contactId o search desde la URL, activar el pipeline correcto y aplicar filtro
  useEffect(() => {
    if (urlContactId || urlSearch) {
      const q = urlSearch?.trim().toLowerCase() || "";
      const targetDeal = deals.find(
        (d) =>
          (urlContactId && d.contactId === urlContactId) ||
          (q &&
            ((d.contactName && d.contactName.toLowerCase().includes(q)) ||
              (d.numeroOrden && d.numeroOrden.toLowerCase().includes(q)) ||
              (d.contactPhone && d.contactPhone.includes(q))))
      );

      if (targetDeal) {
        const pipelineTarget = pipelines.find((p) =>
          p.stages.some((s) => s.id === targetDeal.stageId)
        );
        if (pipelineTarget && pipelineTarget.id !== selectedPipelineId) {
          setSelectedPipelineId(pipelineTarget.id);
        }
      }

      setFilters((prev) => ({
        ...prev,
        contactId: urlContactId || null,
        search: urlSearch || null,
      }));
    }
  }, [urlContactId, urlSearch, deals, pipelines]);

  const limpiarFiltroUrl = () => {
    setFilters((prev) => ({ ...prev, contactId: null, search: null }));
    router.replace("/pipeline");
  };

  const selectedPipeline = useMemo(
    () => pipelines.find((p) => p.id === selectedPipelineId) ?? null,
    [pipelines, selectedPipelineId]
  );

  const columns: PipelineColumn[] = useMemo(() => {
    if (!selectedPipeline) return [];
    return selectedPipeline.stages
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((stage) => ({
        ...stage,
        deals: deals.filter((d) => d.stageId === stage.id),
      }));
  }, [selectedPipeline, deals]);

  const allPipelineDeals = useMemo(
    () => columns.flatMap((c) => c.deals),
    [columns]
  );

  const visibleDeals = useMemo(
    () => applySort(applyFilters(allPipelineDeals, filters), sort),
    [allPipelineDeals, filters, sort]
  );

  if (pipelines.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border/60 p-8 text-center text-sm text-muted-foreground">
        No hay pipelines configurados. Recargá la página después de aplicar la migración.
      </div>
    );
  }

  return (
    <div className="w-full min-w-0">
      <div className="sticky top-0 z-20 bg-background -mt-6 md:-mt-8 lg:-mt-10 pt-3 pb-2.5 border-b border-border/60 mb-4 space-y-2.5">
        <PipelineHeader
          pipelines={pipelines}
          selectedPipelineId={selectedPipelineId}
          onSelect={setSelectedPipelineId}
          dealCount={allPipelineDeals.length}
          view={view}
          onViewChange={setView}
          onOpenEditor={() => setEditorOpen(true)}
        />
        <PipelineToolbar
          filters={filters}
          onFiltersChange={setFilters}
          sort={sort}
          onSortChange={setSort}
        />
      </div>

      {(filters.contactId || filters.search) && (
        <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-300 dark:border-emerald-800 text-xs text-emerald-900 dark:text-emerald-200 mb-4 animate-in fade-in-50">
          <span className="flex items-center gap-1.5 font-medium">
            <Kanban className="h-4 w-4 text-emerald-600 shrink-0" />
            <span>
              Filtrando cartilla de:{" "}
              <strong>{filters.search || "Cliente seleccionado"}</strong>
            </span>
          </span>
          <button
            type="button"
            onClick={limpiarFiltroUrl}
            className="text-xs font-semibold hover:underline cursor-pointer text-emerald-700 dark:text-emerald-400 flex items-center gap-1"
          >
            <X className="h-3.5 w-3.5" />
            <span>Ver todo el pipeline</span>
          </button>
        </div>
      )}

      {view === "kanban" ? (
        <KanbanBoard initialColumns={columns} filters={filters} sort={sort} />
      ) : (
        <DealsListView deals={visibleDeals} stages={selectedPipeline?.stages ?? []} />
      )}

      {selectedPipeline && (
        <PipelineEditor
          open={editorOpen}
          onClose={() => setEditorOpen(false)}
          pipeline={selectedPipeline}
          dealsByStage={Object.fromEntries(
            columns.map((c) => [c.id, c.deals.length])
          )}
          otherPipelines={pipelines.filter((p) => p.id !== selectedPipeline.id)}
          onPipelineDeleted={() => {
            const next = pipelines.find((p) => p.id !== selectedPipeline.id);
            if (next) setSelectedPipelineId(next.id);
            setEditorOpen(false);
          }}
        />
      )}
    </div>
  );
}
