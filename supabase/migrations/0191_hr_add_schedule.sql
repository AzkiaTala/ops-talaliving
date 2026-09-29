-- 0191 — HRD adds a working pattern from /hrd/jadwal (D335).
--
-- D330 let HRD set an **existing** pattern's hours. Production then showed the
-- gap the same day: its rule book carries only PRODUKSI and KANTOR, so there
-- was no guard pattern to set, and adding one meant asking IT to republish the
-- whole book in `/it/aturan-gaji` — a screen whose every other field is pay
-- policy HRD does not touch (D173). *Which working patterns exist* is HRD's
-- knowledge; the owner asked for HRD to be able to add one.
--
-- So this seam writes exactly one thing, the same way `set_schedule_hours`
-- does: a **new dated version** of the book in force on the chosen date, with
-- the new pattern appended and every other rule copied untouched. The book's
-- own history is then *who added the guard pattern, when, and why*.
--
-- It refuses what `set_schedule_hours` refuses, with the same sentences — the
-- shape (`schedule_problem`, so a night pattern such as 19:00–07:00 is
-- accepted and an equal start and end is not), money already paid, a date
-- inside a run, a later version that would silently drop the pattern on its
-- date — plus one of its own: a code already in the book is an edit, not an
-- addition, and says where the edit is made.
--
-- Deliberately not here: removing a pattern (people can be on it; that is
-- `schedules_in_use_lost`'s territory and stays with IT's full editor), and
-- units' default patterns (`schedule_by_unit`), which change what a whole unit
-- is measured against and are a pay-policy decision.
create or replace function ops_hr.add_schedule(
  p_code                 text,
  p_name                 text,
  p_start_minutes        int,
  p_end_minutes          int,
  p_break_minutes        int,
  p_friday_break_minutes int,
  p_friday_end_minutes   int,
  p_pattern_note         text,
  p_effective_from       date,
  p_note                 text,
  p_key                  text default null)
returns jsonb
language plpgsql security definer set search_path = ops_hr, ops_core, pg_temp as $$
declare
  v_replayed jsonb; v_res jsonb; v_from date; v_code text;
  v_base ops_hr.pay_rule_sets; v_later ops_hr.pay_rule_sets;
  v_new jsonb; v_rules jsonb; v_problem jsonb;
  v_spent text; v_clash text; v_version int;
begin
  v_replayed := ops_core.idem_replay('hr','add_schedule', p_key);
  if v_replayed is not null then return v_replayed; end if;

  v_code := btrim(coalesce(p_code, ''));

  if not ops_core.has_permission('hrd.update') then
    return ops_core.refused('hr','schedule', nullif(v_code, ''),'add',
      'not_permitted','Menambah pola kerja butuh akses HRD.');
  end if;
  if coalesce(btrim(coalesce(p_note,'')), '') = '' then
    return ops_core.invalid('hr','schedule', nullif(v_code, ''),'add',
      'note_required',
      'Tulis alasannya. Pola kerja yang muncul tanpa keterangan tidak bisa dijelaskan ke orang yang dipasang padanya.',
      jsonb_build_object('field','note'));
  end if;

  v_from := coalesce(p_effective_from, ops_core.office_day());

  select * into v_base from ops_hr.pay_rule_sets
   where effective_from <= v_from
   order by effective_from desc, version desc limit 1;
  if not found then
    return ops_core.conflict('hr','schedule', nullif(v_code, ''),'add',
      'no_rule_book',
      format('Belum ada buku aturan gaji yang berlaku pada %s. IT menerbitkannya dulu.', v_from));
  end if;

  select * into v_later from ops_hr.pay_rule_sets
   where effective_from > v_from
   order by effective_from, version limit 1;
  if found then
    return ops_core.conflict('hr','schedule', nullif(v_code, ''),'add',
      'later_version_exists',
      format('Versi %s berlaku mulai %s, sesudah tanggal ini, dan tidak memuat pola ini — '
             'polanya akan hilang pada tanggal itu. Pilih tanggal mulai %s atau sesudahnya.',
             v_later.version, v_later.effective_from, v_later.effective_from));
  end if;

  -- An existing code is an edit, not an addition. `schedule_problem` would
  -- also refuse it (two rows, one code), but its sentence is about a broken
  -- book; this one says where the pattern's hours are actually changed.
  if exists (select 1 from jsonb_array_elements(coalesce(v_base.rules -> 'schedules','[]'::jsonb)) s
              where s.value ->> 'code' = v_code) then
    return ops_core.conflict('hr','schedule', v_code,'add',
      'schedule_exists',
      format('Pola %s sudah ada di buku aturan. Ubah jamnya dengan tombol Jam di barisnya.', v_code));
  end if;

  -- The same keys every pattern has, so readers never meet a half-shaped row.
  -- No `hours_unconfirmed`: HRD typed these hours, which is the confirmation.
  v_new := jsonb_build_object(
    'code', v_code,
    'name', btrim(coalesce(p_name, '')),
    'start_minutes', p_start_minutes,
    'end_minutes', p_end_minutes,
    'break_minutes', p_break_minutes,
    'friday_break_minutes', p_friday_break_minutes,
    'friday_end_minutes', p_friday_end_minutes,
    'note', nullif(btrim(coalesce(p_pattern_note, '')), ''));

  v_rules := jsonb_set(v_base.rules, '{schedules}',
    coalesce(v_base.rules -> 'schedules', '[]'::jsonb) || jsonb_build_array(v_new));

  v_problem := ops_hr.schedule_problem(v_rules);
  if v_problem is not null then
    return ops_core.invalid('hr','schedule', nullif(v_code, ''),'add',
      v_problem ->> 'code', v_problem ->> 'message',
      jsonb_build_object('field','schedules'));
  end if;

  select run_no into v_spent from ops_hr.payroll_runs
   where status <> 'DRAFT' and period_end >= v_from
   order by period_start limit 1;
  if v_spent is not null then
    return ops_core.conflict('hr','schedule', v_code,'add',
      'already_paid',
      format('%s sudah ditandatangani untuk periode yang berakhir %s atau sesudahnya. '
             'Aturan tidak bisa mundur melewati uang yang sudah dibayarkan — '
             'terbitkan yang baru berlaku setelahnya.', v_spent, v_from));
  end if;

  select run_no into v_clash from ops_hr.payroll_runs
   where v_from > period_start and v_from <= period_end
   limit 1;
  if v_clash is not null then
    return ops_core.conflict('hr','schedule', v_code,'add',
      'inside_existing_run',
      format('%s mencakup tanggal itu, dan periode itu dihitung dengan aturan yang berlaku '
             'saat dibuka. Pilih tanggal di luar periode yang sudah ada.', v_clash));
  end if;

  select coalesce(max(version), 0) + 1 into v_version from ops_hr.pay_rule_sets;
  insert into ops_hr.pay_rule_sets (version, effective_from, note, rules, created_by)
  values (v_version, v_from, btrim(p_note), v_rules, auth.uid());

  v_res := ops_core.ok('hr','schedule', v_code,'add',
    jsonb_build_object('code', v_code, 'version', v_version, 'effective_from', v_from),
    null,
    v_new || jsonb_build_object('version', v_version, 'effective_from', v_from));
  return ops_core.idem_remember('hr','add_schedule', p_key, v_res);
end $$;

revoke execute on function ops_hr.add_schedule(text, text, int, int, int, int, int, text, date, text, text) from public;
grant execute on function ops_hr.add_schedule(text, text, int, int, int, int, int, text, date, text, text) to authenticated;
