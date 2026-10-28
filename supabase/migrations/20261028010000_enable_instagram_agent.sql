-- ============================================================================
-- Activar Agente de IA para Instagram DMs
-- ============================================================================

update public.agent_configs
set enabled = true, updated_at = now()
where channel in ('whatsapp', 'instagram');

insert into public.agent_configs (tenant_id, channel, enabled)
select id, 'instagram', true
from public.tenants
on conflict (tenant_id, channel)
do update set enabled = true, updated_at = now();
