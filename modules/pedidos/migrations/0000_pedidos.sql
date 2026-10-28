-- Modulo pedidos (Ordenes COD y Seguimiento Logistico Aliv Store). Idempotente.

create table if not exists pedidos_ordenes (
  id                text primary key,
  numero_orden      text not null unique,
  shopify_order_id  text unique,
  contact_id        text not null references contacts(id) on delete cascade,
  deal_id           text references deals(id) on delete set null,
  estado            text not null default 'por_confirmar_cod',
  modalidad_pago    text not null default 'contraentrega',
  items             jsonb not null default '[]'::jsonb,
  total             numeric(12, 2) not null default 0,
  moneda            text not null default 'PEN',
  dni_cliente       text,
  ciudad            text,
  distrito          text,
  direccion_envio   text,
  transportadora    text,
  numero_guia       text,
  clave_recojo      text,
  notas             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists pedidos_ordenes_contact_idx on pedidos_ordenes (contact_id);
create index if not exists pedidos_ordenes_estado_idx  on pedidos_ordenes (estado);
create index if not exists pedidos_ordenes_numero_idx  on pedidos_ordenes (numero_orden);

-- RLS: cada miembro lee los pedidos de sus contactos; el admin todos.
alter table pedidos_ordenes enable row level security;
drop policy if exists pedidos_ordenes_select on pedidos_ordenes;
create policy pedidos_ordenes_select on pedidos_ordenes for select to authenticated
  using (public.contacto_visible(contact_id));
