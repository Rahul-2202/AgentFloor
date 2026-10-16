-- M3 Ada, M4 memory, M5 governance.

-- Governance: room settings (permissions, when-blocked, publish mode) and locks live with the setup.
alter table public.rooms add column settings jsonb not null default '{}';

-- Memory ----------------------------------------------------------------
alter table public.memory_items drop constraint memory_items_layer_check;
alter table public.memory_items add constraint memory_items_layer_check
  check (layer in ('company', 'ceo', 'room', 'agent', 'conversation', 'short_term'));
alter table public.memory_items
  add column tags text[] not null default '{}',
  add column version int not null default 1,
  add column updated_by text,
  add column superseded_by uuid references public.memory_items (id) on delete set null;
create index on public.memory_items using gin (tags);
create index memory_items_search on public.memory_items using gin (to_tsvector('english', title || ' ' || body));

-- Every change to an item keeps the version before it.
create table public.memory_versions (
  item_id uuid not null references public.memory_items (id) on delete cascade,
  office_id uuid not null references public.offices (id) on delete cascade,
  v int not null,
  title text not null,
  body text not null,
  status text not null,
  changed_by text,
  created_at timestamptz not null default now(),
  primary key (item_id, v)
);

create or replace function private.version_memory_item()
returns trigger language plpgsql set search_path = '' as $$
begin
  if (old.title, old.body, old.status) is distinct from (new.title, new.body, new.status) then
    insert into public.memory_versions (item_id, office_id, v, title, body, status, changed_by)
    values (old.id, old.office_id, old.version, old.title, old.body, old.status, old.updated_by);
    new.version := old.version + 1;
  end if;
  return new;
end $$;
create trigger version_memory_item before update on public.memory_items
  for each row execute function private.version_memory_item();

-- Anyone who reads an item can flag it stale; flags on the same item merge.
create table public.memory_flags (
  id uuid primary key default gen_random_uuid(),
  office_id uuid not null references public.offices (id) on delete cascade,
  item_id uuid not null references public.memory_items (id) on delete cascade,
  reasons text[] not null default '{}',
  flagged_by text[] not null default '{}',
  state text not null default 'open' check (state in ('open', 'resolved')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
create unique index memory_flags_one_open on public.memory_flags (item_id) where state = 'open';

-- How well memory works, per day (the measures in M4).
create table public.memory_measures (
  office_id uuid not null references public.offices (id) on delete cascade,
  day date not null,
  metric text not null,
  value bigint not null default 0,
  primary key (office_id, day, metric)
);

create or replace function public.bump_memory_measure(oid uuid, metric_name text, amount bigint default 1)
returns void language sql security definer set search_path = '' as $$
  insert into public.memory_measures (office_id, day, metric, value) values (oid, (now() at time zone 'utc')::date, metric_name, amount)
  on conflict (office_id, day, metric) do update set value = public.memory_measures.value + excluded.value
$$;
revoke execute on function public.bump_memory_measure(uuid, text, bigint) from public, anon, authenticated;
grant execute on function public.bump_memory_measure(uuid, text, bigint) to service_role;

-- Ada ----------------------------------------------------------------------
create table public.ada_messages (
  id bigint generated always as identity primary key,
  office_id uuid not null references public.offices (id) on delete cascade,
  role text not null check (role in ('ceo', 'ada')),
  content text not null default '',
  -- Read-back cards and other things Ada put in the chat: [{type:'proposal', id, ops, baseVersion, readback, state}]
  cards jsonb not null default '[]',
  mode text not null default 'chat' check (mode in ('chat', 'onboarding', 'job')),
  created_at timestamptz not null default now()
);
create index on public.ada_messages (office_id, created_at);

alter table public.inbox_items add column ada_note text;
alter table public.meetings add column request_inbox_id text;
alter table public.minutes add column memory_ids uuid[] not null default '{}';

-- Setup: room settings and locks round-trip through apply_office_setup.
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

  delete from public.agents a where a.office_id = oid
    and not exists (select 1 from jsonb_array_elements(setup -> 'agents') x where x ->> 'id' = a.id);
  delete from public.rooms r where r.office_id = oid
    and not exists (select 1 from jsonb_array_elements(setup -> 'rooms') x where x ->> 'id' = r.id);

  insert into public.rooms (office_id, id, name, purpose, head_id, slot, responsibilities, definition_of_done, settings)
  select oid, x ->> 'id', x ->> 'name', x ->> 'purpose', x ->> 'head', (x ->> 'slot')::int, x ->> 'responsibilities', x ->> 'dod',
         jsonb_strip_nulls(jsonb_build_object('permissions', x -> 'permissions', 'whenBlocked', x -> 'whenBlocked', 'publish', x -> 'publish'))
  from jsonb_array_elements(setup -> 'rooms') x
  on conflict (office_id, id) do update set name = excluded.name, purpose = excluded.purpose, head_id = excluded.head_id,
    slot = excluded.slot, responsibilities = excluded.responsibilities, definition_of_done = excluded.definition_of_done, settings = excluded.settings;

  insert into public.agents (office_id, id, room_id, name, role, title, runtime, model, effort, role_card, permissions, options)
  select oid, x ->> 'id', x ->> 'room', x ->> 'name', x ->> 'role', coalesce(x ->> 'title', ''), x ->> 'runtime', x ->> 'model', x ->> 'effort',
         coalesce(x -> 'roleCard', '{}'), coalesce(x -> 'permissions', '{}'), coalesce(x -> 'options', '{}')
  from jsonb_array_elements(setup -> 'agents') x
  on conflict (office_id, id) do update set room_id = excluded.room_id, name = excluded.name, role = excluded.role, title = excluded.title,
    runtime = excluded.runtime, model = excluded.model, effort = excluded.effort, role_card = excluded.role_card,
    permissions = excluded.permissions, options = excluded.options;

  insert into public.policies (office_id, scope, scope_id, settings)
  values (oid, 'office', '', jsonb_build_object('protocol', setup -> 'policy', 'budgets', coalesce(setup -> 'budgets', '[]'), 'locks', coalesce(setup -> 'locks', '[]')))
  on conflict (office_id, scope, scope_id) do update set settings = excluded.settings, updated_at = now();

  insert into public.config_versions (office_id, v, by, summary, readback, diff, setup)
  values (oid, v, by_actor, summary, readback, diff, setup);

  insert into public.audit_log (office_id, actor, action, target, detail)
  values (oid, by_actor, 'setup.applied', 'v' || v, jsonb_build_object('summary', summary, 'readback', to_jsonb(readback), 'diff', diff));
  return v;
end $$;

-- Row-level security and Realtime for the new tables.
do $$
declare t text;
begin
  foreach t in array array['memory_versions', 'memory_flags', 'memory_measures', 'ada_messages'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "read own office" on public.%I for select to authenticated using (private.owns_office(office_id))', t);
  end loop;
end $$;

alter publication supabase_realtime add table public.ada_messages, public.memory_flags, public.audit_log;

-- Audit entries from office events carry the event's seq, so projecting twice adds nothing.
alter table public.audit_log add column seq bigint;
create unique index audit_log_office_seq on public.audit_log (office_id, seq) where seq is not null;
