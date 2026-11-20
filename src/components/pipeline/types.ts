export interface PipelineFilters {
  minValue: number | null;
  maxValue: number | null;
  search?: string | null;
  contactId?: string | null;
}

export type SortField = "reciente" | "createdAt" | "value" | "probability";
export type SortDir = "asc" | "desc";

export interface PipelineSort {
  field: SortField;
  dir: SortDir;
}

export const DEFAULT_FILTERS: PipelineFilters = {
  minValue: null,
  maxValue: null,
  search: null,
  contactId: null,
};

// Por defecto, en cada etapa va arriba la tarjeta con la fecha más reciente (movimiento o pago)
export const DEFAULT_SORT: PipelineSort = {
  field: "reciente",
  dir: "desc",
};

export function activeFilterCount(filters: PipelineFilters): number {
  let n = 0;
  if (filters.minValue !== null) n++;
  if (filters.maxValue !== null) n++;
  if (filters.search) n++;
  if (filters.contactId) n++;
  return n;
}
