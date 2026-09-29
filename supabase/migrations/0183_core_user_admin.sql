-- 0183_core_user_admin.sql — IT manages people, not only what they may open
-- (D325).
--
-- ── What the owner asked ──────────────────────────────────────────────────
--
-- *tambahkan modul user management untuk it* (2026-09-29).
--
-- `/it/pengguna` already granted modules and authorities. What it could not do
-- was the rest of a person's account: add one, correct a name, switch one off
-- when somebody leaves, or send a link to set a password. `06-auth.md` said
-- creating accounts was deliberately manual — *inviting a person is a decision
-- about a person, and it stays with whoever is allowed to make it*. The person
-- allowed to make it is IT, holding `it.manage_users`; this migration is where
-- that decision is made and recorded, so the screen can offer it.
--
-- ── What this adds ────────────────────────────────────────────────────────
--
-- 1. **An inactive account holds nothing.** `has_permission` and
--    `has_authority` now ask whether the person is active. Until today
--    `users.is_active` existed and nothing read it: an account marked inactive
--    kept every grant it had, so *nonaktif* on the screen was a label and not
--    a control. The grants themselves are kept, not deleted — reactivating
--    somebody gives them back exactly what they held, and the history stays
--    in `user_modules` rather than only in the trail.
-- 2. `v_my_access` and `v_user_access` expand **no permissions** for an
--    inactive account, so the frontend's `can()` and the database's
--    `has_permission()` still give the same answer (the rule `0007` states).
-- 3. `v_user_access` gains the account's life from GoTrue: when it was
--    invited, whether it has ever signed in, when it last did, whether its
--    sign-in is blocked — and a derived `status` (`active`, `pending`,
--    `inactive`). Derived on read, never stored (A3).
-- 4. Four seams, all behind `it.manage_users`:
--      `update_user`        correct a name
--      `set_user_active`    switch an account off or back on — never your own
--      `invite_user`        the decision to invite an address
--      `request_user_link`  the decision to send somebody a password link
--    The last two decide and record; the mail itself is sent by
--    `/api/identity/users`, because only GoTrue can create an account and only
--    a server holding the service role key can ask it to. **The database
--    decides first, as the person asking**, and the server acts only on a yes
--    — the same two identities the upload route uses for Drive (D325).
-- 5. `record_sign_in` records a sign-in by an inactive account as refused.
--
-- ── What this deliberately does not do ────────────────────────────────────
--
-- No delete. A person's name is on approvals, payslips and receipts, and
-- `users.id` is referenced from all of them (A5). Switching an account off is
-- how somebody leaves.
--
-- No *last administrator* refusal on `set_user_active`. It would never fire:
-- the caller must hold `it.manage_users` (admin on `it`) and be active, and
-- may not switch off themselves — so whenever an administrator is switched
-- off, the caller is another active one. The self refusal is what carries it.

-- ── 1. an inactive account holds nothing ──────────────────────────────────
--
-- One join, on the primary key, and `0154` already has every policy call this
-- once per statement rather than once per row. The cost is one index probe
-- per query.
create or replace function ops_core.has_permission(code text)
returns boolean
language sql stable security definer set search_path = ops_core, pg_temp as $$
  select exists (
    select 1
      from ops_core.user_modules g
      join ops_core.users u on u.id = g.user_id and u.is_active
      join ops_core.permission_catalog c on c.module = g.module
     where g.user_id = auth.uid()
       and g.module::text = split_part(code, '.', 1)
       and c.action     = split_part(code, '.', 2)
       and (
            c.action = 'read'
         or (c.admin_only and g.level = 'admin')
         or (not c.admin_only and g.level in ('write','admin'))
       )
  )
$$;

