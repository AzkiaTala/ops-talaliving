-- core — an upload survives PostgREST, and the row says where the file went
-- (0175, F169, D319).
--
-- GUARD        no `stable`/`immutable` function a browser can call writes
--              anything. PostgREST runs those in a read-only transaction, so
--              one that answers through `ok()` / `refused()` (which write the
--              audit row) fails with *cannot execute INSERT in a read-only
--              transaction* — and only through PostgREST, never here in psql,
--              which is how `drive_folder_for` broke every upload unseen.
-- DERIVATIONS  a file records the Drive link, the shared drive decided from its
--              kind, and the task folder under OPS; the view says it in words
-- REFUSALS     a link that is not Google Drive's; a kind nobody files; a
--              read-only transaction really does refuse the audit write (the
--              failure the guard exists for, reproduced)

begin;

-- ── the guard ─────────────────────────────────────────────────────────────

do $$
declare v_bad text;
begin
  select string_agg(format('%s.%s(%s)', n.nspname, p.proname,
                           pg_get_function_identity_arguments(p.oid)), E'\n  ' order by 1)
    into v_bad
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname like 'ops\_%'
     and p.provolatile in ('s', 'i')
     and has_function_privilege('authenticated', p.oid, 'execute')
     and (p.prosrc ~* '(ops_core\.|[^a-z0-9_.])(ok|noop|refused|invalid|conflict|not_found|say|write_audit|emit|idem_remember)\s*\('
          or p.prosrc ~* '\minsert\s+into\M'
          or p.prosrc ~* '\mdelete\s+from\M'
          or p.prosrc ~* '\mupdate\s+[a-z_.]+\s+set\M');
  assert v_bad is null, format(
    E'stable/immutable functions that write, reachable through PostgREST (read-only there):\n  %s\n'
    'Declare them volatile.', v_bad);
end $$;

-- ── the row knows where its file is ───────────────────────────────────────

insert into auth.users (id, email, raw_user_meta_data) values
  ('aaaa0000-0000-0000-0000-000000175001','proc-upload@talaliving.com','{"full_name":"Procurement"}');
insert into ops_core.user_modules (user_id, module, level) values
  ('aaaa0000-0000-0000-0000-000000175001','procurement','write');

set local role authenticated;
set local request.jwt.claim.sub = 'aaaa0000-0000-0000-0000-000000175001';

do $$
declare r jsonb; v ops_core.v_attachment;
begin
  -- What the upload route asks first, now answerable in a read-write call.
  r := ops_core.drive_folder_for('foto', 'item');
  assert ops_core.said_ok(r), 'drive_folder_for: ' || r::text;

  r := ops_core.attach_file('1AbCdriveFileId', 'kursi.jpg', 'image/jpeg', 1000, null, 'web', null,
         p_kind => 'foto', p_entity => 'item',
         p_web_view_link => 'https://drive.google.com/file/d/1AbCdriveFileId/view?usp=drivesdk',
         p_folder_id => 'folderItems');
  assert ops_core.said_ok(r), 'attach_file with where it went: ' || r::text;
  assert r->'data'->>'drive' = 'procurement' and r->'data'->>'path' = 'INVENTORY/ITEMS',
    'the drive and folder are the database''s answer, got ' || r::text;

  select * into v from ops_core.v_attachment where id = r->'data'->>'attachment_id';
  assert v.web_view_link = 'https://drive.google.com/file/d/1AbCdriveFileId/view?usp=drivesdk',
    'the link is kept, got ' || coalesce(v.web_view_link, 'null');
  assert v.filed_in like '% / ops-talaliving / INVENTORY/ITEMS', 'filed_in in words, got ' || coalesce(v.filed_in, 'null');

  -- The drive follows the kind, not the screen: a KTP is HRD's.
  r := ops_core.attach_file('1KtpId', 'ktp.jpg', 'image/jpeg', 1000, null, 'web', null,
         p_kind => 'ktp', p_web_view_link => 'https://drive.google.com/file/d/1KtpId/view');
  assert r->'data'->>'drive' = 'hrd', 'a KTP goes to HRD, got ' || r::text;

  -- Written before 0175, or by a caller that does not say: nothing invented.
  r := ops_core.attach_file('old/a.jpg', 'a.jpg', 'image/jpeg', 1000, null, 'upload');
  assert ops_core.said_ok(r), 'the old positional call still works: ' || r::text;
  select * into v from ops_core.v_attachment where id = r->'data'->>'attachment_id';
  assert v.web_view_link is null and v.filed_in is null, 'no drive claimed for an old row';

  r := ops_core.attach_file('1X', 'x.jpg', 'image/jpeg', 1000, null, 'web', null,
         p_kind => 'foto', p_web_view_link => 'https://evil.example.com/x');
  assert r->'error'->>'code' = 'not_a_drive_link', 'a non-Drive link, got ' || r::text;

  r := ops_core.attach_file('1Y', 'y.jpg', 'image/jpeg', 1000, null, 'web', null, p_kind => 'kapal');
  assert r->'error'->>'code' = 'unknown_kind', 'an unknown kind, got ' || r::text;
end $$;

-- ── the failure itself, reproduced ────────────────────────────────────────
-- What PostgREST does for a stable function: the transaction goes read-only,
-- and the audit write every envelope makes is refused. Last in the file,
-- because nothing after it can write.

reset role;
set local transaction_read_only = on;

do $$
begin
  -- A refusal writes its audit row (0177 stopped the *answer* writing one).
  perform ops_core.drive_folder_for('kapal');
  raise exception 'a read-only transaction should refuse the audit write';
exception when read_only_sql_transaction then null;
end $$;

rollback;
