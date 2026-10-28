-- Modulo catalogo (E-commerce Aliv Store). Idempotente.

create table if not exists catalogo_productos (
  id              text primary key,
  shopify_id      text unique,
  sku             text,
  handle          text,
  titulo          text not null,
  categoria       text not null default 'Bienestar',
  descripcion     text,
  beneficios      text,
  precauciones    text,
  precio          numeric(12, 2) not null default 0,
  precio_regular  numeric(12, 2),
  moneda          text not null default 'PEN',
  stock           integer not null default 50,
  disponible      boolean not null default true,
  imagen_url      text,
  public_url      text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists catalogo_productos_titulo_idx     on catalogo_productos (titulo);
create index if not exists catalogo_productos_categoria_idx  on catalogo_productos (categoria);
create index if not exists catalogo_productos_handle_idx     on catalogo_productos (handle);
create index if not exists catalogo_productos_disponible_idx on catalogo_productos (disponible);

-- RLS: lectura para cualquier miembro autenticado del equipo.
alter table catalogo_productos enable row level security;
drop policy if exists catalogo_productos_select on catalogo_productos;
create policy catalogo_productos_select on catalogo_productos for select to authenticated
  using (true);
