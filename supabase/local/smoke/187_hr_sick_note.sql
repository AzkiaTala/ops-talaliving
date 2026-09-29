-- 187_hr_sick_note.sql — the surat dokter travels with the sick request (0187, D331).
--
-- DERIVATIONS  a surat dokter goes to the HRD drive, in CUTI IZIN SAKIT/SURAT
--              DOKTER under ops-talaliving, whatever it is filed against; a
--              letter on a pending sick request shows as `letter_attached`; approving
--              carries it to every sick day, and `read_day` then pays those days
--              (D144); a letter linked after approval is carried the moment it
--              arrives; approving a sick request with no letter leaves the day
--              unpaid, exactly as before
-- REFUSALS     a stranger linking a letter to somebody else's request; a link
--              to a request number that does not exist

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('ffffffff-0000-0000-0000-000000187001','hrd187@talaliving.com','{"full_name":"HRD"}'),
  ('ffffffff-0000-0000-0000-000000187002','karjo187@pekerja.talaliving','{"full_name":"Karjo"}'),
  ('ffffffff-0000-0000-0000-000000187003','lain187@pekerja.talaliving','{"full_name":"Orang lain"}');

insert into ops_core.user_modules (user_id, module, level) values
  ('ffffffff-0000-0000-0000-000000187001','hrd','admin');

insert into ops_hr.employees
  (id, employee_no, full_name, position, unit, pay_basis, base_rate, allowance_rate,
   daily_hours, joined_on, user_id, paid_leave_days)
values
  ('aaaa1870-0000-0000-0000-000000000001','B-1871','Karjo','Tukang','Produksi',
   'daily', 180000, 25000, 8, '2025-01-01','ffffffff-0000-0000-0000-000000187002', 12),
  ('aaaa1870-0000-0000-0000-000000000002','B-1872','Orang lain','Tukang','Produksi',
   'daily', 180000, 25000, 8, '2025-01-01','ffffffff-0000-0000-0000-000000187003', 12);

-- Two files, as the upload route would have recorded them.
insert into ops_core.attachments (id, storage_path, filename, sha256, mime, bytes, uploaded_by) values
  ('bbbb1870-0000-0000-0000-000000000001','drive:1','surat-1.jpg','sha187a','image/jpeg',1000,
   'ffffffff-0000-0000-0000-000000187002'),
  ('bbbb1870-0000-0000-0000-000000000002','drive:2','surat-2.jpg','sha187b','image/jpeg',1000,
   'ffffffff-0000-0000-0000-000000187002');

/* ── the folder: HRD drive, its own task folder ───────────────────────── */
do $$
begin
  assert ops_core.drive_path_for('surat_dokter', 'leave_request') = 'CUTI IZIN SAKIT/SURAT DOKTER',
    'a surat dokter from a request, got ' || ops_core.drive_path_for('surat_dokter', 'leave_request');
  assert ops_core.drive_path_for('surat_dokter', 'day_mark') = 'CUTI IZIN SAKIT/SURAT DOKTER',
    'a surat dokter HRD files on the day goes to the same folder';
  assert (select slug from ops_core.doc_kind_drive where kind = 'surat_dokter') = 'hrd',
    'a doctor''s letter is personal data and belongs on the HRD drive (0035)';
end $$;

set local role authenticated;
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000187002';

/* ── Karjo asks for two sick days and attaches the letter ─────────────── */
create temp table t187 (k text primary key, v text) on commit drop;
grant all on t187 to authenticated;

