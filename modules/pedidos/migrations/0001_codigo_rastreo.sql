-- Agrega columna codigo_rastreo a pedidos_ordenes si no existe
alter table pedidos_ordenes add column if not exists codigo_rastreo text;
