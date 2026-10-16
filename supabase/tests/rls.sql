-- Row-level security check. Creates two users with an office each, checks
-- what each can see, then raises to roll everything back. Success is the
-- error "rls ok". Run with: npm run db:check
do $$
declare
  a uuid := gen_random_uuid();
  b uuid := gen_random_uuid();
  oa uuid; ob uuid; n int; failed boolean;
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data)
  values (a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a@rls.test', '{"user_name":"alice"}'),
         (b, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'b@rls.test', '{"user_name":"bob"}');
  assert (select github_login from public.profiles where id = a) = 'alice', 'profile created from GitHub identity';

  insert into public.offices (owner_id, name) values (a, 'A') returning id into oa;
  insert into public.offices (owner_id, name) values (b, 'B') returning id into ob;
  insert into private.office_tokens values (oa, 'x'), (ob, 'y');
  insert into public.rooms (office_id, id, name) values (oa, 'dev', 'Dev'), (ob, 'dev', 'Dev');
  insert into public.agents (office_id, id, room_id, name, role) values (oa, 'fe', 'dev', 'Fe', 'head'), (ob, 'fe', 'dev', 'Fe', 'head');
  insert into public.threads (office_id, id, kind, topic, created_by) values (oa, 't1', 'message', 'x', 'fe'), (ob, 't1', 'message', 'y', 'fe');
  insert into public.messages (office_id, id, thread_id, "from", "to", type, body) values (oa, 'm1', 't1', 'fe', 'ceo', 'ask', 'a?'), (ob, 'm1', 't1', 'fe', 'ceo', 'ask', 'b?');
  insert into public.memory_items (office_id, layer, type, title, body, owner) values (oa, 'company', 'fact', 't', 'b', 'ada'), (ob, 'company', 'fact', 't', 'b', 'ada');

  -- as user A
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.offices;       assert n = 1, 'A sees one office, got ' || n;
  assert (select id from public.offices) = oa, 'A sees their own office';
  select count(*) into n from public.agents;        assert n = 1, 'A sees one agent, got ' || n;
  select count(*) into n from public.messages;      assert n = 1, 'A sees one message, got ' || n;
  assert (select body from public.messages) = 'a?', 'A sees their own message';
  select count(*) into n from public.memory_items;  assert n = 1, 'A sees one memory item';
  select count(*) into n from public.profiles;      assert n = 1, 'A sees only their profile';
  select count(*) into n from public.allowlist;     assert n = 0, 'allowlist hidden';

  failed := false;
  begin select count(*) into n from private.office_tokens; exception when insufficient_privilege then failed := true; end;
  assert failed, 'office tokens unreadable';

  failed := false;
  begin insert into public.rooms (office_id, id, name) values (oa, 'x', 'X'); exception when insufficient_privilege then failed := true; end;
  assert failed, 'browser cannot insert';
  update public.agents set name = 'hacked';
  get diagnostics n = row_count;                    assert n = 0, 'browser cannot update';

  -- as anonymous
  execute 'reset role';
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  execute 'set local role anon';
  select count(*) into n from public.offices;       assert n = 0, 'anon sees no office';
  select count(*) into n from public.messages;      assert n = 0, 'anon sees no message';

  raise exception 'rls ok';
end $$;
