-- M2: the office's setup lives here (versioned, applied through the policy
-- engine), office activity is projected into readable tables, budgets.

-- Setup ------------------------------------------------------------------
alter table public.offices
  add column config_version int not null default 0,   -- latest applied setup version
  add column config_pushed int not null default 0,    -- version the daemon confirmed it runs
  add column projected_seq bigint not null default 0; -- office_events projected into the tables below

alter table public.rooms
  add column responsibilities text,
  add column definition_of_done text;

alter table public.agents
  add column options jsonb not null default '{}',
  add column held_reason text;                        -- set while the agent is parked

-- A full copy of the setup at each version, so any version can be restored.
alter table public.config_versions add column setup jsonb;

-- Replaces the office's setup in one transaction, if nobody changed it since
-- base_version. Returns the new version, or raises 'stale_setup'.
create or replace function public.apply_office_setup(
  oid uuid, base_version int, setup jsonb, by_actor text, summary text, readback text[], diff jsonb
) returns int language plpgsql security definer set search_path = '' as $$
declare v int;
begin
  select config_version into v from public.offices where id = oid for update;
  if v is null then raise exception 'no office %', oid; end if;
  if v <> base_version then raise exception 'stale_setup: the setup changed (now v%)', v using errcode = 'P0001'; end if;
  v := v + 1;

  update public.offices set name = setup ->> 'name', config_version = v where id = oid;

  -- Agents reference rooms, so agents go first on the way out and rooms first on the way in.
  delete from public.agents a where a.office_id = oid
    and not exists (select 1 from jsonb_array_elements(setup -> 'agents') x where x ->> 'id' = a.id);
  delete from public.rooms r where r.office_id = oid
    and not exists (select 1 from jsonb_array_elements(setup -> 'rooms') x where x ->> 'id' = r.id);

  insert into public.rooms (office_id, id, name, purpose, head_id, slot, responsibilities, definition_of_done)
  select oid, x ->> 'id', x ->> 'name', x ->> 'purpose', x ->> 'head', (x ->> 'slot')::int, x ->> 'responsibilities', x ->> 'dod'
  from jsonb_array_elements(setup -> 'rooms') x
  on conflict (office_id, id) do update set name = excluded.name, purpose = excluded.purpose, head_id = excluded.head_id,
    slot = excluded.slot, responsibilities = excluded.responsibilities, definition_of_done = excluded.definition_of_done;

  insert into public.agents (office_id, id, room_id, name, role, title, runtime, model, effort, role_card, permissions, options)
  select oid, x ->> 'id', x ->> 'room', x ->> 'name', x ->> 'role', coalesce(x ->> 'title', ''), x ->> 'runtime', x ->> 'model', x ->> 'effort',
         coalesce(x -> 'roleCard', '{}'), coalesce(x -> 'permissions', '{}'), coalesce(x -> 'options', '{}')
  from jsonb_array_elements(setup -> 'agents') x
  on conflict (office_id, id) do update set room_id = excluded.room_id, name = excluded.name, role = excluded.role, title = excluded.title,
    runtime = excluded.runtime, model = excluded.model, effort = excluded.effort, role_card = excluded.role_card,
    permissions = excluded.permissions, options = excluded.options;

  insert into public.policies (office_id, scope, scope_id, settings)
  values (oid, 'office', '', jsonb_build_object('protocol', setup -> 'policy', 'budgets', coalesce(setup -> 'budgets', '[]')))
  on conflict (office_id, scope, scope_id) do update set settings = excluded.settings, updated_at = now();

  insert into public.config_versions (office_id, v, by, summary, readback, diff, setup)
  values (oid, v, by_actor, summary, readback, diff, setup);

  insert into public.audit_log (office_id, actor, action, target, detail)
  values (oid, by_actor, 'setup.applied', 'v' || v, jsonb_build_object('summary', summary));
  return v;
end $$;

revoke execute on function public.apply_office_setup(uuid, int, jsonb, text, text, text[], jsonb) from public, anon, authenticated;
grant execute on function public.apply_office_setup(uuid, int, jsonb, text, text, text[], jsonb) to service_role;

-- Work -------------------------------------------------------------------
alter table public.tasks
  add column step text,
  add column blocker text,
  add column checklist jsonb not null default '[]',
  add column parent_id text;

alter table public.threads add column awaiting jsonb;

alter table public.usage_events add column room_id text;
alter table public.usage_events add column seq bigint;     -- the model.call event it came from
create unique index usage_events_office_seq on public.usage_events (office_id, seq);

-- Spend since a time, per agent (with its room); the API sums rooms and the office.
create or replace function public.office_spend(oid uuid, since timestamptz)
returns table (agent_id text, room_id text, calls bigint, input_tokens bigint, output_tokens bigint, cost_usd numeric)
language sql stable security definer set search_path = '' as $$
  select agent_id, room_id, count(*), sum(input_tokens + cache_read_tokens + cache_write_tokens), sum(output_tokens), sum(cost_usd)
  from public.usage_events where office_id = oid and created_at >= since
  group by agent_id, room_id
$$;
revoke execute on function public.office_spend(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.office_spend(uuid, timestamptz) to service_role;

alter publication supabase_realtime add table public.usage_events, public.config_versions;
