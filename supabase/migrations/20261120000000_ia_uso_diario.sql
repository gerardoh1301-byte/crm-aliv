-- ============================================================================
-- Consumo diario de IA (tokens y llamadas) para vigilar la cuota de Gemini.
-- Una fila por día (hora de Lima), proveedor, modelo y origen; se incrementa con upsert.
-- ============================================================================

create table if not exists public.ia_uso_diario (
  fecha date not null,
  proveedor text not null,
  modelo text not null,
  origen text not null,
  llamadas integer not null default 0,
  fallidas integer not null default 0,
  tokens_entrada bigint not null default 0,
  tokens_salida bigint not null default 0,
  tokens_cache bigint not null default 0,
  actualizado timestamptz not null default now(),
  primary key (fecha, proveedor, modelo, origen)
);

alter table public.ia_uso_diario enable row level security;
