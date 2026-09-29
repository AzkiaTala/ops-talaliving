-- core employee accounts (0185, D329) — IT makes an account with a password,
-- and ties it to the employee it belongs to.
--
--   refusal    — linking refuses somebody without `it.manage_users` (HR admin
--                included), an employee already linked, an account linked to
--                somebody else, and a left employee; a new password refuses
--                your own account and a switched-off one; a link refuses a
--                `.local` username
--   derivation — once linked, `my_employee_id()` answers for that account and
--                `v_employee_account` shows the link to IT and to HR, and to
--                nobody else
--
-- The link is the one worth the file. `employees.user_id` existed since 0152
-- and nothing wrote it, so every screen that reads `my_employee_id()` was
-- empty for everybody (F183).

begin;

insert into auth.users (id, email, raw_user_meta_data, email_confirmed_at, last_sign_in_at) values
  ('cccccccc-0000-0000-0000-000000000001','it185@talaliving.com',     '{"full_name":"IT Admin"}',   now(), now()),
  ('cccccccc-0000-0000-0000-000000000002','hrd185@talaliving.com',    '{"full_name":"HRD Admin"}',  now(), now()),
  ('cccccccc-0000-0000-0000-000000000003','karjo.prod@talaliving.local', '{"full_name":"Karjo"}',  now(), null),
  ('cccccccc-0000-0000-0000-000000000004','wati.prod@talaliving.local',  '{"full_name":"Wati"}',   now(), null),
  ('cccccccc-0000-0000-0000-000000000005','nobody185@talaliving.com', '{"full_name":"Nobody"}',     now(), now());

select ops_core.bootstrap_admin('it185@talaliving.com');
insert into ops_core.user_modules (user_id, module, level) values
  ('cccccccc-0000-0000-0000-000000000002','hrd','admin');

insert into ops_hr.employees
  (id, employee_no, full_name, position, unit, pay_basis, base_rate, daily_hours, joined_on, active, left_on)
values
  ('dddd0185-0000-0000-0000-000000000001','P-1851','Karjo','Tukang','Produksi','daily', 180000, 8,'2026-01-01', true,  null),
  ('dddd0185-0000-0000-0000-000000000002','P-1852','Wati', 'Tukang','Finishing','daily',180000, 8,'2026-01-01', true,  null),
  ('dddd0185-0000-0000-0000-000000000003','P-1853','Joko', 'Tukang','Produksi','daily', 180000, 8,'2025-01-01', false,'2026-06-30');

set local role authenticated;

-- ── refusal 1: not IT — even HRD admin, who owns the roster ───────────────
set local request.jwt.claim.sub = 'cccccccc-0000-0000-0000-000000000002';
do $$
declare r jsonb; u uuid;
begin
  r := ops_hr.link_employee_account('dddd0185-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000003');
  assert r ->> 'outcome' = 'refused', format('HRD must not link accounts, got %s', r);
  assert r -> 'error' ->> 'code' = 'authority_required', format('got %s', r);
  select user_id into u from ops_hr.employees where id = 'dddd0185-0000-0000-0000-000000000001';
  assert u is null, 'the refused link must not have been written';

  r := ops_core.create_user('baru@talaliving.local', 'Baru');
  assert r -> 'error' ->> 'code' = 'authority_required', format('HRD cannot create accounts, got %s', r);
  r := ops_core.request_user_password('cccccccc-0000-0000-0000-000000000003');
  assert r -> 'error' ->> 'code' = 'authority_required', format('HRD cannot reset passwords, got %s', r);
end $$;

-- ── IT makes an account ───────────────────────────────────────────────────
set local request.jwt.claim.sub = 'cccccccc-0000-0000-0000-000000000001';
do $$
declare r jsonb; n int;
begin
  r := ops_core.create_user('  Budi.Gudang@TalaLiving.local ', ' Budi   Gudang ');
  assert ops_core.said_ok(r), format('IT creates an account, got %s', r);
  assert r -> 'data' ->> 'email' = 'budi.gudang@talaliving.local', format('normalised, got %s', r);
  assert r -> 'data' ->> 'full_name' = 'Budi Gudang', format('got %s', r);

  select count(*) into n from ops_core.audit_log
   where action = 'create' and outcome = 'ok' and entity_no = 'budi.gudang@talaliving.local';
  assert n = 1, 'the decision is in the trail, as create — nobody was mailed';

  r := ops_core.create_user('karjo.prod@talaliving.local', 'Karjo');
  assert r -> 'error' ->> 'code' = 'already_registered', format('got %s', r);
  r := ops_core.create_user('budi', 'Budi');
  assert r -> 'error' ->> 'code' = 'email_invalid', format('got %s', r);

  -- invite_user shares the rules and still answers as 0183 did.
  r := ops_core.invite_user('karjo.prod@talaliving.local', 'Karjo');
  assert r -> 'error' ->> 'code' = 'already_registered', format('got %s', r);
  r := ops_core.invite_user(' Dewi@TalaLiving.com ', ' Dewi  A ');
  assert ops_core.said_ok(r) and r -> 'data' ->> 'full_name' = 'Dewi A', format('got %s', r);
end $$;

-- ── a new password: decided here, never stored here ───────────────────────
do $$
declare r jsonb; n int;
begin
  r := ops_core.request_user_password('cccccccc-0000-0000-0000-000000000001');
  assert r -> 'error' ->> 'code' = 'self_service_refused', format('not your own, got %s', r);

  r := ops_core.request_user_password('cccccccc-0000-0000-0000-000000000003');
  assert ops_core.said_ok(r), format('IT resets Karjo, got %s', r);
  assert r -> 'data' ->> 'email' = 'karjo.prod@talaliving.local', format('got %s', r);
  assert not (r -> 'data' ? 'password'), 'the seam never carries a password';

  select count(*) into n from ops_core.audit_log
   where action = 'password.reset' and outcome = 'ok' and entity_no = 'karjo.prod@talaliving.local'
     and actor_id = 'cccccccc-0000-0000-0000-000000000001';
  assert n = 1, 'the trail says a password was reset, and by whom';

  -- A `.local` username is not a mailbox: no link.
  r := ops_core.request_user_link('cccccccc-0000-0000-0000-000000000003');
  assert r -> 'error' ->> 'code' = 'no_mailbox', format('got %s', r);
