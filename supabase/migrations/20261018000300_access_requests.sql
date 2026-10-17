-- People who signed in but aren't on the allowlist yet: admins see them and
-- let them in (or dismiss them) from /admin. Service role only, like errors.

create table public.access_requests (
  id bigint generated always as identity primary key,
  user_id uuid not null unique references auth.users (id) on delete cascade,
  github_login text,
  email text,
  name text,
  first_at timestamptz not null default now(),
  last_at timestamptz not null default now(),
  dismissed_at timestamptz
);
alter table public.access_requests enable row level security;  -- service role only (admins read through the API)
