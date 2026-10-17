-- Projected audit entries upsert on (office_id, seq). A partial unique index
-- (where seq is not null) can't be used by ON CONFLICT without repeating its
-- predicate, so every projection batch with an audit entry failed. A plain
-- unique index works the same way: rows without a seq (the API's own audit
-- entries) never conflict, since NULLs are distinct.
drop index if exists public.audit_log_office_seq;
create unique index audit_log_office_seq on public.audit_log (office_id, seq);
