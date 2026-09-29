-- core user admin (0183, D325) — IT manages people, and switching one off
-- actually takes their access away.
--
--   refusal    — `set_user_active` refuses your own account, and every seam
--                refuses somebody without `it.manage_users`
--   derivation — an inactive account's `has_permission`, `has_authority` and
--                expanded `permissions` are all empty while its grants are
--                kept; `v_user_access.status` reads GoTrue's timestamps
--
-- The derivation is the one worth the file. Before `0183`, `is_active` was a
-- column nothing read: an account marked inactive kept every grant, including
-- `approve_funds`, and the screen's *nonaktif* badge described a lock that
-- did not exist.

begin;

insert into auth.users (id, email, raw_user_meta_data, email_confirmed_at, last_sign_in_at, invited_at) values
  ('bbbbbbbb-0000-0000-0000-000000000001','it@talaliving.com',   '{"full_name":"IT Admin"}',      now(), now(), null),
  ('bbbbbbbb-0000-0000-0000-000000000002','budi@talaliving.com', '{"full_name":"Budi Santoso"}',  now(), now(), null),
  -- Invited on Monday, never came: no confirmation, no sign-in.
  ('bbbbbbbb-0000-0000-0000-000000000003','sari@talaliving.com', '{"full_name":"Sari Dewi"}',     null,  null,  now() - interval '2 days');

select ops_core.bootstrap_admin('it@talaliving.com');

set local role authenticated;
set local request.jwt.claim.sub = 'bbbbbbbb-0000-0000-0000-000000000001';

do $$
declare r jsonb;
begin
  r := ops_core.set_modules('bbbbbbbb-0000-0000-0000-000000000002',
    '[{"module":"procurement","level":"write"},{"module":"dashboard","level":"read"}]'::jsonb);
  assert ops_core.said_ok(r), format('grant for the fixture, got %s', r);
  r := ops_core.set_authorities('bbbbbbbb-0000-0000-0000-000000000002', array['approve_goods','approve_funds']);
  assert ops_core.said_ok(r), format('grant for the fixture, got %s', r);
end $$;

-- ── the directory reads GoTrue's record ───────────────────────────────────
do $$
declare s text; b boolean;
begin
  select status into s from ops_core.v_user_access where email = 'budi@talaliving.com';
  assert s = 'active', format('Budi has signed in — active, got %s', s);

  select status, sign_in_blocked into s, b from ops_core.v_user_access where email = 'sari@talaliving.com';
  assert s = 'pending', format('Sari was invited and never came — pending, got %s', s);
  assert b = false, 'nobody has blocked Sari';
end $$;

-- ── refusal 1: never your own account ─────────────────────────────────────
do $$
declare r jsonb; still boolean;
begin
  r := ops_core.set_user_active('bbbbbbbb-0000-0000-0000-000000000001', false, 'test');
  assert r ->> 'outcome' = 'refused', format('switching yourself off must refuse, got %s', r);
  assert r -> 'error' ->> 'code' = 'self_service_refused', format('got %s', r);
  select is_active into still from ops_core.users where id = 'bbbbbbbb-0000-0000-0000-000000000001';
  assert still, 'the refused change must not have been written';
end $$;

-- ── correcting a name ─────────────────────────────────────────────────────
do $$
declare r jsonb; n text; before_v jsonb;
begin
  r := ops_core.update_user('bbbbbbbb-0000-0000-0000-000000000002', '  Budi   Santoso  S.  ');
  assert ops_core.said_ok(r), format('IT corrects a name, got %s', r);
  select full_name into n from ops_core.users where id = 'bbbbbbbb-0000-0000-0000-000000000002';
  assert n = 'Budi Santoso S.', format('the name is tidied, not kept with its spaces: %s', n);

  select before into before_v from ops_core.audit_log
   where action = 'profile.update' and outcome = 'ok' order by id desc limit 1;
  assert before_v ->> 'full_name' = 'Budi Santoso', format('the trail keeps the old name, got %s', before_v);

  r := ops_core.update_user('bbbbbbbb-0000-0000-0000-000000000002', 'Budi Santoso S.');
  assert r ->> 'outcome' = 'noop', format('the same name twice is a noop, got %s', r);

  r := ops_core.update_user('bbbbbbbb-0000-0000-0000-000000000002', '   ');
  assert (r -> 'error' ->> 'status')::int = 422, format('a blank name is invalid, got %s', r);
  assert r -> 'error' ->> 'code' = 'name_required', format('got %s', r);
end $$;

-- ── switching Budi off ────────────────────────────────────────────────────
do $$
declare r jsonb; reason_v text;
begin
  r := ops_core.set_user_active('bbbbbbbb-0000-0000-0000-000000000002', false, 'resign');
  assert ops_core.said_ok(r), format('IT switches an account off, got %s', r);

  select after ->> 'reason' into reason_v from ops_core.audit_log
   where action = 'user.deactivate' and outcome = 'ok' order by id desc limit 1;
  assert reason_v = 'resign', format('the reason is in the trail, got %s', reason_v);

  r := ops_core.set_user_active('bbbbbbbb-0000-0000-0000-000000000002', false);
  assert r ->> 'outcome' = 'noop', format('switching off twice is a noop, got %s', r);
end $$;

-- The derivation: as Budi, nothing answers yes — and his grants are still
-- there to be given back.
set local request.jwt.claim.sub = 'bbbbbbbb-0000-0000-0000-000000000002';
do $$
declare p jsonb; m jsonb; n int;
begin
  assert not ops_core.has_permission('procurement.read'),
    'an inactive account must hold no permission';
  assert not ops_core.has_authority('approve_funds'),
    'an inactive account must hold no authority — this is the signature on money';

  select permissions, modules into p, m from ops_core.v_my_access;
  assert p = '[]'::jsonb, format('can() must agree with has_permission, saw %s', p);
  assert jsonb_array_length(m) = 2, format('the grants are kept, saw %s', m);

  select count(*) into n from ops_core.approvers() where email = 'budi@talaliving.com';
  assert n = 0, 'nobody may be asked to approve by an inactive account';

  perform ops_core.record_sign_in();