-- An authority is the signature on money. An account switched off because
-- somebody left must stop being able to give it the same minute, not when
-- somebody remembers to untick `approve_funds` as well.
create or replace function ops_core.has_authority(a ops_core.authority_t)
returns boolean
language sql stable security definer set search_path = ops_core, pg_temp as $$
  select exists (
    select 1 from ops_core.user_authorities ua
      join ops_core.users u on u.id = ua.user_id and u.is_active
     where ua.user_id = auth.uid() and ua.authority = a
  )
$$;

-- ── 2. the two access views agree with the function again ────────────────
--
-- Same columns, same order: only the permission expansion learns about
-- `is_active`. Modules and authorities are still listed, because they are
-- still held — the no-access screen reads `is_active` to say *switched off*
-- rather than *nothing granted yet*, and those two need different people.
create or replace view ops_core.v_my_access
  with (security_invoker = off) as
  select u.id, u.email, u.full_name, u.is_active,
         (select coalesce(jsonb_agg(jsonb_build_object('module', g.module, 'level', g.level)), '[]'::jsonb)
            from ops_core.user_modules g where g.user_id = u.id) as modules,
         (select coalesce(jsonb_agg(ua.authority), '[]'::jsonb)
            from ops_core.user_authorities ua where ua.user_id = u.id) as authorities,
         (select coalesce(jsonb_agg(distinct g.module || '.' || c.action), '[]'::jsonb)
            from ops_core.user_modules g
            join ops_core.permission_catalog c on c.module = g.module
           where g.user_id = u.id
             and u.is_active
             and (c.action = 'read'
                  or (c.admin_only and g.level = 'admin')
                  or (not c.admin_only and g.level in ('write','admin')))) as permissions
    from ops_core.users u
   where u.id = auth.uid();

-- ── 3. the directory, with the account's life in it ──────────────────────
--
-- Appended columns only — `create or replace view` cannot reorder, and the
-- eight `0007` defined are read by three screens.
--
-- `status` is three answers to the question IT actually asks of a row:
--
--   inactive  switched off here; holds nothing
--   pending   never signed in — invited and not arrived, or made by hand and
--             never used. Either way the next step is a link, not a grant.
--   active    everybody else
--
-- `sign_in_blocked` is GoTrue's ban, read rather than assumed. An account can
-- be inactive here and still able to sign in — the server had no key the day
-- it was switched off — and the screen says so instead of implying a lock
-- that is not there.
create or replace view ops_core.v_user_access
  with (security_invoker = off) as
  select u.id, u.email, u.full_name, u.is_active, u.left_on,
         (select coalesce(jsonb_agg(jsonb_build_object('module', g.module, 'level', g.level) order by g.module), '[]'::jsonb)
            from ops_core.user_modules g where g.user_id = u.id) as modules,
         (select coalesce(jsonb_agg(ua.authority order by ua.authority), '[]'::jsonb)
            from ops_core.user_authorities ua where ua.user_id = u.id) as authorities,
         (select coalesce(jsonb_agg(distinct g.module || '.' || c.action), '[]'::jsonb)
            from ops_core.user_modules g
            join ops_core.permission_catalog c on c.module = g.module
           where g.user_id = u.id
             and u.is_active
             and (c.action = 'read'
                  or (c.admin_only and g.level = 'admin')
                  or (not c.admin_only and g.level in ('write','admin')))) as permissions,
         u.created_at,
         a.invited_at,
         a.last_sign_in_at,
         coalesce(a.banned_until > now(), false) as sign_in_blocked,
         case
           when not u.is_active then 'inactive'
           when a.last_sign_in_at is null then 'pending'
           else 'active'
         end as status
    from ops_core.users u
    left join auth.users a on a.id = u.id
   where ops_core.has_permission('it.read');

-- ── 4. the seams ──────────────────────────────────────────────────────────

-- A name is what every approval trail prints. Correcting it is IT's, and the
-- trail keeps the old one.
create or replace function ops_core.update_user(p_user_id uuid, p_full_name text)
returns jsonb
language plpgsql security definer set search_path = ops_core, pg_temp as $$
declare
  v_target ops_core.users;
  v_name   text := btrim(regexp_replace(coalesce(p_full_name, ''), '\s+', ' ', 'g'));
