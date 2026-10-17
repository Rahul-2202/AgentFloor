-- Each office runs on its CEO's own Claude login (`claude setup-token`). The
-- token is kept in Supabase Vault (encrypted at rest); only the API reads it,
-- through these functions. Browsers see whether it's set, its last characters
-- and its status (integrations.config), never the token.

create extension if not exists supabase_vault with schema vault;

alter table public.integrations drop constraint if exists integrations_provider_check;
alter table public.integrations add constraint integrations_provider_check check (provider in ('github', 'linear', 'claude'));

-- Saves (or replaces) an office's token.
create or replace function public.set_claude_token(oid uuid, token text, last4 text)
returns void language plpgsql security definer set search_path = '' as $$
declare sid uuid;
begin
  select secret_id into sid from public.integrations where office_id = oid and provider = 'claude';
  if sid is null then
    sid := vault.create_secret(token, 'claude-token-' || oid::text, 'AgentFloor: an office''s Claude login');
  else
    perform vault.update_secret(sid, token);
  end if;
  insert into public.integrations (office_id, provider, secret_id, config, status, updated_at)
  values (oid, 'claude', sid, jsonb_build_object('last4', last4, 'setAt', now(), 'status', 'ok'), 'connected', now())
  on conflict (office_id, provider) do update
    set secret_id = excluded.secret_id, config = excluded.config, status = 'connected', updated_at = now();
end $$;

-- The token itself (the API, to start the office and run Ada).
create or replace function public.claude_token(oid uuid)
returns text language sql security definer set search_path = '' as $$
  select s.decrypted_secret from vault.decrypted_secrets s
  join public.integrations i on i.secret_id = s.id
  where i.office_id = oid and i.provider = 'claude'
$$;

revoke execute on function public.set_claude_token(uuid, text, text) from public, anon, authenticated;
revoke execute on function public.claude_token(uuid) from public, anon, authenticated;
grant execute on function public.set_claude_token(uuid, text, text) to service_role;
grant execute on function public.claude_token(uuid) to service_role;

-- An office's token goes with it.
create or replace function private.forget_integration_secret()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.secret_id is not null then
    delete from vault.secrets where id = old.secret_id;
  end if;
  return old;
end $$;
create trigger forget_integration_secret after delete on public.integrations
  for each row execute function private.forget_integration_secret();
