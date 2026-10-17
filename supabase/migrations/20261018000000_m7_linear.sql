-- M7: Linear. Each office task has a Linear issue in the office's team (and
-- project); agents' own tickets are issues without a task. Written by the API
-- only; the office's browser reads its own rows.

create table public.linear_issues (
  office_id uuid not null references public.offices (id) on delete cascade,
  issue_id text not null,                       -- Linear's issue id
  identifier text not null,                     -- ENG-12
  url text not null,
  task_id text,                                 -- the office task it mirrors (null: an agent's own ticket)
  -- What the office last pushed (title, state, labels...), so changes Linear
  -- reports back that we made ourselves are recognised and skipped.
  synced jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (office_id, issue_id)
);
create unique index linear_issues_task on public.linear_issues (office_id, task_id) where task_id is not null;
create index linear_issues_identifier on public.linear_issues (office_id, identifier);

alter table public.linear_issues enable row level security;
create policy "read own office" on public.linear_issues for select to authenticated using (private.owns_office(office_id));
alter publication supabase_realtime add table public.linear_issues;