begin
  if not ops_core.has_permission('it.manage_users') then
    return ops_core.refused('identity','user', p_user_id::text, 'profile.update',
      'authority_required',
      'Changing somebody''s account belongs to IT — logged, not applied.',
      jsonb_build_object('required','it.manage_users'));
  end if;

  select * into v_target from ops_core.users where id = p_user_id;
  if not found then
    return ops_core.not_found('identity','user', p_user_id::text, 'profile.update',
      'No such user.');
  end if;

  if v_name = '' then
    return ops_core.invalid('identity','user', v_target.email, 'profile.update',
      'name_required', 'A name is required — it is what every approval and payslip shows.',
      jsonb_build_object('field','full_name'));
  end if;
  if length(v_name) > 120 then
    return ops_core.invalid('identity','user', v_target.email, 'profile.update',
      'name_too_long', 'A name is at most 120 characters.',
      jsonb_build_object('field','full_name', 'max', 120));
  end if;

  if v_name = v_target.full_name then
    return ops_core.noop('identity','user', v_target.email, 'profile.update',
      'The name is already that.', jsonb_build_object('user_id', p_user_id));
  end if;

  update ops_core.users set full_name = v_name where id = p_user_id;

  return ops_core.ok('identity','user', v_target.email, 'profile.update',
    jsonb_build_object('user_id', p_user_id, 'full_name', v_name),
    jsonb_build_object('full_name', v_target.full_name),
    jsonb_build_object('full_name', v_name));
end $$;

-- Switching an account off, and back on.
--
-- **Never your own.** Not because it escalates anything — it does the
-- opposite — but because the one person who could undo it is then the person
-- who can no longer sign in to do so. The refusal names who can.
--
-- The reason is optional and goes into the trail: *resign*, *kontrak selesai*,
-- *akun ganda*. The screen asks for it; the database does not insist, because
-- no rule about it has been set (D325).
create or replace function ops_core.set_user_active(
  p_user_id uuid, p_active boolean, p_reason text default null)
returns jsonb
language plpgsql security definer set search_path = ops_core, pg_temp as $$
declare
  v_target ops_core.users;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_action text := case when p_active then 'user.reactivate' else 'user.deactivate' end;
begin
  if p_active is null then
    return ops_core.invalid('identity','user', p_user_id::text, 'user.set_active',
      'active_required', 'Say whether the account is to be switched on or off.',
      jsonb_build_object('field','active'));
  end if;

  if not ops_core.has_permission('it.manage_users') then
    return ops_core.refused('identity','user', p_user_id::text, v_action,
      'authority_required',
      'Switching an account on or off belongs to IT — logged, not applied.',
      jsonb_build_object('required','it.manage_users'));
  end if;

  if p_user_id = auth.uid() then
    return ops_core.refused('identity','user', p_user_id::text, v_action,
      'self_service_refused',
      'You cannot switch off your own account — ask another IT administrator.');
  end if;

  select * into v_target from ops_core.users where id = p_user_id;
  if not found then
    return ops_core.not_found('identity','user', p_user_id::text, v_action,
      'No such user.');
  end if;

  if v_target.is_active = p_active then
    return ops_core.noop('identity','user', v_target.email, v_action,
      case when p_active then 'The account is already active.'
           else 'The account is already switched off.' end,
      jsonb_build_object('user_id', p_user_id, 'is_active', p_active));
  end if;

  update ops_core.users set is_active = p_active where id = p_user_id;

  perform ops_core.emit('identity','access.changed', v_target.email,
    jsonb_build_object('user_id', p_user_id, 'is_active', p_active));

  return ops_core.ok('identity','user', v_target.email, v_action,
    jsonb_build_object('user_id', p_user_id, 'email', v_target.email, 'is_active', p_active),
    jsonb_build_object('is_active', v_target.is_active),
    jsonb_build_object('is_active', p_active, 'reason', v_reason));
