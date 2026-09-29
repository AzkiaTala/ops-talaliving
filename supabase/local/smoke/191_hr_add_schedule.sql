-- 191_hr_add_schedule.sql — HRD menambah pola kerja dari /hrd/jadwal (D335).
--
-- Yang dibuktikan:
--   • HRD menambah pola SATPAM 19.00–07.00 sebagai versi buku baru yang
--     bertanggal; aturan lain disalin utuh, buku lama tidak berubah;
--   • pola baru langsung terbaca `schedule_roll` (12 jam, malam, batas 13.00)
--     dan orang yang dipasang padanya membaca malamnya sebagai satu hari
--     (D330) — tambah, pasang, baca, tanpa IT;
--   • penolakannya: bukan HRD, tanpa alasan, kode yang sudah ada, bentuk yang
--     salah (kode, masuk = pulang), tanggal sebelum versi yang lebih baru,
--     dan tanggal di dalam run gaji.

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('ffffffff-0000-0000-0000-000000019101','hrd191@talaliving.com','{"full_name":"HRD"}'),
  ('ffffffff-0000-0000-0000-000000019102','it191@talaliving.com','{"full_name":"IT"}');
insert into ops_core.user_modules (user_id, module, level) values
  ('ffffffff-0000-0000-0000-000000019101','hrd','admin'),
  ('ffffffff-0000-0000-0000-000000019102','it','admin');

-- Buku seperti produksi hari ini: dua pola, tanpa satpam.
insert into ops_hr.pay_rule_sets (version, effective_from, note, rules, created_by) values
 (1, '2026-01-01', 'uji', '{
   "week_pattern":"5day","day_starts_minutes":480,
   "late_grace_minutes":15,"late_mode":"manual","undertime_mode":"off",
   "schedules":[
     {"code":"PRODUKSI","name":"Produksi","start_minutes":450,"end_minutes":990,
      "break_minutes":45,"friday_break_minutes":90,"friday_end_minutes":960,"note":null},
     {"code":"KANTOR","name":"Kantor","start_minutes":480,"end_minutes":1035,
      "break_minutes":60,"friday_break_minutes":90,"friday_end_minutes":990,"note":null}],
   "schedule_by_unit":{"Produksi":"PRODUKSI","Kantor":"KANTOR"}
 }'::jsonb, 'ffffffff-0000-0000-0000-000000019101');

insert into ops_hr.employees
  (id, employee_no, full_name, position, unit, pay_basis, base_rate, allowance_rate,
   daily_hours, joined_on, user_id, paid_leave_days)
values
  ('aaaa1910-0000-0000-0000-000000000001','S-0911','Satpam baru','Satpam','Umum',
   'daily', 150000, 0, 12, '2025-01-01', null, 12);

set local role authenticated;

/* ── bukan HRD ──────────────────────────────────────────────────────────── */
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000019102';

do $$
declare a jsonb;
begin
  a := ops_hr.add_schedule('SATPAM','Satpam — 12 jam', 1140, 420, 0, null, null, null,
                           '2026-08-01', 'pos jaga malam');
  assert a -> 'error' ->> 'code' = 'not_permitted', a::text;
end $$;

/* ── HRD ────────────────────────────────────────────────────────────────── */
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000019101';

