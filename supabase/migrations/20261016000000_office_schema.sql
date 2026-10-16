-- AgentFloor v1 schema.
--
-- One office per person: the signed-in user is the CEO of their own office.
-- Browsers only read (row-level security: your own office's rows); every write
-- goes through the Control API with the service role, which bypasses RLS.
--
-- Ids of things the office daemon creates (rooms, agents, tasks, threads,
-- messages, inbox items) are the daemon's own text ids, unique per office.

create extension if not exists pgcrypto with schema extensions;

-- ── helpers ────────────────────────────────────────────────────────────────

create schema if not exists private;

create or replace function private.touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ── people ─────────────────────────────────────────────────────────────────

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  github_login text,
  name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Who may sign in, for the internal v1. Not enforced yet (AGE-37): everyone may.
create table public.allowlist (
  id bigint generated always as identity primary key,
  github_login text unique,
  email text unique,
  note text,
  created_at timestamptz not null default now(),
  check (github_login is not null or email is not null)
);

-- A profile for every new user, filled from their GitHub identity.
create or replace function private.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, github_login, name, avatar_url)
  values (
    new.id,
    new.raw_user_meta_data ->> 'user_name',
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
    new.raw_user_meta_data ->> 'avatar_url'
  );
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

-- ── the office ─────────────────────────────────────────────────────────────

