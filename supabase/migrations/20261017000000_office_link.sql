-- The office link (daemon ↔ Control API). Service-role-only functions, since
-- private.office_tokens isn't exposed over the API.

create or replace function public.set_office_token(oid uuid, hash text)
returns void language sql security definer set search_path = '' as $$
  insert into private.office_tokens (office_id, token_hash) values (oid, hash)
  on conflict (office_id) do update set token_hash = excluded.token_hash, created_at = now()
$$;

create or replace function public.office_token_hash(oid uuid)
returns text language sql stable security definer set search_path = '' as $$
  select token_hash from private.office_tokens where office_id = oid
$$;

-- Stores a batch of daemon events (re-sent ones are ignored) and returns the
-- highest seq now stored, which the API acknowledges to the daemon.
create or replace function public.ingest_office_events(oid uuid, events jsonb)
returns bigint language plpgsql security definer set search_path = '' as $$
declare top bigint;
begin
  insert into public.office_events (office_id, seq, type, data, at)
  select oid, (e ->> 'seq')::bigint, e ->> 'type', coalesce(e -> 'data', '{}'),
         to_timestamp((e ->> 'at')::double precision / 1000)
  from jsonb_array_elements(events) e
  on conflict do nothing;

  update public.offices
     set last_event_seq = greatest(last_event_seq, coalesce((select max((e ->> 'seq')::bigint) from jsonb_array_elements(events) e), 0)),
         daemon_seen_at = now()
   where id = oid
  returning last_event_seq into top;
  return top;
end $$;

revoke execute on function public.set_office_token(uuid, text) from public, anon, authenticated;
revoke execute on function public.office_token_hash(uuid) from public, anon, authenticated;
revoke execute on function public.ingest_office_events(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.set_office_token(uuid, text) to service_role;
grant execute on function public.office_token_hash(uuid) to service_role;
grant execute on function public.ingest_office_events(uuid, jsonb) to service_role;
