-- ============================================================================
-- Moderador de comentarios de Facebook e Instagram: un registro por comentario
-- revisado (para no actuar dos veces y para el resumen del día).
-- ============================================================================

create table if not exists public.comentarios_moderados (
  comment_id text primary key,
  plataforma text not null,
  post_id text not null,
  es_anuncio boolean not null default false,
  autor_id text,
  autor_nombre text,
  texto text not null default '',
  categoria text not null,
  accion text not null,
  respuesta text,
  privado boolean not null default false,
  modo text not null default 'prueba',
  error text,
  comentado_en timestamptz,
  procesado_en timestamptz not null default now()
);

create index if not exists comentarios_moderados_procesado_idx
  on public.comentarios_moderados (procesado_en desc);

alter table public.comentarios_moderados enable row level security;