create table public.offices (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null unique references public.profiles (id) on delete cascade,
  name text not null,
  company jsonb not null default '{}',          -- what Ada learned: company, goals
  onboarded_at timestamptz,
  -- the office VM (Daytona) and its daemon
  sandbox_id text,
  sandbox_state text not null default 'none'
    check (sandbox_state in ('none', 'creating', 'started', 'stopped', 'archived', 'error')),
  daemon_connected boolean not null default false,
  daemon_seen_at timestamptz,
  last_event_seq bigint not null default 0,     -- highest daemon event stored (acknowledged)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- True when the signed-in user owns the office. Used by every RLS policy.
create or replace function private.owns_office(oid uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.offices where id = oid and owner_id = (select auth.uid()))
$$;
grant usage on schema private to authenticated;

-- The office token's hash, out of the API's reach (the private schema isn't
-- exposed). The token itself lives only in the office VM.
create table private.office_tokens (
  office_id uuid primary key references public.offices (id) on delete cascade,
  token_hash text not null,
  created_at timestamptz not null default now()
);
alter table private.office_tokens enable row level security;
revoke all on private.office_tokens from anon, authenticated;
grant execute on function private.owns_office(uuid) to authenticated;

create table public.rooms (
  office_id uuid not null references public.offices (id) on delete cascade,
  id text not null,
  name text not null,
  purpose text,
  head_id text,                                 -- agent id of the room's head
  slot int,                                     -- place on the floor plan
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (office_id, id)
);

create table public.agents (
  office_id uuid not null references public.offices (id) on delete cascade,
  id text not null,
  room_id text not null,
  name text not null,
  role text not null check (role in ('head', 'member')),
  title text not null default '',
  runtime text not null default 'claude-code',
  model text not null default 'haiku',
  effort text default 'low',
  role_card jsonb not null default '{}',
  permissions jsonb not null default '{}',      -- action -> 'free' | 'ask' | 'never'
  status text not null default 'offline'
    check (status in ('offline', 'idle', 'working', 'waiting', 'stopped')),
  activity text,                                -- what it is doing now, one line
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (office_id, id),
  foreign key (office_id, room_id) references public.rooms (office_id, id) on delete cascade
);

-- Settings for the office, a room or an agent: protocol limits, budgets,
-- when-blocked policy. The narrowest scope wins.
create table public.policies (
  id uuid primary key default gen_random_uuid(),
  office_id uuid not null references public.offices (id) on delete cascade,
  scope text not null check (scope in ('office', 'room', 'agent')),
  scope_id text not null default '',            -- room or agent id; '' for the office
  settings jsonb not null default '{}',
  updated_at timestamptz not null default now(),
  unique (office_id, scope, scope_id)
);

-- Rules that must never break. Only the CEO unlocks one, in the UI.
create table public.locked_rules (
  id uuid primary key default gen_random_uuid(),
  office_id uuid not null references public.offices (id) on delete cascade,
  text text not null,
  rule jsonb not null default '{}',             -- the machine-checkable form, if any
  locked boolean not null default true,
  created_by text not null default 'ceo',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Every applied config change, with the diff it came from, for rollback.
create table public.config_versions (
  office_id uuid not null references public.offices (id) on delete cascade,
  v int not null,
  by text not null,                             -- 'ceo', 'ada'
  summary text not null,
  readback text[] not null default '{}',        -- the checklist the CEO confirmed
  diff jsonb not null,
  created_at timestamptz not null default now(),
  primary key (office_id, v)
);

-- ── work and conversation ──────────────────────────────────────────────────

create table public.tasks (
  office_id uuid not null references public.offices (id) on delete cascade,
  id text not null,
  title text not null,
  details text not null default '',
  definition_of_done text,
  room_id text,
  owner_id text,                                -- agent id
  created_by text not null,
  status text not null default 'queued'
    check (status in ('queued', 'ongoing', 'blocked', 'review', 'done')),
  progress int not null default 0 check (progress between 0 and 100),
  note text,
  outputs jsonb not null default '[]',          -- PRs, files
  linear_issue_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (office_id, id)
);

create table public.threads (
  office_id uuid not null references public.offices (id) on delete cascade,
  id text not null,
  kind text not null check (kind in ('message', 'huddle', 'meeting')),
  topic text not null,
  created_by text not null,
  participants text[] not null default '{}',
  state text not null default 'open' check (state in ('open', 'resolved', 'escalated')),
  parent_id text,
  depth int not null default 0,
  task_id text,
  escalation int not null default 0,
  sent int not null default 0,
  tokens bigint not null default 0,
  outcome text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (office_id, id)
);

create table public.messages (
  office_id uuid not null references public.offices (id) on delete cascade,
  id text not null,
  thread_id text not null,
  "from" text not null,
  "to" text not null,
  type text not null,
  urgency text not null default 'normal',
  body text not null,
  refs text[] not null default '{}',
  state text not null default 'queued' check (state in ('queued', 'delivered')),
  created_at timestamptz not null default now(),
  delivered_at timestamptz,
  primary key (office_id, id),
  foreign key (office_id, thread_id) references public.threads (office_id, id) on delete cascade
);

create table public.inbox_items (
  office_id uuid not null references public.offices (id) on delete cascade,
  id text not null,
  kind text not null,                           -- question, escalation, budget, approval, meeting, ...
  "from" text not null,
  thread_id text,
  title text not null,
  body text not null default '',
  priority int not null default 2,              -- set by Ada's triage; 1 highest
  state text not null default 'open' check (state in ('open', 'resolved', 'dismissed')),
  action jsonb,                                 -- what approving does (merge a PR, apply a diff)
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  primary key (office_id, id)
);

create table public.meetings (
  id uuid primary key default gen_random_uuid(),
  office_id uuid not null references public.offices (id) on delete cascade,
  title text not null,
  requested_by text not null,
  chair text not null default 'ada',
  attendees text[] not null default '{}',
  agenda jsonb not null default '[]',
  end_condition text,
  pre_read text,
  thread_id text,                               -- the transcript
  state text not null default 'requested'
    check (state in ('requested', 'scheduled', 'live', 'ended', 'declined')),
  starts_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.minutes (
  meeting_id uuid primary key references public.meetings (id) on delete cascade,
  office_id uuid not null references public.offices (id) on delete cascade,
  summary text not null,
  decisions jsonb not null default '[]',
  action_items jsonb not null default '[]',     -- [{text, owner, task_id, done}]
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ── memory ─────────────────────────────────────────────────────────────────

create table public.memory_items (
  id uuid primary key default gen_random_uuid(),
  office_id uuid not null references public.offices (id) on delete cascade,
  layer text not null check (layer in ('company', 'ceo', 'room', 'agent', 'conversation')),
  scope_id text not null default '',            -- room or agent id; '' for company and ceo
  type text not null,                           -- fact, decision, lesson, preference, agreement, summary, ...
  title text not null,
  body text not null,
  owner text not null,                          -- who approves changes: 'ceo', 'ada', a head's agent id
  status text not null default 'active' check (status in ('proposed', 'active', 'superseded', 'stale')),
  source jsonb not null default '{}',           -- thread, meeting, task it came from
  confidence real check (confidence between 0 and 1),
  rooms text[],                                 -- for ceo preferences: which rooms see it (null = all)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.memory_links (
  from_id uuid not null references public.memory_items (id) on delete cascade,
  to_id uuid not null references public.memory_items (id) on delete cascade,
  office_id uuid not null references public.offices (id) on delete cascade,
  kind text not null check (kind in ('distilled_from', 'derived_from', 'supersedes', 'relates', 'shared_with')),
  needs_refresh boolean not null default false, -- set when the source changes
  created_at timestamptz not null default now(),
  primary key (from_id, to_id, kind)
);

-- ── usage, audit, integrations, events ─────────────────────────────────────

create table public.usage_events (
  id bigint generated always as identity primary key,
  office_id uuid not null references public.offices (id) on delete cascade,
  agent_id text,                                -- null for Ada
  thread_id text,
  task_id text,
  model text not null,
  input_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  cache_read_tokens bigint not null default 0,
  cache_write_tokens bigint not null default 0,
  cost_usd numeric(12, 6) not null default 0,
  created_at timestamptz not null default now()
);

create table public.audit_log (
  id bigint generated always as identity primary key,
  office_id uuid not null references public.offices (id) on delete cascade,
  actor text not null,                          -- 'ceo', 'ada', 'agent:<id>', 'system'
  action text not null,
  target text,
  detail jsonb not null default '{}',
  created_at timestamptz not null default now()
);

-- Connected services. Secrets (OAuth tokens) are kept in Supabase Vault, by id.
create table public.integrations (
  id uuid primary key default gen_random_uuid(),
  office_id uuid not null references public.offices (id) on delete cascade,
  provider text not null check (provider in ('github', 'linear')),
  external_id text,                             -- GitHub installation id, Linear workspace id
  config jsonb not null default '{}',           -- repo, team, mappings
  secret_id uuid,                               -- vault.secrets id; never readable by browsers
  status text not null default 'connected' check (status in ('connected', 'error', 'disconnected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (office_id, provider)
);

-- The daemon's event stream, as stored. seq is the daemon's own sequence.
create table public.office_events (
  office_id uuid not null references public.offices (id) on delete cascade,
  seq bigint not null,
  type text not null,
  data jsonb not null default '{}',
  at timestamptz not null,
  primary key (office_id, seq)
);

-- ── indexes ────────────────────────────────────────────────────────────────

create index on public.agents (office_id, room_id);
create index on public.tasks (office_id, status);
create index on public.threads (office_id, updated_at desc);
create index on public.messages (office_id, thread_id, created_at);
create index on public.inbox_items (office_id, state, created_at desc);
create index on public.meetings (office_id, state);
create index on public.minutes (office_id);
create index on public.memory_items (office_id, layer, scope_id, status);
create index on public.memory_links (office_id);
create index on public.memory_links (to_id);
create index on public.usage_events (office_id, created_at desc);
create index on public.usage_events (office_id, agent_id);
create index on public.audit_log (office_id, created_at desc);
create index on public.locked_rules (office_id);

-- ── updated_at ─────────────────────────────────────────────────────────────

do $$
declare t text;
begin
  foreach t in array array['profiles', 'offices', 'rooms', 'agents', 'policies', 'locked_rules',
                           'tasks', 'threads', 'meetings', 'minutes', 'memory_items', 'integrations']
  loop
    execute format('create trigger touch_updated_at before update on public.%I
                    for each row execute function private.touch_updated_at()', t);
  end loop;
end $$;

-- ── row-level security ─────────────────────────────────────────────────────
-- Read-only for signed-in users, limited to their own office. No insert,
-- update or delete policies: browsers write nothing directly.

alter table public.profiles enable row level security;
create policy "read own profile" on public.profiles
  for select to authenticated using (id = (select auth.uid()));

alter table public.allowlist enable row level security;  -- service role only

alter table public.offices enable row level security;
create policy "read own office" on public.offices
  for select to authenticated using (owner_id = (select auth.uid()));

do $$
declare t text;
begin
  foreach t in array array['rooms', 'agents', 'policies', 'locked_rules', 'config_versions',
                           'tasks', 'threads', 'messages', 'inbox_items', 'meetings', 'minutes',
                           'memory_items', 'memory_links', 'usage_events', 'audit_log',
                           'integrations', 'office_events']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "read own office" on public.%I
                    for select to authenticated using (private.owns_office(office_id))', t);
  end loop;
end $$;

-- ── realtime ───────────────────────────────────────────────────────────────
-- Tables the office UI watches live (RLS applies to what each user receives).

alter publication supabase_realtime add table
  public.offices, public.rooms, public.agents, public.tasks, public.threads,
  public.messages, public.inbox_items, public.meetings, public.minutes,
  public.memory_items, public.office_events;