do $$
declare a jsonb; s jsonb;
begin
  a := ops_hr.add_schedule('SATPAM','Satpam', 1140, 420, 0, null, null, null, '2026-08-01', '  ');
  assert a -> 'error' ->> 'code' = 'note_required', a::text;

  a := ops_hr.add_schedule('KANTOR','Kantor lagi', 480, 1020, 60, null, null, null, '2026-08-01', 'dobel');
  assert a -> 'error' ->> 'code' = 'schedule_exists', a::text;

  a := ops_hr.add_schedule('satpam','Satpam', 1140, 420, 0, null, null, null, '2026-08-01', 'huruf kecil');
  assert a -> 'error' ->> 'code' = 'code_shape', a::text;

  a := ops_hr.add_schedule('SATPAM','Satpam', 1140, 1140, 0, null, null, null, '2026-08-01', 'salah ketik');
  assert a -> 'error' ->> 'code' = 'end_before_start', a::text;

  -- Pola malam dengan jam pulang Jumat: aturan D330 yang sama.
  a := ops_hr.add_schedule('SATPAM','Satpam', 1140, 420, 0, null, 300, null, '2026-08-01', 'jumat');
  assert a -> 'error' ->> 'code' = 'overnight_friday_end', a::text;

  -- Yang benar.
  a := ops_hr.add_schedule('SATPAM','Satpam — 12 jam', 1140, 420, 0, null, null,
                           'Pos jaga gudang.', '2026-08-01', 'Pos jaga malam mulai Agustus', 'k-191');
  assert a ->> 'outcome' = 'ok', a::text;
  assert (a -> 'data' ->> 'version')::int = 2, a::text;

  -- Kunci idempoten: kiriman ulang tidak menulis versi ketiga.
  a := ops_hr.add_schedule('SATPAM','Satpam — 12 jam', 1140, 420, 0, null, null,
                           'Pos jaga gudang.', '2026-08-01', 'Pos jaga malam mulai Agustus', 'k-191');
  assert (select count(*) from ops_hr.pay_rule_sets) = 2, 'kiriman ulang menulis versi baru';

  -- Aturan lain disalin utuh; buku lama tidak berubah.
  assert ops_hr.rules_on('2026-08-01') - 'schedules' = ops_hr.rules_on('2026-07-31') - 'schedules',
    'aturan selain pola ikut berubah';
  assert jsonb_array_length(ops_hr.rules_on('2026-07-31') -> 'schedules') = 2, 'buku lama berubah';
  select x into s from jsonb_array_elements(ops_hr.rules_on('2026-08-01') -> 'schedules') x
   where x ->> 'code' = 'SATPAM';
  assert (s ->> 'start_minutes')::int = 1140 and (s ->> 'end_minutes')::int = 420
     and (s ->> 'break_minutes')::int = 0 and s ->> 'note' = 'Pos jaga gudang.'
     and not (s ? 'hours_unconfirmed') and s ? 'friday_end_minutes', s::text;

  -- Sekali lagi dengan kode yang sama: sudah ada.
  a := ops_hr.add_schedule('SATPAM','Satpam', 1140, 420, 0, null, null, null, '2026-08-01', 'lagi');
  assert a -> 'error' ->> 'code' = 'schedule_exists', a::text;

  -- Tanggal sebelum versi 2: pola itu akan hilang pada 1 Agustus.
  a := ops_hr.add_schedule('ART','Asisten rumah tangga', 840, 1260, 60, null, null, null,
                           '2026-07-15', 'mundur');
  assert a -> 'error' ->> 'code' = 'later_version_exists', a::text;
end $$;

/* ── ditambah, dipasang, dibaca ─────────────────────────────────────────── */
do $$
declare a jsonb; s jsonb; d ops_hr.day_reading;
begin
  select x into s from jsonb_array_elements(ops_hr.schedule_roll() -> 'schedules') x
   where x ->> 'code' = 'SATPAM';
  assert (s -> 'hours' ->> 'daily_hours')::numeric = 12
     and (s ->> 'overnight')::boolean and (s ->> 'day_boundary_minutes')::int = 780
     and not (s ->> 'hours_unconfirmed')::boolean, s::text;

  a := ops_hr.set_employee_schedule('S-0911','SATPAM');
  assert ops_core.said_ok(a), a::text;

  a := ops_hr.add_scan('S-0911', '2026-08-03 19:02+08', 'mesin mati');
  assert ops_core.said_ok(a), a::text;
  a := ops_hr.add_scan('S-0911', '2026-08-04 07:05+08', 'mesin mati');
  assert ops_core.said_ok(a), a::text;

  select * into d from ops_hr.read_day('aaaa1910-0000-0000-0000-000000000001', '2026-08-03');
  assert d.state = 'complete' and d.overnight and d.work_hours = 12.05,
    format('%s %s %s', d.state, d.overnight, d.work_hours);
end $$;

/* ── tanggal di dalam run gaji ──────────────────────────────────────────── */
reset role;
insert into ops_hr.payroll_runs (run_no, period_start, period_end, status)
values ('PAY-191', '2026-09-01', '2026-09-30', 'DRAFT');
set local role authenticated;
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000019101';

do $$
declare a jsonb;
begin
  a := ops_hr.add_schedule('ART','Asisten rumah tangga', 840, 1260, 60, null, null, null,
                           '2026-09-15', 'tengah periode');
  assert a -> 'error' ->> 'code' = 'inside_existing_run', a::text;
end $$;

rollback;
