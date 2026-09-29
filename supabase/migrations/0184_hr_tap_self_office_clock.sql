-- 0184_hr_tap_self_office_clock.sql — a self-tap's activity label reads the
-- office clock, not UTC's (D327, F184).
--
-- `0164` wrote the label with `to_char(v_at, 'HH24:MI')`. `v_at` is a
-- timestamptz, and `to_char` renders it in the **session's** time zone — UTC
-- on a default Supabase connection. So a 07:25 clock-in at the workshop
-- showed on `/profil` → Aktivitas as *Tap presensi pukul 23:25*, the evening
-- before. Every other HR seam that prints a time already says where it is
-- (`0048`, `0049`, `0053`: `to_char(t at time zone 'Asia/Makassar', …)`), and
-- `at time zone` on a timestamptz does not care what the session is set to,
-- which is the point: the label is written once and read forever.
--
-- Same signature, same grants, same behaviour; only the label changes. `0164`
-- is not edited — production already ran it. Labels written before this file
-- stay as they were: they are a record of what was said at the time, and
-- rewriting history to fix a rendering would be the larger mistake. D332 will
-- replace this function again (location), building on this body.

create or replace function ops_hr.tap_self(p_key text default null)
returns jsonb
language plpgsql security definer set search_path = ops_hr, ops_core, pg_temp as $$
declare
  v_replayed jsonb; v_emp uuid; v_id uuid; v_at timestamptz := now(); v_res jsonb;
begin
  v_replayed := ops_core.idem_replay('hr','tap_self', p_key);
  if v_replayed is not null then return v_replayed; end if;

  v_emp := ops_hr.my_employee_id();
  if v_emp is null then
    return ops_core.refused('hr','attendance', null,'tap_self',
      'no_employee_link',
      'Akun ini belum tertaut ke data karyawan, jadi presensi tidak bisa dicatat sendiri. Minta HRD menautkannya.');
  end if;

  insert into ops_hr.attendance_scans
    (employee_id, work_date, at, verify, source, recorded_by)
  values (v_emp, ops_core.office_day(v_at), v_at, 'app', 'self', auth.uid())
  returning id into v_id;

  perform ops_core.record_activity_event('attendance_tap','attendance',
    format('Tap presensi pukul %s', to_char(v_at at time zone 'Asia/Makassar', 'HH24:MI')));

  v_res := ops_core.ok('hr','attendance', v_id::text,'tap_self',
    jsonb_build_object('id', v_id, 'at', v_at, 'work_date', ops_core.office_day(v_at)));
  return ops_core.idem_remember('hr','tap_self', p_key, v_res);
end $$;

revoke execute on function ops_hr.tap_self(text) from public;
grant execute on function ops_hr.tap_self(text) to authenticated;