end $$;

-- The decision to invite an address. `/api/identity/users` calls this **as
-- the person asking**, and asks GoTrue to send the invitation only if it says
-- ok. Nothing is written here but the trail: the profile row is made by
-- `provision_user` when GoTrue creates the account, from the name this
-- returns, exactly as for any other new account — and like any other, it
-- arrives holding nothing (D24).
--
-- The trail therefore says *invite* for a decision that was taken. Whether the
-- mail went is GoTrue's fact, recorded by GoTrue as `invited_at` — which is
-- what the directory shows.
create or replace function ops_core.invite_user(p_email text, p_full_name text)
returns jsonb
language plpgsql security definer set search_path = ops_core, pg_temp as $$
declare
  v_email    text := lower(btrim(coalesce(p_email, '')));
  v_name     text := btrim(regexp_replace(coalesce(p_full_name, ''), '\s+', ' ', 'g'));
  v_existing ops_core.users;
begin
  if not ops_core.has_permission('it.manage_users') then
    return ops_core.refused('identity','user', nullif(v_email, ''), 'invite',
      'authority_required',
      'Adding somebody to this workspace belongs to IT — logged, not applied.',
      jsonb_build_object('required','it.manage_users'));
  end if;

  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    return ops_core.invalid('identity','user', nullif(v_email, ''), 'invite',
      'email_invalid', 'That is not an email address.',
      jsonb_build_object('field','email'));
  end if;
  if v_name = '' then
    return ops_core.invalid('identity','user', v_email, 'invite',
      'name_required', 'A name is required — it is what every approval and payslip shows.',
      jsonb_build_object('field','full_name'));
  end if;
  if length(v_name) > 120 then
    return ops_core.invalid('identity','user', v_email, 'invite',
      'name_too_long', 'A name is at most 120 characters.',
      jsonb_build_object('field','full_name', 'max', 120));
  end if;

  -- Already here. The answer says whether the account is switched off,
  -- because the next step differs: switch it back on, or send it a link.
  select * into v_existing from ops_core.users where email = v_email::ops_core.citext;
  if found then
    return ops_core.conflict('identity','user', v_email, 'invite',
      'already_registered', 'That address already has an account here.',
      jsonb_build_object('user_id', v_existing.id, 'is_active', v_existing.is_active));
  end if;

  -- Known to GoTrue and not to us: the state `0029` healed, which provisioning
  -- makes nearly impossible. An invitation would be refused by GoTrue with a
  -- sentence about somebody else's schema; this one says what to do.
  if exists (select 1 from auth.users a where lower(a.email) = v_email) then
    return ops_core.conflict('identity','user', v_email, 'invite',
      'already_registered',
      'That address already has a sign-in but no profile yet. It is created the first time they sign in.',
      jsonb_build_object('profile', false));
  end if;

  return ops_core.ok('identity','user', v_email, 'invite',
    jsonb_build_object('email', v_email, 'full_name', v_name));
end $$;

-- The decision to send somebody a link to set their password.
--
-- Which link is the database's answer, not the screen's: an account that has
-- never confirmed its address gets its **invitation** again; one that has
-- gets a **recovery** link. GoTrue treats the two differently — re-inviting a
-- confirmed address is refused — so the choice has to be made from its own
-- record.
--
-- Refused for a switched-off account: a link that signs somebody into an
-- account that holds nothing is a link that only confuses them.
create or replace function ops_core.request_user_link(p_user_id uuid)
returns jsonb
language plpgsql security definer set search_path = ops_core, pg_temp as $$
declare
  v_target    ops_core.users;
  v_confirmed timestamptz;
  v_known     boolean;