end $$;

set local request.jwt.claim.sub = 'bbbbbbbb-0000-0000-0000-000000000001';
do $$
declare n int; s text; p jsonb;
begin
  select count(*) into n from ops_core.audit_log
   where action = 'sign_in' and outcome = 'refused' and entity_no = 'budi@talaliving.com';
  assert n = 1, format('a sign-in by an inactive account is recorded as refused, saw %s', n);

  select status, permissions into s, p from ops_core.v_user_access where email = 'budi@talaliving.com';
  assert s = 'inactive', format('got %s', s);
  assert p = '[]'::jsonb, format('the directory expands nothing for him either, saw %s', p);
end $$;

-- A link into an account that holds nothing is refused.
do $$
declare r jsonb;
begin
  r := ops_core.request_user_link('bbbbbbbb-0000-0000-0000-000000000002');
  assert r -> 'error' ->> 'code' = 'user_inactive', format('got %s', r);
end $$;

-- Switched back on: everything he held, back.
do $$
declare r jsonb;
begin
  r := ops_core.set_user_active('bbbbbbbb-0000-0000-0000-000000000002', true);
  assert ops_core.said_ok(r), format('IT switches an account back on, got %s', r);
end $$;
set local request.jwt.claim.sub = 'bbbbbbbb-0000-0000-0000-000000000002';
do $$
begin
  assert ops_core.has_permission('procurement.create'), 'reactivated: the write grant is back';
  assert ops_core.has_authority('approve_funds'), 'reactivated: the authority is back';
end $$;

-- ── inviting ──────────────────────────────────────────────────────────────
set local request.jwt.claim.sub = 'bbbbbbbb-0000-0000-0000-000000000001';
do $$
declare r jsonb; n int;
begin
  r := ops_core.invite_user('not-an-address', 'Somebody');
  assert r -> 'error' ->> 'code' = 'email_invalid', format('got %s', r);

  r := ops_core.invite_user('dewi@talaliving.com', '');
  assert r -> 'error' ->> 'code' = 'name_required', format('got %s', r);

  r := ops_core.invite_user('  BUDI@talaliving.com ', 'Budi Lagi');
  assert (r -> 'error' ->> 'status')::int = 409, format('an address already here is a conflict, got %s', r);
  assert r -> 'error' ->> 'code' = 'already_registered', format('got %s', r);
  assert (r -> 'error' -> 'detail' ->> 'is_active')::boolean, 'and it says whether that account is on';

  r := ops_core.invite_user(' Dewi@TalaLiving.com ', ' Dewi  Anggraini ');
  assert ops_core.said_ok(r), format('IT invites a new address, got %s', r);
  assert r -> 'data' ->> 'email' = 'dewi@talaliving.com', format('the address is normalised, got %s', r);
  assert r -> 'data' ->> 'full_name' = 'Dewi Anggraini', format('got %s', r);

  -- The decision writes the trail and nothing else: the profile is
  -- provision_user's, when GoTrue creates the account.
  select count(*) into n from ops_core.users where email = 'dewi@talaliving.com';
  assert n = 0, 'invite_user must not create a profile by itself';
  select count(*) into n from ops_core.audit_log
   where action = 'invite' and outcome = 'ok' and entity_no = 'dewi@talaliving.com';
  assert n = 1, 'the decision is in the trail';
end $$;

-- Which link: the invitation again for Sari (never confirmed), a recovery
-- link for Budi (confirmed).
do $$
declare r jsonb;
begin
  r := ops_core.request_user_link('bbbbbbbb-0000-0000-0000-000000000003');
  assert ops_core.said_ok(r), format('got %s', r);
  assert r -> 'data' ->> 'kind' = 'invite', format('unconfirmed → invite again, got %s', r);

  r := ops_core.request_user_link('bbbbbbbb-0000-0000-0000-000000000002');
  assert r -> 'data' ->> 'kind' = 'recovery', format('confirmed → recovery, got %s', r);
end $$;

-- ── refusal 2: it.manage_users or nothing ─────────────────────────────────
-- Budi holds procurement write and approve_funds. None of it reaches people.
set local request.jwt.claim.sub = 'bbbbbbbb-0000-0000-0000-000000000002';
do $$
declare r jsonb;
begin
  r := ops_core.set_user_active('bbbbbbbb-0000-0000-0000-000000000003', false);
  assert r -> 'error' ->> 'code' = 'authority_required', format('got %s', r);
  r := ops_core.update_user('bbbbbbbb-0000-0000-0000-000000000003', 'Sari X');
  assert r -> 'error' ->> 'code' = 'authority_required', format('got %s', r);
  r := ops_core.invite_user('eka@talaliving.com', 'Eka');
  assert r -> 'error' ->> 'code' = 'authority_required', format('got %s', r);
  r := ops_core.request_user_link('bbbbbbbb-0000-0000-0000-000000000003');
  assert r -> 'error' ->> 'code' = 'authority_required', format('got %s', r);
end $$;

do $$
declare n int;
begin
  -- And the directory stays closed to him: `v_user_access` is `it.read`.
  select count(*) into n from ops_core.v_user_access;
  assert n = 0, format('the directory is it.read, Budi saw %s rows', n);
end $$;

reset role;
reset request.jwt.claim.sub;

rollback;
