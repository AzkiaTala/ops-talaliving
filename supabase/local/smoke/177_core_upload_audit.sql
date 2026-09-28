-- core — the audit log tells the truth about an upload (0177, F173).
--
-- DERIVATIONS  asking which folder a file goes in writes no audit row; the
--              app's ops-talaliving folder and its drive are recorded once; a
--              filed document's row names the file and says where it went;
--              a failed upload is a `refused` row with its reason and
--              Google's answer in detail
-- REFUSALS     an unknown kind is still logged; recording a failure while not
--              signed in
--
-- The calls run as the person; the audit rows are read back as postgres,
-- because `audit_log` is behind RLS and a count under it proves nothing.

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('aaaa0000-0000-0000-0000-000000177001','proc-audit@talaliving.com','{"full_name":"Procurement"}');
insert into ops_core.user_modules (user_id, module, level) values
  ('aaaa0000-0000-0000-0000-000000177001','procurement','write');

set local role authenticated;
set local request.jwt.claim.sub = 'aaaa0000-0000-0000-0000-000000177001';

do $$
declare r jsonb;
begin
  r := ops_core.drive_folder_for('foto', 'item');
  assert ops_core.said_ok(r) and r->'data'->>'path' = 'INVENTORY/ITEMS', 'still answers: ' || r::text;
  assert r->'data'->>'slug' = 'procurement', 'still names the drive: ' || r::text;

  r := ops_core.drive_folder_for('kapal');
  assert r->'error'->>'code' = 'unknown_kind', 'unknown kind: ' || r::text;

  r := ops_core.attach_file('1FileId', 'kursi.jpg', 'image/jpeg', 1000, null, 'web', null,
         p_kind => 'foto', p_entity => 'item',
         p_web_view_link => 'https://drive.google.com/file/d/1FileId/view', p_folder_id => 'f1');
  assert ops_core.said_ok(r), 'attach: ' || r::text;

  r := ops_core.record_upload_failure('rak.jpg', 'foto', 'ops_folder', 'drive_folder_unreachable',
         'The app cannot open the OPS folder of PROCUREMENT.',
         jsonb_build_object('google', jsonb_build_object('status', 404)));
  assert r->>'outcome' = 'refused' and r->'error'->>'code' = 'drive_folder_unreachable',
    'the failure is a refusal: ' || r::text;

  -- The app's own folder and its drive, written back by an uploader (D320).
  r := ops_core.record_ops_folder('procurement', '1appFolder', '0AprocDrive');
  assert ops_core.said_ok(r), 'record the app folder: ' || r::text;
  r := ops_core.drive_folder_for('foto', 'item');
  assert r->'data'->>'folder_id' = '1appFolder' and r->'data'->>'drive_id' = '0AprocDrive',
    'the next upload asks Google nothing: ' || r::text;
  -- An uploader cannot repoint a located drive.
  r := ops_core.record_ops_folder('procurement', '1elsewhere', '0Aelsewhere');
  assert r->>'outcome' = 'noop', 'no overwrite: ' || r::text;
  assert (ops_core.drive_folder_for('foto'))->'data'->>'folder_id' = '1appFolder', 'still the first';
end $$;

reset role;

do $$
declare a record; n int;
  me constant uuid := 'aaaa0000-0000-0000-0000-000000177001';
begin
  select count(*) into n from ops_core.audit_log
   where actor_id = me and action in ('file', 'resolve_folder') and outcome = 'ok';
  assert n = 0, format('asking where a file goes wrote %s ok row(s)', n);

  select count(*) into n from ops_core.audit_log
   where actor_id = me and action = 'resolve_folder' and outcome = 'refused';
  assert n = 1, format('the refused question is logged once, got %s', n);

  select * into a from ops_core.audit_log where actor_id = me and action = 'attach_file';
  assert a.entity_no = 'kursi.jpg', 'the row names the file, got ' || coalesce(a.entity_no, 'null');
  assert a.reason like 'kursi.jpg → % / ops-talaliving / INVENTORY/ITEMS', 'the row says where, got ' || coalesce(a.reason, 'null');
  assert a.detail->>'drive_file_id' = '1FileId', 'detail keeps the Drive id';

  select * into a from ops_core.audit_log where actor_id = me and action = 'upload';
  assert a.outcome = 'refused' and a.entity_no = 'rak.jpg', 'named and refused';
  assert a.reason = 'The app cannot open the OPS folder of PROCUREMENT.', 'the reason is the explanation';
  assert a.detail->'google'->>'status' = '404' and a.detail->>'stage' = 'ops_folder', 'Google''s answer kept';
end $$;

set local role authenticated;
set local request.jwt.claim.sub = '';

do $$
declare r jsonb;
begin
  r := ops_core.record_upload_failure('x.jpg', 'foto', 'upload', 'x', 'y');
  assert r->'error'->>'code' = 'not_signed_in', 'not signed in: ' || r::text;
end $$;

rollback;