begin
  if not ops_core.has_permission('it.manage_users') then
    return ops_core.refused('identity','user', p_user_id::text, 'link.send',
      'authority_required',
      'Sending somebody a sign-in link belongs to IT — logged, not applied.',
      jsonb_build_object('required','it.manage_users'));
  end if;

  select * into v_target from ops_core.users where id = p_user_id;
  if not found then
    return ops_core.not_found('identity','user', p_user_id::text, 'link.send',
      'No such user.');
  end if;

  if not v_target.is_active then
    return ops_core.refused('identity','user', v_target.email, 'link.send',
      'user_inactive',
      'Switch the account back on first — a link into an account that holds nothing opens nothing.');
  end if;

  select a.email_confirmed_at, true into v_confirmed, v_known
    from auth.users a where a.id = p_user_id;

  return ops_core.ok('identity','user', v_target.email, 'link.send',
    jsonb_build_object(
      'user_id', p_user_id,
      'email', v_target.email,
      'full_name', v_target.full_name,
      'kind', case when coalesce(v_known, false) and v_confirmed is null then 'invite'
                   else 'recovery' end));
end $$;

-- ── 5. a sign-in by a switched-off account is recorded as refused ─────────
--
-- The body is `0029`'s, with one branch added before the ordinary one. It
-- still returns nothing and still never raises — refusing inside the sign-in
-- would lock out the person who can fix it — so the screen reads `is_active`
-- from `v_my_access` and signs the person out itself.
create or replace function ops_core.record_sign_in()
returns void
language plpgsql security definer set search_path = ops_core, pg_temp as $$
declare u ops_core.users;
begin
  select * into u from ops_core.users where id = auth.uid();

  if not found then
    if auth.uid() is null then
      return;
    end if;

    insert into ops_core.users (id, email, full_name)
    select a.id,
           a.email,
           coalesce(
             nullif(a.raw_user_meta_data ->> 'full_name', ''),
             nullif(a.raw_user_meta_data ->> 'name', ''),
             split_part(a.email, '@', 1))
      from auth.users a
     where a.id = auth.uid() and a.email is not null
    on conflict (id) do nothing;

    select * into u from ops_core.users where id = auth.uid();
    if not found then
      perform ops_core.write_audit('identity','session', null, 'sign_in',
        'refused', 'authenticated, but the account has no email address');
      return;
    end if;

    perform ops_core.write_audit('identity','session', u.email, 'sign_in',
      'ok', 'provisioned on first sign-in — the account predates the trigger');
    return;
  end if;

  if not u.is_active then
    perform ops_core.write_audit('identity','session', u.email, 'sign_in',
      'refused', 'the account is switched off');
    return;
  end if;

  perform ops_core.write_audit('identity','session', u.email, 'sign_in', 'ok');
end $$;

revoke execute on function ops_core.update_user(uuid, text) from public;
revoke execute on function ops_core.set_user_active(uuid, boolean, text) from public;
revoke execute on function ops_core.invite_user(text, text) from public;
revoke execute on function ops_core.request_user_link(uuid) from public;
grant execute on function ops_core.update_user(uuid, text) to authenticated;
grant execute on function ops_core.set_user_active(uuid, boolean, text) to authenticated;
grant execute on function ops_core.invite_user(text, text) to authenticated;
grant execute on function ops_core.request_user_link(uuid) to authenticated;

comment on function ops_core.set_user_active is
  'Switch an account off or back on. it.manage_users; never your own. Grants are kept — '
  'has_permission/has_authority answer false for an inactive account. (0183, D325)';
comment on function ops_core.invite_user is
  'The decision to invite an address, taken as the person asking. Writes only the trail; '
  '/api/identity/users sends the GoTrue invitation on ok, and provision_user makes the '
  'profile. (0183, D325)';
comment on function ops_core.request_user_link is
  'The decision to send a set-password link, and which: invite for an unconfirmed '
  'address, recovery otherwise. Refused for an inactive account. (0183, D325)';

analyze ops_core.users;
