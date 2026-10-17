-- M8: internal launch. Who may sign in (and who runs the place), errors from
-- every part of the system, and how long office machines run.

-- ── the allowlist: enforced by the API on every call ──────────────────────
alter table public.allowlist add column admin boolean not null default false;
insert into public.allowlist (github_login, note, admin) values ('Rahul-2202', 'Founder', true)
  on conflict (github_login) do update set admin = true;

-- ── errors: web app, API and offices, grouped by fingerprint ──────────────
create table public.errors (
  id bigint generated always as identity primary key,
  fingerprint text not null unique,             -- source + a normalised message
  source text not null check (source in ('web', 'api', 'office')),
  office_id uuid references public.offices (id) on delete set null,
  message text not null,
  stack text,
  context jsonb not null default '{}',
  count int not null default 1,
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now()
);
create index errors_last_seen on public.errors (last_seen desc);
alter table public.errors enable row level security;  -- service role only (admins read through the API)

-- Counts another occurrence (or records the first), atomically.
create or replace function public.record_error(fp text, src text, oid uuid, msg text, stk text, ctx jsonb)
returns void language sql security definer set search_path = '' as $$
  insert into public.errors (fingerprint, source, office_id, message, stack, context)
  values (fp, src, oid, left(msg, 2000), left(stk, 8000), coalesce(ctx, '{}'))
  on conflict (fingerprint) do update
    set count = public.errors.count + 1, last_seen = now(), stack = coalesce(excluded.stack, public.errors.stack),
        context = excluded.context, office_id = coalesce(excluded.office_id, public.errors.office_id)
$$;
revoke execute on function public.record_error(text, text, uuid, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.record_error(text, text, uuid, text, text, jsonb) to service_role;

-- ── machine runs: when each office machine was on (for cost) ──────────────
create table public.machine_runs (
  id bigint generated always as identity primary key,
  office_id uuid not null references public.offices (id) on delete cascade,
  sandbox_id text not null,
  started_at timestamptz not null default now(),
  stopped_at timestamptz
);
create index machine_runs_office on public.machine_runs (office_id, started_at desc);
create unique index machine_runs_one_open on public.machine_runs (office_id) where stopped_at is null;
alter table public.machine_runs enable row level security;
create policy "read own office" on public.machine_runs for select to authenticated using (private.owns_office(office_id));

-- ── backups: nightly memory exports (private bucket, service role only) ───
insert into storage.buckets (id, name, public) values ('backups', 'backups', false) on conflict (id) do nothing;