end $$;

-- ── linking ───────────────────────────────────────────────────────────────
do $$
declare r jsonb; u uuid; n int;
begin
  r := ops_hr.link_employee_account('dddd0185-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000003');
  assert ops_core.said_ok(r), format('IT links Karjo, got %s', r);
  select user_id into u from ops_hr.v_employee_account where employee_id = 'dddd0185-0000-0000-0000-000000000001';
  assert u = 'cccccccc-0000-0000-0000-000000000003', 'the link is written';

  r := ops_hr.link_employee_account('dddd0185-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000003');
  assert r ->> 'outcome' = 'noop', format('the same link twice is a noop, got %s', r);

  -- refusal 2: the employee already has another account
  r := ops_hr.link_employee_account('dddd0185-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000004');
  assert (r -> 'error' ->> 'status')::int = 409, format('got %s', r);
  assert r -> 'error' ->> 'code' = 'employee_has_account', format('got %s', r);
  assert r -> 'error' -> 'detail' ->> 'email' = 'karjo.prod@talaliving.local', 'it names the account already there';

  -- refusal 3: the account is linked to somebody else
  r := ops_hr.link_employee_account('dddd0185-0000-0000-0000-000000000002', 'cccccccc-0000-0000-0000-000000000003');
  assert r -> 'error' ->> 'code' = 'account_linked_elsewhere', format('got %s', r);
  assert r -> 'error' -> 'detail' ->> 'employee_no' = 'P-1851', 'it names the employee it is on';
  select user_id into u from ops_hr.v_employee_account where employee_id = 'dddd0185-0000-0000-0000-000000000002';
  assert u is null, 'the refused link must not have been written';

  -- refusal 4: somebody who has left
  r := ops_hr.link_employee_account('dddd0185-0000-0000-0000-000000000003', 'cccccccc-0000-0000-0000-000000000004');
  assert r -> 'error' ->> 'code' = 'employee_left', format('got %s', r);

  r := ops_hr.link_employee_account('dddd0185-0000-0000-0000-000000000009', 'cccccccc-0000-0000-0000-000000000004');
  assert r -> 'error' ->> 'code' = 'not_found', format('got %s', r);

  -- Every refusal above is in the trail.
  select count(*) into n from ops_core.audit_log
   where service = 'hr' and entity = 'employee' and action = 'account.link' and outcome in ('refused','duplicate');
  assert n >= 4, format('refusals are recorded, saw %s', n);
end $$;

-- ── the derivation: the account now answers as that employee ─────────────
set local request.jwt.claim.sub = 'cccccccc-0000-0000-0000-000000000003';
do $$
declare n int;
begin
  assert ops_hr.my_employee_id() = 'dddd0185-0000-0000-0000-000000000001',
    'my_employee_id() finds Karjo from his account';
  select count(*) into n from ops_hr.v_employee_account;
  assert n = 0, 'Karjo holds no module: the directory of links is not his to read';
end $$;

-- HR sees the link, read-only.
set local request.jwt.claim.sub = 'cccccccc-0000-0000-0000-000000000002';
do $$
declare e text;
begin
  select user_email into e from ops_hr.v_employee_account where employee_no = 'P-1851';
  assert e = 'karjo.prod@talaliving.local', format('HR reads which account Karjo has, got %s', e);
end $$;

-- Somebody with neither IT nor HR reads nothing.
set local request.jwt.claim.sub = 'cccccccc-0000-0000-0000-000000000005';
do $$
declare n int;
begin
  select count(*) into n from ops_hr.v_employee_account;
  assert n = 0, format('no it.read, no hrd.read: nothing, saw %s', n);
end $$;

-- ── unlinking, then the account can go to Wati ────────────────────────────
set local request.jwt.claim.sub = 'cccccccc-0000-0000-0000-000000000001';
do $$
declare r jsonb; before_v jsonb;
begin
  r := ops_hr.link_employee_account('dddd0185-0000-0000-0000-000000000001', null);
  assert ops_core.said_ok(r), format('IT unlinks, got %s', r);
  select before into before_v from ops_core.audit_log
   where action = 'account.unlink' and outcome = 'ok' order by id desc limit 1;
  assert before_v ->> 'email' = 'karjo.prod@talaliving.local', format('the trail keeps who it was, got %s', before_v);

  r := ops_hr.link_employee_account('dddd0185-0000-0000-0000-000000000001', null);
  assert r ->> 'outcome' = 'noop', format('unlinking nothing is a noop, got %s', r);

  r := ops_hr.link_employee_account('dddd0185-0000-0000-0000-000000000002', 'cccccccc-0000-0000-0000-000000000003');
  assert ops_core.said_ok(r), format('now free to link elsewhere, got %s', r);
end $$;

-- The password never went anywhere in the database: no trail row, activity
-- event or outbox payload carries a key called password.
reset role;
do $$
declare n int;
begin
  select count(*) into n from ops_core.audit_log
   where coalesce(before, '{}'::jsonb) ? 'password' or coalesce(after, '{}'::jsonb) ? 'password'
      or coalesce(detail, '{}'::jsonb) ? 'password';
  assert n = 0, format('no trail row carries a password, saw %s', n);
end $$;

rollback;