do $$
declare a jsonb; v_no text; v_other text; v_has boolean;
begin
  a := ops_hr.request_leave(null, 'sakit', date '2026-09-21', date '2026-09-22', 'Demam');
  assert a ->> 'outcome' = 'ok', a::text;
  v_no := a -> 'data' ->> 'request_no';
  insert into t187 values ('sick', v_no);

  -- A second request with no letter, to prove nothing changes without one.
  a := ops_hr.request_leave(null, 'sakit', date '2026-09-24', date '2026-09-24', 'Pusing');
  assert a ->> 'outcome' = 'ok', a::text;
  insert into t187 values ('bare', a -> 'data' ->> 'request_no');

  select letter_attached into v_has from ops_hr.v_leave_request where request_no = v_no;
  assert not v_has, 'no letter yet, letter_attached should be false';

  a := ops_core.attach_link('bbbb1870-0000-0000-0000-000000000001', 'leave_request', v_no, 'surat_dokter');
  assert a ->> 'outcome' = 'ok', 'Karjo attaches his own letter: ' || a::text;

  select letter_attached into v_has from ops_hr.v_leave_request where request_no = v_no;
  assert v_has, 'HRD must see the letter where it decides';

  -- Pending: nothing carried yet, because there is no mark to carry it to.
  assert not exists (select 1 from ops_core.attachment_links
                      where entity = 'day_mark' and attachment_id = 'bbbb1870-0000-0000-0000-000000000001'),
    'a letter on a pending request must not reach any day';
end $$;

/* ── somebody else cannot file a letter on Karjo's request ────────────── */
reset role;
set local role authenticated;
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000187003';
do $$
declare v_no text := (select v from t187 where k = 'sick');
begin
  begin
    perform ops_core.attach_link('bbbb1870-0000-0000-0000-000000000002', 'leave_request', v_no, 'surat_dokter');
    raise exception 'a stranger attached a letter to somebody else''s sick request';
  exception when insufficient_privilege then null;
  end;
  begin
    perform ops_core.attach_link('bbbb1870-0000-0000-0000-000000000002', 'leave_request', 'izn-00-00-00_99', 'surat_dokter');
    raise exception 'a letter was linked to a request that does not exist';
  exception when foreign_key_violation then null;
  end;
end $$;

/* ── HRD approves: the letter reaches both days, and both are paid ────── */
reset role;
set local role authenticated;
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000187001';
do $$
declare a jsonb; v_no text := (select v from t187 where k = 'sick');
        v_bare text := (select v from t187 where k = 'bare');
        v_n int; r record;
begin
  a := ops_hr.decide_leave(v_no, true);
  assert a ->> 'outcome' = 'ok', a::text;
  assert jsonb_array_length(a -> 'data' -> 'marked') = 2, a::text;

  select count(*) into v_n
    from ops_core.attachment_links l
    join ops_hr.day_marks m on m.mark_no = l.entity_no
   where l.entity = 'day_mark' and l.kind = 'surat_dokter' and l.unlinked_at is null
     and m.employee_id = 'aaaa1870-0000-0000-0000-000000000001';
  assert v_n = 2, format('the letter should be on both sick days, found %s', v_n);

  for r in select * from ops_hr.read_day('aaaa1870-0000-0000-0000-000000000001', date '2026-09-21') loop
    assert r.why like 'Sakit dengan surat dokter%', 'D144: a sick day with its letter is paid — got ' || coalesce(r.why, 'null');
  end loop;

  -- The request with no letter: approved, marked, and unpaid.
  a := ops_hr.decide_leave(v_bare, true);
  assert a ->> 'outcome' = 'ok', a::text;
  for r in select * from ops_hr.read_day('aaaa1870-0000-0000-0000-000000000001', date '2026-09-24') loop
    assert r.why like 'Sakit tanpa surat dokter%', 'no letter, no pay — got ' || coalesce(r.why, 'null');
  end loop;
end $$;

/* ── the letter arrives late: the day turns paid the moment it does ────── */
reset role;
set local role authenticated;
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000187002';
do $$
declare a jsonb; v_bare text := (select v from t187 where k = 'bare'); r record;
begin
  a := ops_core.attach_link('bbbb1870-0000-0000-0000-000000000002', 'leave_request', v_bare, 'surat_dokter');
  assert a ->> 'outcome' = 'ok', a::text;
  for r in select * from ops_hr.read_day('aaaa1870-0000-0000-0000-000000000001', date '2026-09-24') loop
    assert r.why like 'Sakit dengan surat dokter%', 'a late letter must make the day paid — got ' || coalesce(r.why, 'null');
  end loop;
end $$;

reset role;
rollback;
