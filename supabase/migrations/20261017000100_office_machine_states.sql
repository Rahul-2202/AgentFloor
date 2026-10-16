-- Office VM states for the UI: VMs pause (memory kept) rather than stop.
alter table public.offices drop constraint offices_sandbox_state_check;
alter table public.offices add constraint offices_sandbox_state_check
  check (sandbox_state in ('none', 'creating', 'starting', 'started', 'pausing', 'paused', 'stopped', 'archived', 'error'));
alter table public.offices add column sandbox_error text;
