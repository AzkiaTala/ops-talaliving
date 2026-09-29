-- 0186 — a guard's twelve-hour night is one working day, not two halves of nothing.
--
-- ── what was wrong ────────────────────────────────────────────────────────
--
-- The owner's answer to D326's evaluation was *satpam 12 jam lewat hari*: the
-- guard works twelve hours and the shift crosses midnight. Every tap is stored
-- with `work_date = ops_core.office_day(at)`, the WITA calendar day, and
-- `read_day` read one calendar day at a time. So a 19:02 → 07:05 night became
-- two days with one tap each — masuk with no pulang on Monday, masuk with no
-- pulang on Tuesday — and D137 says a day with one stamp is worth nothing. The
-- guard was paid for nothing, and HRD was sent two days to review that were
-- never wrong.
--
-- ── taps stay facts; the reading learns where a day begins (D141) ─────────
--
-- `work_date` is left exactly as it is: the calendar day the tap happened on,
-- a fact. What changes is the **reading**. Every person's day now has a
-- boundary, and a tap belongs to the day whose window contains it:
--
--   - an ordinary pattern: the day begins at midnight, as it always has;
--   - an **overnight** pattern — any pattern whose end is before its start —
--     claims the next morning: the day after it begins not at midnight but at
--     the middle of the off-duty gap. For 19:00–07:00 that is 13:00, so the
--     07:05 tap is read into the evening that began the shift, and a 14:00
--     tap belongs to the shift starting that evening.
--
-- The boundary between day D and day D+1 is decided by **the pattern in force
-- on D** — the day that would claim the morning. So the windows partition the
-- taps with nothing counted twice and nothing dropped, even across the date a
-- person changes pattern or a rule book changes, because both sides of every
-- boundary ask the same question of the same day.
--
-- `day_begins()` and `shift_day()` are that rule, stated once. `read_day`
-- reads through it, `v_timesheet_day` lists days through it, and the payroll,
-- the timesheet, `kpi_measures` and `/profil` all read `read_day` — so they
-- agree without a second derivation (A3).
--
-- ── lateness is measured from the shift's own start ───────────────────────
--
-- Two places computed it as `wita_minutes(in_at) − start`, minutes on the
-- clock face. That is right only while masuk is on the same calendar day as
-- the start. A guard due at 19:00 who arrives at 00:30 is five and a half
-- hours late, and the clock face says 30 − 1140: never late. `late_minutes()`
-- measures elapsed time from the start on the day being read, which is the
-- same number for everybody whose masuk is on that day — checked to the
-- second, including the floor of a negative — and the right one for the night.
--
-- ── what the reading does not know, and says ───────────────────────────────
--
-- `tap_self` (0164) still returns `work_date` as the calendar day in its
-- answer. It is D327's and D332's to change, and this migration does not
-- touch it: the stored row is correct either way, and `shift_day()` is here
-- for it to call when it wants to tell a guard *tercatat untuk shift Senin*.
--
-- ── the guard's hours are a default, and marked as one (D288) ─────────────
--
-- Nobody has said when the guard starts. 19:00–07:00 is the default this
-- migration writes, with `hours_unconfirmed: true` on the pattern so the
-- screen can say *belum dikonfirmasi* rather than letting it read as an answer
-- — F138's lesson, applied before the fact this time. HRD confirms or corrects
-- it in `/hrd/jadwal` through `set_schedule_hours`, which clears the flag.

/* ── how long a pattern's day is, and whether it crosses midnight ─────── */

-- Minutes from start to end, walking forward through midnight when the end is
-- earlier on the clock. Null when either is unstated (D274) — a shift nobody
-- has described has no length, not a length of zero.
create or replace function ops_hr.shift_minutes(p_start int, p_end int)
returns int
language sql immutable set search_path = pg_temp as $$
  select case
    when p_start is null or p_end is null then null
    when p_end > p_start then p_end - p_start
    else p_end + 1440 - p_start
  end
$$;

-- *Any pattern whose end is before its start is overnight* — the whole
-- definition. Equal is not overnight: `schedule_problem` refuses it.
create or replace function ops_hr.is_overnight(p_sc jsonb)
returns boolean
language sql immutable set search_path = ops_hr, pg_temp as $$
  select coalesce(
    ops_hr.minutes_of(p_sc -> 'end_minutes') < ops_hr.minutes_of(p_sc -> 'start_minutes'),
    false)
$$;

-- Where the next day begins, in minutes after midnight, for somebody on this
-- pattern. Zero for an ordinary one. For an overnight one, the middle of the
-- off-duty gap: after pulang, and well before the next masuk. A guard on
-- 19:00–07:00 who stays until 12:59 is still finishing last night; one who
-- arrives at 13:00 is early for tonight.
create or replace function ops_hr.day_boundary_minutes(p_sc jsonb)
returns int
language sql immutable set search_path = ops_hr, pg_temp as $$
  select case when ops_hr.is_overnight(p_sc)
    then (ops_hr.minutes_of(p_sc -> 'end_minutes') + ops_hr.minutes_of(p_sc -> 'start_minutes')) / 2
    else 0 end
$$;

/* ── the pattern in force, whoever is asking ──────────────────────────── */
--
-- `security definer`, and deliberately knowing nothing about people. `read_day`
-- runs as the caller, and the rule book is readable only by HRD, payroll and
-- IT — so for a guard reading their own week on `/profil` the pattern came
-- back null, their night was read as two calendar days, and their screen
-- disagreed with their payslip. That is the one disagreement this migration
-- exists to remove. A pattern is not a secret (0117's reasoning); *who is on
-- which* is, and this answers only for a code and a unit the caller already
-- read off an employee row under their own RLS.
create or replace function ops_hr.pattern_on(p_schedule_code text, p_unit text, p_date date)
returns jsonb
language sql stable security definer set search_path = ops_hr, pg_temp as $$
  select ops_hr.schedule_of(ops_hr.rules_on(p_date), p_schedule_code, p_unit)
$$;

revoke execute on function ops_hr.pattern_on(text, text, date) from public;
grant execute on function ops_hr.pattern_on(text, text, date) to authenticated;

-- The instant day `p_date` begins for this person: midnight WITA, or the
-- boundary the **previous** day's pattern sets when that pattern is overnight.
create or replace function ops_hr.day_begins(p_employee uuid, p_date date)
returns timestamptz
language sql stable set search_path = ops_hr, pg_temp as $$
  -- Read under the caller's RLS: somebody who cannot see the person gets
  -- midnight, and could not see their taps either.
  select (p_date::timestamp + make_interval(mins => coalesce((
            select ops_hr.day_boundary_minutes(ops_hr.pattern_on(e.schedule_code, e.unit, p_date - 1))
              from ops_hr.employees e where e.id = p_employee), 0)))
         at time zone 'Asia/Makassar'
$$;

-- Which working day a tap belongs to. The helper `tap_self` and the import
-- would call if they ever need to say the shift rather than the calendar day —
-- never written into `work_date`, which stays the calendar fact.
create or replace function ops_hr.shift_day(p_employee uuid, p_at timestamptz)
returns date
language sql stable set search_path = ops_hr, ops_core, pg_temp as $$
  select case when p_at < ops_hr.day_begins(p_employee, ops_core.office_day(p_at))
              then ops_core.office_day(p_at) - 1
              else ops_core.office_day(p_at) end
$$;

-- Minutes past the start of the day being read, past the grace. Negative when
-- early; the callers clamp or compare as they did before.
create or replace function ops_hr.late_minutes(
  p_in_at timestamptz, p_work_date date, p_start int, p_grace int)
returns int
language sql immutable set search_path = pg_temp as $$
  select case when p_in_at is null or p_start is null then null
    else floor(extract(epoch from
           p_in_at - ((p_work_date::timestamp + make_interval(mins => p_start)) at time zone 'Asia/Makassar'))
           / 60)::int - coalesce(p_grace, 0) end
$$;

grant execute on function
  ops_hr.shift_minutes(int, int),
  ops_hr.is_overnight(jsonb),
  ops_hr.day_boundary_minutes(jsonb),
  ops_hr.day_begins(uuid, date),
  ops_hr.shift_day(uuid, timestamptz),
  ops_hr.late_minutes(timestamptz, date, int, int)
  to authenticated;

/* ── the reading carries its own window ───────────────────────────────── */
--
-- The client lists a day's taps beside its reading. Until now it matched them
-- by `work_date`, which is exactly the calendar split this fixes; given the
-- window the database used, the client shows the taps the reading read and
-- decides nothing again. `overnight` is there so a screen can say *shift
-- malam* rather than leave a 07:05 pulang looking like a typo.
alter type ops_hr.day_reading
  add attribute window_from timestamptz cascade,
  add attribute window_to   timestamptz cascade,
  add attribute overnight   boolean     cascade;

alter type ops_hr.timesheet_row
  add attribute window_from timestamptz cascade,
  add attribute window_to   timestamptz cascade,
  add attribute overnight   boolean     cascade;

/* ── one day, read ────────────────────────────────────────────────────── */
--
-- Restated from `0053`. What changed, and nothing else:
--   1. taps are chosen by the window `[day_begins(D), day_begins(D+1))`
--      rather than `work_date = D`;
--   2. on an overnight pattern the slots are read against the shift's own
--      clock (below), not the day windows 11:00 / 14:30, which a night never
--      passes through;
--   3. the three new attributes are returned.
-- The marks, the states and the sentences are verbatim: a guard's missing
-- morning tap is exactly the `review` an ordinary one-tap day is.
create or replace function ops_hr.read_day(p_employee uuid, p_date date)
returns setof ops_hr.day_reading
language plpgsql stable set search_path = ops_hr, pg_temp as $$
declare
  emp           ops_hr.employees%rowtype;
  v_rules       jsonb;
  tap           record;
  kept          timestamptz[] := '{}';
  prev          timestamptz;
  rest          timestamptz[];
  v_in          timestamptz; v_bout timestamptz; v_bin timestamptz;
  v_out         timestamptz; v_ots  timestamptz; v_ote timestamptz;
  pick          timestamptz;
  n_taps        int;
  v_issues      text[] := '{}';
  v_notes       text[] := '{}';
  v_break       numeric := 0;
  v_work        numeric := 0;
  v_ot          numeric := 0;
  allowed       int;
  mk            record;
  v_value       numeric := 0;
  v_state       ops_hr.day_state_t;
  v_why         text;
  taken_before  int;
  has_letter    boolean;
  leftover      text;
  v_sc          jsonb;
  v_night       boolean;
  v_from        timestamptz;
  v_to          timestamptz;
  v_out_from    timestamptz;
begin
  select * into emp from ops_hr.employees where id = p_employee;
  if not found then return; end if;
  v_rules := ops_hr.rules_on(p_date);
  v_sc    := ops_hr.pattern_on(emp.schedule_code, emp.unit, p_date);
  v_night := ops_hr.is_overnight(v_sc);
  v_from  := ops_hr.day_begins(p_employee, p_date);
  v_to    := ops_hr.day_begins(p_employee, p_date + 1);

  /* The taps, de-duplicated. A reader scanned twice inside two minutes is one
     arrival, not two — the real export has 29 of them. Two minutes is long
     enough to swallow a finger that did not take the first time and short
     enough to keep a genuine second tap eleven minutes later, which is a
     different event somebody has to look at (D141).

     The `work_date` pair is only there so the index is used: the window never
     reaches outside the day and the one after it. */
  for tap in
    select s.at from ops_hr.attendance_scans s
     where s.employee_id = p_employee
       and s.work_date between p_date and p_date + 1
       and s.at >= v_from and s.at < v_to
     order by s.at
  loop
    if prev is null or tap.at - prev >= interval '2 minutes' then
      kept := kept || tap.at;
      prev := tap.at;
    end if;
  end loop;

  n_taps := coalesce(array_length(kept, 1), 0);
  rest := kept;

  /* Each slot takes the first remaining tap that fits, and removes it. The
     windows are the reading, and they are written here rather than buried
     because every reading can be wrong. */
  if n_taps > 0 and not v_night then
    v_in := rest[1];
    rest := rest[2:];

    select t into pick from unnest(rest) t
      where ops_hr.wita_minutes(t) >= 11*60 and ops_hr.wita_minutes(t) < 13*60+30
      order by t limit 1;
    if pick is not null then v_bout := pick; rest := array_remove(rest, pick); pick := null; end if;

    select t into pick from unnest(rest) t
      where ops_hr.wita_minutes(t) >= 11*60+30 and ops_hr.wita_minutes(t) < 14*60+30
      order by t limit 1;
    if pick is not null then v_bin := pick; rest := array_remove(rest, pick); pick := null; end if;

    select t into pick from unnest(rest) t
      where ops_hr.wita_minutes(t) >= 14*60+30
      order by t limit 1;
    if pick is not null then v_out := pick; rest := array_remove(rest, pick); pick := null; end if;

  elsif n_taps > 0 then
    /* The night, read against its own clock. Pulang is the first tap in the
       last stretch of the shift — its final three hours, or its second half
       if it is shorter than six — which is where the day reading's 14:30 sits
       for an office that finishes at 17:15. A guard who leaves at 02:00 has no
       pulang and goes to review, rather than being read as a short night
       nobody looked at. Anything between masuk and that stretch is the break
       going out and coming back. */
    v_out_from := ((p_date + 1)::timestamp
                   + make_interval(mins => ops_hr.minutes_of(v_sc -> 'end_minutes')))
                  at time zone 'Asia/Makassar'
                  - make_interval(mins => least(180,
                      ops_hr.shift_minutes(ops_hr.minutes_of(v_sc -> 'start_minutes'),
                                           ops_hr.minutes_of(v_sc -> 'end_minutes')) / 2));
    v_in := rest[1];
    rest := rest[2:];

    select t into pick from unnest(rest) t where t < v_out_from order by t limit 1;
    if pick is not null then v_bout := pick; rest := array_remove(rest, pick); pick := null; end if;

    select t into pick from unnest(rest) t where t < v_out_from order by t limit 1;
    if pick is not null then v_bin := pick; rest := array_remove(rest, pick); pick := null; end if;

    select t into pick from unnest(rest) t where t >= v_out_from order by t limit 1;
    if pick is not null then v_out := pick; rest := array_remove(rest, pick); pick := null; end if;
  end if;

  if v_out is not null then
    select t into pick from unnest(rest) t where t > v_out order by t limit 1;
    if pick is not null then v_ots := pick; rest := array_remove(rest, pick); pick := null; end if;
  end if;

  if v_ots is not null then
    select t into pick from unnest(rest) t where t > v_ots order by t limit 1;
    if pick is not null then v_ote := pick; rest := array_remove(rest, pick); pick := null; end if;
  end if;

  v_break := ops_hr.span_hours(v_bout, v_bin);
  v_work  := greatest(round(ops_hr.span_hours(v_in, v_out) - v_break, 2), 0);
  v_ot    := ops_hr.span_hours(v_ots, v_ote);

  /* Anything the rule could not place. Left-over taps are the loudest signal
     that a day needs a person: they are real events nobody has explained. */
  if coalesce(array_length(rest, 1), 0) > 0 then
    select string_agg(to_char(t at time zone 'Asia/Makassar', 'HH24:MI'), ', ' order by t)
      into leftover from unnest(rest) t;
    v_issues := v_issues || format('%s tap(s) the rule could not place: %s', array_length(rest,1), leftover);
  end if;

  if n_taps > 0 then
    if v_out is null then v_issues := v_issues || 'No pulang — the day has no end'::text; end if;
    /* A guard on post does not go out to eat, so a night with no break taps
       at all is a whole night, not an incomplete one. Half a break is still
       half a break. */
    if (not v_night and (v_bout is null or v_bin is null))
       or (v_night and v_bout is not null and v_bin is null) then
      v_issues := v_issues || 'Istirahat incomplete'::text;
    end if;
    if v_ots is not null and v_ote is null then v_issues := v_issues || 'Lembur started and never finished'::text; end if;

    /* A break that ran past its allowance is **reported, never deducted** — it
       is a fact about a day, and turning it into money is the same decision
       lateness has been waiting on since D251. */
    allowed := ops_hr.break_allowance(v_rules, emp.schedule_code, emp.unit, p_date);
    if allowed is not null and v_break * 60 > allowed then
      v_notes := v_notes || format('Istirahat %s menit, lewat %s menit dari jatah %s menit',
        round(v_break*60), round(v_break*60) - allowed, allowed);
    end if;
  end if;

  /* The mark, if there is one, and **the office-wide one wins** (F101, the
     owner's ruling of 2026-09-18). 0045 had it the other way round on my own
     reading of specific-over-general; the owner's answer is that a closed day
     is closed for everybody — *kantor tutup, artinya kita tidak membayar
     siapapun, di luar jadwal kerja* — so a personal mark on it is neither an
     absence nor a permit, and it takes nothing from anybody's entitlement. */
  select m.mark_no, m.kind, m.work_date into mk
    from ops_hr.day_marks m
   where m.work_date = p_date
     and (m.employee_id = p_employee or m.employee_id is null)
     and m.withdrawn_at is null
   order by (m.employee_id is null) desc
   limit 1;

  if mk.mark_no is not null then
    v_state := 'marked';
    case mk.kind
      when 'half_day' then
        v_value := 0.5; v_why := 'Setengah hari — dibayar 0,5 hari.';
      when 'holiday' then
        v_value := 0;
        v_why := case when v_work > 0
          then 'Tanggal merah — jam yang dikerjakan dihitung lembur, harinya sendiri tidak.'
          else 'Tanggal merah — bukan hari kerja.' end;
      when 'sick' then
        select exists (
          select 1 from ops_core.attachment_links l
           where l.entity = 'day_mark' and l.entity_no = mk.mark_no
             and l.kind = 'surat_dokter' and l.unlinked_at is null
        ) into has_letter;
        v_value := case when has_letter then 1 else 0 end;
        v_why := case when has_letter
          then 'Sakit dengan surat dokter — dibayar penuh.'
          else 'Sakit tanpa surat dokter — tidak dibayar.' end;
      when 'leave' then
        select count(*) into taken_before from ops_hr.day_marks m2
         where m2.kind = 'leave' and m2.employee_id = p_employee
           and m2.withdrawn_at is null
           and extract(year from m2.work_date) = extract(year from p_date)
           and m2.work_date < p_date
           and not ops_hr.office_closed(m2.work_date);
        if emp.paid_leave_days - taken_before > 0 then
          v_value := 1;
          v_why := format('Cuti berbayar — sisa hak cuti %s hari sebelum hari ini, dari %s.',
                          emp.paid_leave_days - taken_before, emp.paid_leave_days);
        else
          v_value := 0;
          v_why := format('Cuti di luar hak — jatah %s hari tahun ini sudah habis.', emp.paid_leave_days);
        end if;
      when 'permit' then
        v_value := 0; v_why := 'Izin — tercatat, tidak dibayar.';
      else
        v_value := 0; v_why := 'Tidak masuk tanpa keterangan — tidak dibayar.';
    end case;

    if mk.kind = 'holiday' then
      /* Tanggal merah: being here at all is overtime (owner). The day itself
         is not a working day, so it adds no day_value — the hours do. */
      v_ot := case when v_work > 0 then v_work else v_ot end;
      v_work := 0;
    elsif mk.kind <> 'half_day' then
      /* Away is away: no hours are counted for a day somebody did not work,
         whether or not it is paid. The taps themselves stay untouched — it is
         the counting that stops, not the record (D142). */
      v_work := 0; v_break := 0; v_ot := 0;
    end if;

  elsif n_taps = 0 then
    v_state := 'off'; v_value := 0;
    v_why := 'Tidak ada absensi sama sekali pada hari ini.';
  elsif array_length(v_issues, 1) > 0 then
    v_state := 'review'; v_value := 0;
    v_why := 'Belum dibaca — absensi hari ini tidak lengkap, jadi belum bernilai.';
  else
    v_state := 'complete'; v_value := 1;
    v_why := 'Hari kerja penuh.';
  end if;

  return query select
    p_employee, p_date, v_in, v_bout, v_bin, v_out, v_ots, v_ote,
    n_taps, coalesce(array_length(rest,1), 0),
    v_work, v_break, v_ot, v_value, v_state,
    mk.mark_no, mk.kind, v_why, v_issues, v_notes,
    v_from, v_to, v_night;
end $$;

/* ── the days that have something on them ─────────────────────────────── */
--
-- From `0048`, with the day a tap is listed under read through `shift_day`.
-- Listing by `work_date` would still put an empty *Tuesday* on the timesheet
-- for a guard whose Tuesday-morning tap belongs to Monday night — a day with
-- nothing in it, which reads `off` and asks HRD to explain an absence that
-- never happened.
create or replace view ops_hr.v_timesheet_day as
select e.employee_no, e.full_name, d.*
  from ops_hr.employees e
  join lateral (
    select distinct ops_hr.shift_day(e.id, s.at) as work_date
      from ops_hr.attendance_scans s where s.employee_id = e.id
    union
    select distinct m.work_date from ops_hr.day_marks m
     where m.employee_id = e.id or m.employee_id is null
  ) days on true
  cross join lateral ops_hr.read_day(e.id, days.work_date) d;

alter view ops_hr.v_timesheet_day set (security_invoker = on);

/* ── the timesheet rows, with the window ──────────────────────────────── */
-- Restated from `0057`; the last three columns are new.
create or replace function ops_hr.timesheet_rows(
  p_from date, p_to date, p_unit text default null, p_employee_no text default null)
returns setof ops_hr.timesheet_row
language sql stable set search_path = ops_hr, pg_temp as $$
  select
    d.employee_id, e.employee_no, e.full_name, d.work_date,
    d.in_at, d.break_out_at, d.break_in_at, d.out_at, d.ot_start_at, d.ot_end_at,
    d.work_hours, d.break_hours, d.overtime_hours, d.day_value, d.state,
    d.mark_no, d.mark_kind, d.why,
    case
      -- The letter is what makes it paid, and it can still arrive.
      when d.mark_kind = 'sick'  and d.day_value = 0
        then 'Surat dokter belum ada — dengan suratnya, hari ini dibayar penuh.'
      -- Past the entitlement is not fixable by paperwork, and still worth a
      -- sentence: it is why the day is unpaid.
      when d.mark_kind = 'leave' and d.day_value = 0
        then 'Jatah cuti tahun ini sudah habis — hari ini tercatat, tidak dibayar.'
      end,
    d.issues, d.notes,
    d.window_from, d.window_to, d.overnight
  from ops_hr.employees e
  cross join lateral generate_series(p_from, p_to, interval '1 day') g(day)
  cross join lateral ops_hr.read_day(e.id, g.day::date) d
  where e.active
    and (p_unit is null or e.unit = p_unit)
    and (p_employee_no is null or e.employee_no = p_employee_no)
  order by e.employee_no, d.work_date
$$;

/* ── what a pattern may say, now that it may cross midnight ───────────── */
--
-- Restated from `0117`. `end_before_start` now fires only when the two are
-- **equal** — a pattern with no length. An end earlier on the clock is a night
-- (D330). The lengths are walked forward through midnight, and a night may not
-- carry its own Friday finishing time yet: Friday's shift ends on Saturday
-- morning, and a field that means *Friday 16.30* for the office cannot also
-- mean *Saturday 05.00* for the guard without somebody deciding it does.
--
-- The sentences are transcriptions of `schedule-rules.ts`, and
-- `check-schedule-rules.mjs` refuses any drift between the two.
create or replace function ops_hr.schedule_problem(p_rules jsonb)
returns jsonb
language plpgsql immutable set search_path = ops_hr, pg_temp as $$
declare
  sc      jsonb;
  i       int := 0;
  v_code  text;
  v_where text;
  seen    text[] := '{}';
  st int; en int; br int; fen int; fbr int;
  f_end int; f_break int;
  span int; f_span int;
  night boolean;
  u record;
begin
  -- No patterns at all is a valid book — it was the answer until M57 — and a
  -- missing key is not a malformed one.
  if p_rules is null or jsonb_typeof(p_rules -> 'schedules') is distinct from 'array' then
    return null;
  end if;

  for sc in select value from jsonb_array_elements(p_rules -> 'schedules') loop
    i := i + 1;
    v_code := btrim(coalesce(sc ->> 'code', ''));
    v_where := case when v_code = '' then 'Pola ke-' || i else 'Pola ' || v_code end;

    if v_code = '' then
      return jsonb_build_object('code','code_required',
        'message', v_where || ' belum punya kode.');
    elsif v_code !~ '^[A-Z][A-Z0-9_-]*$' then
      return jsonb_build_object('code','code_shape',
        'message', v_where || ': kode dipakai sebagai kunci di data karyawan, '
                || 'jadi hanya huruf besar, angka, garis bawah dan tanda hubung, diawali huruf.');
    elsif v_code = any(seen) then
      return jsonb_build_object('code','code_duplicate',
        'message', v_where || ' muncul dua kali. Dua pola dengan kode sama berarti '
                || 'orang yang terpasang padanya bisa terbaca sebagai salah satu dari keduanya.');
    end if;
    seen := seen || v_code;

    if btrim(coalesce(sc ->> 'name', '')) = '' then
      return jsonb_build_object('code','name_required',
        'message', v_where || ' belum punya nama.');
    end if;

    if ops_hr.bad_minutes(sc -> 'start_minutes') then
      return jsonb_build_object('code','minutes_range',
        'message', v_where || ': jam masuk harus menit dalam sehari (0–1440) atau dikosongkan.');
    end if;
    if ops_hr.bad_minutes(sc -> 'end_minutes') then
      return jsonb_build_object('code','minutes_range',
        'message', v_where || ': jam pulang harus menit dalam sehari (0–1440) atau dikosongkan.');
    end if;
    if ops_hr.bad_minutes(sc -> 'break_minutes') then
      return jsonb_build_object('code','minutes_range',
        'message', v_where || ': istirahat harus menit dalam sehari (0–1440) atau dikosongkan.');
    end if;
    if ops_hr.bad_minutes(sc -> 'friday_break_minutes') then
      return jsonb_build_object('code','minutes_range',
        'message', v_where || ': istirahat Jumat harus menit dalam sehari (0–1440) atau dikosongkan.');
    end if;
    if ops_hr.bad_minutes(sc -> 'friday_end_minutes') then
      return jsonb_build_object('code','minutes_range',
        'message', v_where || ': jam pulang Jumat harus menit dalam sehari (0–1440) atau dikosongkan.');
    end if;

    st  := ops_hr.minutes_of(sc -> 'start_minutes');
    en  := ops_hr.minutes_of(sc -> 'end_minutes');
    br  := ops_hr.minutes_of(sc -> 'break_minutes');
    fen := ops_hr.minutes_of(sc -> 'friday_end_minutes');
    fbr := ops_hr.minutes_of(sc -> 'friday_break_minutes');

    if st is not null and en is not null and en = st then
      return jsonb_build_object('code','end_before_start',
        'message', v_where || ': pulang ' || ops_hr.clock_face(en)
                || ' tidak sesudah masuk ' || ops_hr.clock_face(st) || '.');
    end if;

    night := st is not null and en is not null and en < st;
    span  := ops_hr.shift_minutes(st, en);

    -- A break that eats the whole day leaves nought hours, and nought hours is
    -- not a schedule — it is a row that quietly values every day at zero for
    -- whoever is on it.
    if span is not null and br is not null and br >= span then
      return jsonb_build_object('code','break_too_long',
        'message', v_where || ': istirahat ' || br || ' menit menghabiskan seluruh hari kerja '
                || ops_hr.clock_face(st) || '–' || ops_hr.clock_face(en) || '.');
    end if;

    if night and fen is not null then
      return jsonb_build_object('code','overnight_friday_end',
        'message', v_where || ': shift ini melewati tengah malam, jadi jam pulang Jumat '
                || 'belum bisa diatur — kosongkan; shift Jumat malam pulang pada jam pulang biasa.');
    end if;

    if not night and st is not null and fen is not null and fen <= st then
      return jsonb_build_object('code','friday_end_before_start',
        'message', v_where || ': pulang Jumat ' || ops_hr.clock_face(fen)
                || ' tidak sesudah masuk ' || ops_hr.clock_face(st) || '.');
    end if;

    -- Friday's two halves fall back independently (D289), so its arithmetic is
    -- checked on the pair it will actually be computed from — an ordinary
    -- break can be too long for a Friday that finishes early.
    f_end   := coalesce(fen, en);
    f_break := coalesce(fbr, br);
    f_span  := case when night then span
                    when st is not null and f_end is not null and f_end > st then f_end - st end;
    if f_span is not null and f_break is not null and f_break >= f_span then
      return jsonb_build_object('code','friday_break_too_long',
        'message', v_where || ': istirahat Jumat ' || f_break || ' menit menghabiskan seluruh hari Jumat '
                || ops_hr.clock_face(st) || '–' || ops_hr.clock_face(f_end) || '.');
    end if;
  end loop;

  /* A unit pointing at a pattern that is not there is worse than a unit
     pointing at nothing: nothing falls back to the company clock and says so,
     while a dangling code resolves to no schedule at all and reads as
     *belum ditetapkan* for everybody in that unit, with no sign of why.
     `collate "C"`: see 0117 and F143. */
  for u in
    select key, value from jsonb_each_text(coalesce(p_rules -> 'schedule_by_unit', '{}'::jsonb))
    order by key collate "C"
  loop
    if not (u.value = any(seen)) then
      return jsonb_build_object('code','unit_unknown_code',
        'message', 'Unit ' || u.key || ' dipasang ke pola ' || u.value
                || ', dan pola itu tidak ada di daftar.');
    end if;
  end loop;

  return null;
end $$;

/* ── the week and the month, through midnight ─────────────────────────── */
--
-- Restated from `0113`. The day's length is `shift_minutes`, which walks
-- through midnight — `end − start` gave the guard minus seven hundred and
-- twenty minutes. Three fields are added for the screen: whether the pattern
-- is a night, where its next day begins, and whether its hours are a default
-- nobody has confirmed (D288, D330).
create or replace function ops_hr.schedule_roll()
returns jsonb
language sql stable set search_path = ops_hr, pg_temp as $$
  with rules as (select ops_hr.rules_on(ops_core.office_day()) as r),
  days as (
    select case when (select r ->> 'week_pattern' from rules) = '5day' then 5 else 6 end as n
  ),
  sc as (
    select s.value as j, s.value ->> 'code' as code
      from rules, jsonb_array_elements(coalesce(rules.r -> 'schedules','[]'::jsonb)) s
  ),
  people as (
    select e.employee_no, e.full_name, e.unit, e.schedule_code,
           -- The pattern actually in force: what HR linked, else what the unit
           -- defaults to, else nothing at all.
           coalesce(e.schedule_code,
                    (select r -> 'schedule_by_unit' ->> e.unit from rules)) as effective
      from ops_hr.employees e where e.active
  ),
  hours as (
    select sc.code, sc.j,
      (sc.j ->> 'start_minutes')::int         as st,
      (sc.j ->> 'end_minutes')::int           as en,
      (sc.j ->> 'break_minutes')::int         as br,
      (sc.j ->> 'friday_break_minutes')::int  as fbr,
      (sc.j ->> 'friday_end_minutes')::int    as fen
    from sc
  ),
  figured as (
    select h.code, h.j,
      case when h.st is null or h.en is null or h.br is null then null
           else round((ops_hr.shift_minutes(h.st, h.en) - h.br) / 60.0, 2) end as daily,
      -- Friday differs if either field says so, and each missing half falls
      -- back to the ordinary day rather than to nothing.
      case when h.st is null or h.en is null or h.br is null then null
           when h.fbr is null and h.fen is null then null
           else round((ops_hr.shift_minutes(h.st, coalesce(h.fen, h.en)) - coalesce(h.fbr, h.br)) / 60.0, 2)
      end as friday,
      -- What is stopping the figures, in words. A schedule nobody has finished
      -- describing is not a schedule of zero hours.
      nullif(concat_ws(', ',
        case when h.st  is null then 'jam masuk' end,
        case when h.en  is null then 'jam pulang' end,
        case when h.br  is null then 'istirahat' end), '') as missing
    from hours h
  )
  select jsonb_build_object(
    'week_pattern', (select r ->> 'week_pattern' from rules),
    'schedules', coalesce((
      select jsonb_agg(jsonb_build_object(
        'code', f.code,
        'name', f.j ->> 'name',
        'start_minutes', (f.j ->> 'start_minutes')::int,
        'end_minutes', (f.j ->> 'end_minutes')::int,
        'break_minutes', (f.j ->> 'break_minutes')::int,
        'friday_break_minutes', (f.j ->> 'friday_break_minutes')::int,
        'friday_end_minutes', (f.j ->> 'friday_end_minutes')::int,
        'note', f.j ->> 'note',
        'hours_unconfirmed', coalesce((f.j ->> 'hours_unconfirmed')::boolean, false),
        'overnight', ops_hr.is_overnight(f.j),
        'day_boundary_minutes', ops_hr.day_boundary_minutes(f.j),
        'hours', jsonb_build_object(
          'daily_hours', f.daily,
          'friday_hours', f.friday,
          'days_per_week', (select n from days),
          'weekly_hours', case when f.daily is null then null
            when f.friday is null then round(f.daily * (select n from days), 2)
            else round(f.daily * ((select n from days) - 1) + f.friday, 2) end,
          'monthly_hours', case when f.daily is null then null
            else round((case when f.friday is null then f.daily * (select n from days)
                             else f.daily * ((select n from days) - 1) + f.friday end)
                       * 52 / 12.0, 2) end,
          'blocked_by', case when f.missing is null then null
                             else 'Belum ada ' || f.missing || ' — jamnya belum bisa dihitung.' end),
        -- Linked **by name**, which is a decision somebody took.
        'assigned', (select count(*) from people p where p.schedule_code = f.code),
        -- On it by assumption only.
        'inherited', (select count(*) from people p
                       where p.schedule_code is null and p.effective = f.code),
        'units', coalesce((select jsonb_agg(u.key order by u.key)
                             from rules, jsonb_each_text(coalesce(rules.r -> 'schedule_by_unit','{}'::jsonb)) u
                            where u.value = f.code), '[]'::jsonb)))
      from figured f), '[]'::jsonb),
    'unlinked', coalesce((
      select jsonb_agg(jsonb_build_object('employee_no', p.employee_no,
                                          'full_name', p.full_name, 'unit', p.unit)
                       order by p.employee_no)
        from people p where p.effective is null), '[]'::jsonb),
    'inherited', coalesce((
      select jsonb_agg(jsonb_build_object('employee_no', p.employee_no,
                                          'full_name', p.full_name, 'unit', p.unit,
                                          'schedule_code', p.effective)
                       order by p.employee_no)
        from people p where p.schedule_code is null and p.effective is not null), '[]'::jsonb))
$$;

/* ── HRD sets a pattern's hours ───────────────────────────────────────── */
--
-- The rule book is IT's hands (D173), and until now that included every
-- pattern's clock. But *when does the guard start* is HRD's question to answer,
-- and D330 asks for it to be answered where HRD already looks at patterns.
-- So this seam writes exactly one thing — one pattern's start, end and break —
-- as a **new dated version** of the book in force on that date, with every
-- other rule copied untouched. It is the book's own history that records who
-- changed the guard's hours and when, not a column beside it.
--
-- Everything `save_pay_rules` refuses, this refuses too, with the same
-- sentences: the shape (`schedule_problem`), money already paid, a date inside
-- a run. And one more of its own: a version dated **after** this one would not
-- carry the change and would quietly undo it on its date, so that is refused
-- rather than half-applied.
--
-- Saving clears `hours_unconfirmed`. Typing the default in is how HRD
-- confirms it; that is a decision with a name on it, which is all D288 asks.
create or replace function ops_hr.set_schedule_hours(
  p_code           text,
  p_start_minutes  int,
  p_end_minutes    int,
  p_break_minutes  int,
  p_effective_from date,
  p_note           text,
  p_key            text default null)
returns jsonb
language plpgsql security definer set search_path = ops_hr, ops_core, pg_temp as $$
declare
  v_replayed jsonb; v_res jsonb; v_from date; v_base ops_hr.pay_rule_sets;
  v_later ops_hr.pay_rule_sets; v_old jsonb; v_rules jsonb; v_problem jsonb;
  v_spent text; v_clash text; v_version int; v_id uuid;
begin
  v_replayed := ops_core.idem_replay('hr','set_schedule_hours', p_key);
  if v_replayed is not null then return v_replayed; end if;

  if not ops_core.has_permission('hrd.update') then
    return ops_core.refused('hr','schedule', p_code,'set_hours',
      'not_permitted','Mengubah jam pola kerja butuh akses HRD.');
  end if;
  if coalesce(btrim(coalesce(p_note,'')), '') = '' then
    return ops_core.invalid('hr','schedule', p_code,'set_hours',
      'note_required',
      'Tulis alasannya. Jam kerja yang berubah tanpa keterangan tidak bisa dijelaskan ke orang yang jamnya berubah.',
      jsonb_build_object('field','note'));
  end if;

  v_from := coalesce(p_effective_from, ops_core.office_day());

  select * into v_base from ops_hr.pay_rule_sets
   where effective_from <= v_from
   order by effective_from desc, version desc limit 1;
  if not found then
    return ops_core.conflict('hr','schedule', p_code,'set_hours',
      'no_rule_book',
      format('Belum ada buku aturan gaji yang berlaku pada %s. IT menerbitkannya dulu.', v_from));
  end if;

  select * into v_later from ops_hr.pay_rule_sets
   where effective_from > v_from
   order by effective_from, version limit 1;
  if found then
    return ops_core.conflict('hr','schedule', p_code,'set_hours',
      'later_version_exists',
      format('Versi %s berlaku mulai %s, sesudah tanggal ini, dan tidak memuat perubahan ini — '
             'jamnya akan kembali pada tanggal itu. Pilih tanggal mulai %s atau sesudahnya.',
             v_later.version, v_later.effective_from, v_later.effective_from));
  end if;

  select s.value into v_old
    from jsonb_array_elements(coalesce(v_base.rules -> 'schedules','[]'::jsonb)) s
   where s.value ->> 'code' = p_code;
  if v_old is null then
    return ops_core.not_found('hr','schedule', p_code,'set_hours',
      format('Tidak ada jadwal kerja bernama %s di buku aturan yang berlaku.', p_code));
  end if;

  v_rules := jsonb_set(v_base.rules, '{schedules}', (
    select jsonb_agg(
             case when s.value ->> 'code' = p_code
               then (s.value - 'hours_unconfirmed') || jsonb_build_object(
                      'start_minutes', p_start_minutes,
                      'end_minutes',   p_end_minutes,
                      'break_minutes', p_break_minutes)
               else s.value end
             order by s.ord)
      from jsonb_array_elements(v_base.rules -> 'schedules') with ordinality s(value, ord)));

  if v_rules = v_base.rules then
    return ops_core.noop('hr','schedule', p_code,'set_hours',
      'Jamnya sudah itu.', jsonb_build_object('code', p_code, 'version', v_base.version));
  end if;

  v_problem := ops_hr.schedule_problem(v_rules);
  if v_problem is not null then
    return ops_core.invalid('hr','schedule', p_code,'set_hours',
      v_problem ->> 'code', v_problem ->> 'message',
      jsonb_build_object('field','schedules'));
  end if;

  select run_no into v_spent from ops_hr.payroll_runs
   where status <> 'DRAFT' and period_end >= v_from
   order by period_start limit 1;
  if v_spent is not null then
    return ops_core.conflict('hr','schedule', p_code,'set_hours',
      'already_paid',
      format('%s sudah ditandatangani untuk periode yang berakhir %s atau sesudahnya. '
             'Aturan tidak bisa mundur melewati uang yang sudah dibayarkan — '
             'terbitkan yang baru berlaku setelahnya.', v_spent, v_from));
  end if;

  select run_no into v_clash from ops_hr.payroll_runs
   where v_from > period_start and v_from <= period_end
   limit 1;
  if v_clash is not null then
    return ops_core.conflict('hr','schedule', p_code,'set_hours',
      'inside_existing_run',
      format('%s mencakup tanggal itu, dan periode itu dihitung dengan aturan yang berlaku '
             'saat dibuka. Pilih tanggal di luar periode yang sudah ada.', v_clash));
  end if;

  select coalesce(max(version), 0) + 1 into v_version from ops_hr.pay_rule_sets;
  insert into ops_hr.pay_rule_sets (version, effective_from, note, rules, created_by)
  values (v_version, v_from, btrim(p_note), v_rules, auth.uid())
  returning id into v_id;

  v_res := ops_core.ok('hr','schedule', p_code,'set_hours',
    jsonb_build_object('code', p_code, 'version', v_version, 'effective_from', v_from),
    jsonb_build_object('start_minutes', v_old -> 'start_minutes',
                       'end_minutes', v_old -> 'end_minutes',
                       'break_minutes', v_old -> 'break_minutes',
                       'hours_unconfirmed', coalesce(v_old -> 'hours_unconfirmed', 'false'::jsonb)),
    jsonb_build_object('start_minutes', p_start_minutes, 'end_minutes', p_end_minutes,
                       'break_minutes', p_break_minutes, 'version', v_version,
                       'effective_from', v_from));
  return ops_core.idem_remember('hr','set_schedule_hours', p_key, v_res);
end $$;

revoke execute on function ops_hr.set_schedule_hours(text, int, int, int, date, text, text) from public;
grant execute on function ops_hr.set_schedule_hours(text, int, int, int, date, text, text) to authenticated;

/* ── lateness, from the shift's own start ─────────────────────────────── */
--
-- The next two are restated **verbatim** from `0119` and `0064`, with one line
-- changed in each: the clock-face subtraction becomes `late_minutes()`. Copied
-- rather than retyped, and `diff` against the originals shows exactly that one
-- line.
create or replace function ops_hr.payroll_line_for(
  p_employee uuid, p_from date, p_to date, p_run_no text default null)
returns ops_hr.payroll_figures
language plpgsql stable set search_path = ops_hr, pg_temp as $$
declare
  emp       ops_hr.employees%rowtype;
  v_rules   jsonb;
  rate      ops_hr.hourly_rate_t;
  d         ops_hr.day_reading;
  out_row   ops_hr.payroll_figures;
  sc        jsonb;
  day_start int;
  grace     int;
  ut_mode   text;
  ut_grace  numeric;
  short     numeric := 0;
  half_days int := 0;
  gap       numeric;
  is_present boolean;
  withheld  boolean;
  n_present int := 0;
  n_withheld int := 0;
  shown_ot  numeric := 0;
  pending_ot numeric := 0;
  no_letter int := 0;
  over_leave int := 0;
  late_one  int;
  w         text[] := '{}';
  v_days    jsonb := '[]'::jsonb;
begin
  select * into emp from ops_hr.employees where id = p_employee;
  if not found then return null; end if;
  /* The book in force **when the period opened**, which is the whole reason
     the rule book is dated (D173). */
  v_rules  := ops_hr.rules_on(p_from);
  rate     := ops_hr.hourly_rate(emp, v_rules);
  sc       := ops_hr.schedule_of(v_rules, emp.schedule_code, emp.unit);
  day_start := coalesce((sc->>'start_minutes')::int, (v_rules->>'day_starts_minutes')::int);
  grace    := coalesce((v_rules->>'late_grace_minutes')::int, 0);
  ut_mode  := coalesce(v_rules->>'undertime_mode', 'off');
  ut_grace := coalesce((v_rules->>'undertime_grace_minutes')::numeric, 0) / 60;

  out_row.run_no := coalesce(p_run_no, '');
  out_row.employee_id := emp.id;
  out_row.employee_no := emp.employee_no;
  out_row.full_name := emp.full_name;
  -- Who this is, which a payslip prints and the contract has always asked for.
  out_row.position := emp.position;
  out_row.pay_basis := emp.pay_basis;
  out_row.base_rate := emp.base_rate;
  out_row.allowance_rate := emp.allowance_rate;
  out_row.worked_days := 0; out_row.open_days := 0;
  out_row.days_present := 0; out_row.days_sick_paid := 0;
  out_row.days_leave_paid := 0; out_row.days_unpaid := 0;
  out_row.normal_hours := 0;
  out_row.late_minutes := 0;
  out_row.late_days := 0;

  for d in select * from ops_hr.timesheet(emp.id, p_from, p_to) loop
    out_row.worked_days := out_row.worked_days + d.day_value;
    if d.state = 'review' then out_row.open_days := out_row.open_days + 1; end if;
    if d.day_value > 0 then out_row.normal_hours := out_row.normal_hours + d.work_hours; end if;
    shown_ot := shown_ot + d.overtime_hours;

    /* The slip's own line for this day, built where the day is already in
       hand. `open` is carried rather than dropped: a day with hours beside it
       that adds nothing to the total is the one worth asking about (D156). */
    v_days := v_days || jsonb_build_object(
      'work_date', d.work_date,
      'weekday', extract(isodow from d.work_date)::int,
      'in_at', d.in_at,
      'out_at', d.out_at,
      'work_hours', d.work_hours,
      'overtime_hours', d.overtime_hours,
      'mark', case d.mark_kind
                when 'holiday'  then 'merah'
                when 'sick'     then 'sakit'
                when 'leave'    then 'cuti'
                when 'half_day' then 'setengah'
                when 'absent'   then 'alpa'
                else d.mark_kind::text end,
      'day_value', d.day_value,
      'open', d.state = 'review');

    /* What the paid days are made of, so a payslip can say it rather than
       showing one total nobody can take apart (D144). */
    if d.mark_kind is null then
      if d.day_value > 0 then out_row.days_present := out_row.days_present + d.day_value; end if;
    else
      case d.mark_kind
        when 'half_day' then out_row.days_present := out_row.days_present + d.day_value;
        when 'sick'  then
          if d.day_value > 0 then out_row.days_sick_paid := out_row.days_sick_paid + 1;
          else no_letter := no_letter + 1; end if;
        when 'leave' then
          if d.day_value > 0 then out_row.days_leave_paid := out_row.days_leave_paid + 1;
          else over_leave := over_leave + 1; end if;
        else null;
      end case;
      if d.day_value = 0 and d.mark_kind <> 'holiday' then
        out_row.days_unpaid := out_row.days_unpaid + 1;
      end if;
    end if;

    /* Tunjangan is paid for **coming in**. A monthly person earns it on the
       days the business works, because the fingerprint reader is a workshop
       device and the office does not use it — making it depend on taps for
       everybody paid five office staff Rp 600.000 a month less than the day
       before (F72). No taps is not evidence of absence.

       A half day is presence, and since Q46 that is the owner's ruling rather
       than our reading of one (D272). Sakit, cuti and tanggal merah are not. */
    if emp.pay_basis = 'monthly' then
      is_present := case when d.mark_kind is not null then d.mark_kind = 'half_day'
                         else not ops_hr.is_rest_day(v_rules, d.work_date) end;
    else
      is_present := case when d.mark_kind is not null then d.mark_kind = 'half_day'
                         else d.day_value > 0 end;
    end if;

    if is_present then
      select exists (
        select 1 from ops_hr.allowance_withholdings aw
         where aw.employee_id = emp.id and aw.work_date = d.work_date
           and aw.restored_by is null
      ) into withheld;
      if withheld then n_withheld := n_withheld + 1; else n_present := n_present + 1; end if;
    end if;

    /* Minutes late past the grace the owner set (Q41, D251). Nobody has said
       when this person's day starts, so nothing about it is late — not zero
       because they were punctual, zero because there is no threshold, and
       inventing one puts minutes on a payslip (D274). */
    if d.in_at is not null and d.mark_kind is null and day_start is not null then
      late_one := greatest(ops_hr.late_minutes(d.in_at, d.work_date, day_start, grace), 0);
      out_row.late_minutes := out_row.late_minutes + late_one;
      -- **How many days**, beside how many minutes. Ninety minutes is a
      -- different conversation once across a month than nine minutes on ten
      -- mornings, and one number cannot tell those apart.
      if late_one > 0 then out_row.late_days := out_row.late_days + 1; end if;
    end if;

    /* Hours short of the contracted day. Only for people paid by the day: an
       hourly person is already paid for the hours they were here and a monthly
       salary is a month. A marked day is not a short day, it is a different
       day, and counting it here would deduct twice (D174). */
    if ut_mode <> 'off' and emp.pay_basis = 'daily'
       and d.mark_kind is null and d.state = 'complete' then
      gap := emp.daily_hours - d.work_hours;
      if gap > ut_grace then
        short := short + gap;
        if gap > emp.daily_hours / 2 then half_days := half_days + 1; end if;
      end if;
    end if;
  end loop;

  out_row.days := v_days;

  out_row.normal_hours := round(out_row.normal_hours, 2);
  out_row.worked_days  := round(out_row.worked_days, 2);
  out_row.hourly       := rate.hourly;
  out_row.hourly_basis := rate.basis;
  -- Both sums the rule book offers, and the year they come from. The screen
  -- shows the one not chosen beside the one that was, which is the only way
  -- *why is my hour worth this* has an answer (D249).
  out_row.company_hourly   := rate.company;
  out_row.statutory_hourly := rate.statutory;
  out_row.annual_pay       := rate.annual;

  /* Monthly staff are paid the month whatever the machine says; a daily or
     hourly person is paid for what they were here for. That difference is the
     only place `pay_basis` is used, and it is why it exists. */
  out_row.base_pay := case emp.pay_basis
    when 'monthly' then emp.base_rate
    when 'daily'   then round(out_row.worked_days * emp.base_rate)
    else                round(out_row.normal_hours * emp.base_rate)
  end::bigint;

  out_row.allowance_days := n_present;
  out_row.allowance_withheld_days := n_withheld;
  out_row.allowance_pay := (n_present::bigint * emp.allowance_rate);
  -- What the withheld days would have paid, and **who decided each one**. A
  -- deduction with no name against it is the kind a payslip cannot defend.
  out_row.allowance_withheld_amount := (n_withheld::bigint * emp.allowance_rate);
  select coalesce(jsonb_agg(jsonb_build_object(
           'work_date', aw.work_date,
           'reason', aw.reason,
           'by_name', coalesce(u.full_name, '')) order by aw.work_date), '[]'::jsonb)
    into out_row.allowance_withheld
    from ops_hr.allowance_withholdings aw
    left join ops_core.users u on u.id = aw."by"
   where aw.employee_id = emp.id
     and aw.work_date between p_from and p_to
     and aw.restored_by is null;

  select coalesce(sum(amount), 0), coalesce(sum(hours), 0)
    into out_row.overtime_pay, out_row.overtime_hours
    from ops_hr.overtime_parts(emp.id, p_from, p_to);

  /* The rungs, not just the total. *3 jam lembur = Rp 91.000* invites an
     argument; *jam ke-1 × 1,5 + 2 jam × 2* ends one (D173) — and the function
     that produces them was already being called for the total. */
  select coalesce(jsonb_agg(jsonb_build_object(
           'source', op.sheet_no, 'work_date', op.work_date, 'hours', op.hours,
           'multiplier', op.multiplier, 'hourly', op.hourly,
           'amount', op.amount, 'label', op.label)
           order by op.work_date, op.multiplier), '[]'::jsonb)
    into out_row.overtime_parts
    from ops_hr.overtime_parts(emp.id, p_from, p_to) op;

  out_row.undertime_hours := round(short, 2);
  out_row.undertime_amount := case
    when ut_mode = 'half_day_step' then round(half_days * (emp.base_rate / 2.0))
    when ut_mode = 'off' then 0
    else round(short * rate.hourly) end::bigint;

  /* What the hours would cost — *potongannya jam saja* (D251). Computed
     whatever the mode and **applied only when the mode says so**, so the rule
     book can price it before anybody switches it on and a payslip can show
     what is not being deducted rather than leaving the minutes looking free. */
  out_row.late_priced := round((out_row.late_minutes / 60.0) * rate.hourly)::bigint;
  out_row.late_deduction := case when coalesce(v_rules->>'late_mode','manual') = 'pro_rata'
                                 then out_row.late_priced else 0 end;

  select coalesce(sum(amount), 0) into out_row.adjustment_total
    from ops_hr.payroll_adjustments a
   where a.run_no = p_run_no and a.employee_id = emp.id
     and a.withdrawn_at is null;

  /* Each one named, with the sentence somebody typed beside it. A payslip that
     says *penyesuaian −150.000* and nothing else is the reason people come to
     the counter (D155).

     No `label`: there is no such column, and there should not be. The word for
     a `kind` is presentation and it already lives in `ADJUSTMENT_LABEL` on the
     client — storing it beside the kind would be the same string in two places
     with a migration needed to reword it. */
  select coalesce(jsonb_agg(jsonb_build_object(
           'kind', a.kind, 'amount', a.amount,
           'reason', coalesce(a.reason, '')) order by a.created_at), '[]'::jsonb)
    into out_row.adjustments
    from ops_hr.payroll_adjustments a
   where a.run_no = p_run_no and a.employee_id = emp.id
     and a.withdrawn_at is null;

  out_row.gross := out_row.base_pay + out_row.allowance_pay + out_row.overtime_pay
                 - out_row.undertime_amount - out_row.late_deduction;
  -- Gross plus everything moved by hand. **Not** what reaches a bank account:
  -- `0051` makes an employee's share of BPJS a deduction from it, and Q56 is
  -- that argument. `take_home` below is the figure that does.
  out_row.net := (out_row.gross + out_row.adjustment_total)::bigint;

  /* The statutory half, and only for schemes this person is actually enrolled
     in (D259). Nothing is invented: no enrolment row means no deduction, and
     PPh 21 is recorded rather than computed (D140, D277). Read per scheme
     because the rate table is monthly and `contribution_lines` is where that
     lives — restating its rule here to save a few rows would be the second
     copy this ladder keeps learning not to make. The label is left to the
     client: it is presentation, and `SCHEME_LABEL` already holds it. */
  select coalesce(jsonb_agg(jsonb_build_object(
           'scheme', cl.scheme, 'base', cl.base,
           'employee', cl.employee, 'employer', cl.employer)
           order by cl.scheme), '[]'::jsonb),
         coalesce(sum(cl.employee), 0)
    into out_row.contributions, out_row.contribution_total
    from (select distinct en.scheme from ops_hr.enrolments en
           where en.employee_id = emp.id) s
    cross join lateral ops_hr.contribution_lines(
      s.scheme, date_trunc('month', p_from)::date) cl
   where cl.employee_id = emp.id;

  out_row.take_home := out_row.net - out_row.contribution_total;

  -- The contract's spellings for two figures that already exist under another
  -- name. Assigned from the originals so the pair cannot drift.
  out_row.days_worked := out_row.worked_days;
  out_row.days_open   := out_row.open_days;

  /* The sentences a payslip needs, because a figure nobody can take apart is a
     figure somebody argues with at the counter. */
  if out_row.open_days > 0 then
    w := w || format('%s hari belum dibaca — belum bernilai sampai ada yang membacanya', out_row.open_days);
  end if;
  select coalesce(sum(c.hours), 0) into pending_ot from ops_hr.v_overtime_claim c
    join ops_hr.overtime_lines l on l.sheet_id = c.id
   where l.employee_id = emp.id and c.work_date between p_from and p_to
     and c.stage in ('waiting_hrd','waiting_surat','waiting_leader');
  -- Hours claimed and not yet signed for. It was already being counted for the
  -- warning below and thrown away; the contract has always asked for it,
  -- because *what is still coming* is a different question from *what this
  -- period pays* and a payslip is read by somebody who wants both.
  out_row.overtime_pending_hours := pending_ot;
  if pending_ot > 0 then
    w := w || format('%s jam lembur di lembar yang belum selesai ditandatangani — tidak masuk angka ini', pending_ot);
  end if;
  if shown_ot > out_row.overtime_hours + pending_ot then
    w := w || format('%s jam lewat jam kerja di mesin yang belum diklaim siapa pun',
                     round(shown_ot - out_row.overtime_hours - pending_ot, 1));
  end if;
  if no_letter > 0 then
    w := w || format('%s hari sakit tanpa surat dokter — tercatat, tidak dibayar. Suratnya membuatnya dibayar', no_letter);
  end if;
  if over_leave > 0 then
    w := w || format('%s hari cuti melewati jatah %s hari — tercatat, tidak dibayar', over_leave, emp.paid_leave_days);
  end if;
  if n_withheld > 0 and emp.allowance_rate > 0 then
    w := w || format('%s hari tanpa tunjangan — keputusan HRD, alasannya tercetak di slip', n_withheld);
  end if;
  if out_row.late_minutes > 0 and coalesce(v_rules->>'late_mode','manual') = 'manual' then
    w := w || format('%s menit terlambat di luar toleransi — belum dipotong; Rp %s kalau aturannya dinyalakan',
                     out_row.late_minutes, out_row.late_priced);
  end if;
  if emp.pay_basis <> 'monthly' and out_row.worked_days = 0 then
    w := w || 'Tidak ada hari yang terhitung pada periode ini'::text;
  end if;
  out_row.warnings := w;

  return out_row;
end $$;

create or replace function ops_hr.kpi_measures(p_employee uuid, p_from date, p_to date)
returns setof ops_hr.kpi_measure_t
language plpgsql stable set search_path = ops_hr, pg_temp as $$
declare
  emp        ops_hr.employees%rowtype;
  d          ops_hr.day_reading;
  v_rules    jsonb;
  v_start    int;
  v_grace    int;
  tapped     int := 0;   -- days with a tap and no mark
  judgeable  int := 0;   -- of those, days whose schedule has a start time
  late_days  int := 0;
  v_recorded   int := 0;   -- days carrying a tap OR a mark
  unexplained int := 0;
  starts     text[] := '{}';
  one_start  text;
  min_days   int;
  m          ops_hr.kpi_measure_t;
  t_due int := 0; t_counted int := 0; t_ontime int := 0; t_blocked int := 0;
begin
  select * into emp from ops_hr.employees where id = p_employee;
  if not found then return; end if;
  min_days := coalesce(ops_core.setting_num('kpi.min_days_recorded'), 5)::int;

  for d in select * from ops_hr.timesheet(p_employee, p_from, p_to) loop
    /* Each day against **the book in force on that day**, not the one in force
       when the window opens. A reader can pick a range that spans a rule
       change, and judging a September day by August's start time is one value
       doing a job it was never asked to do (F89). */
    v_rules := ops_hr.rules_on(d.work_date);
    v_grace := coalesce((v_rules->>'late_grace_minutes')::int, 0);
    v_start := coalesce(
      (ops_hr.schedule_of(v_rules, emp.schedule_code, emp.unit)->>'start_minutes')::int,
      (v_rules->>'day_starts_minutes')::int);

    -- Attendance is measured over **the days the system has a record for**,
    -- not over a calendar. The office does not use the fingerprint reader, so
    -- dividing by scheduled days rated every office worker at 4% present —
    -- F72 again, in the one module where it would have landed in somebody's
    -- review (F81). No taps is not evidence of absence.
    if d.in_at is not null or d.mark_kind is not null then
      v_recorded := v_recorded + 1;
      -- Only a day HRD **marked** as absent counts against anybody. That is a
      -- fact somebody asserted, never one inferred from silence; sakit with a
      -- letter and cuti are not mangkir and never count here.
      if d.mark_kind = 'absent' then unexplained := unexplained + 1; end if;
    end if;

    if d.in_at is not null and d.mark_kind is null then
      tapped := tapped + 1;
      /* A day whose schedule has no start time **cannot be judged**, so it
         leaves the arithmetic entirely rather than counting as punctual: a
         guard on an unstated shift must not score 100% (D261, F109). */
      if v_start is not null then
        judgeable := judgeable + 1;
        if ops_hr.late_minutes(d.in_at, d.work_date, v_start, v_grace) > 0 then
          late_days := late_days + 1;
        end if;
        -- The thresholds actually applied across the window: usually one, and
        -- **named as several** when the window spans a change rather than
        -- quietly averaged.
        one_start := format('%s.%s+%sm', lpad((v_start / 60)::text, 2, '0'),
                            lpad((v_start % 60)::text, 2, '0'), v_grace);
        if not (one_start = any(starts)) then starts := starts || one_start; end if;
      end if;
    end if;
  end loop;

  -- ── Ketepatan waktu masuk ───────────────────────────────────────────────
  m.key := 'punctuality';
  m.label := 'Ketepatan waktu masuk';
  m.source := 'Mesin absensi · aturan penggajian yang berlaku';
  m.weight := coalesce(ops_core.setting_num('kpi.weight_punctuality'), 25);
  if judgeable < min_days then
    m.value := null;
    m.unmeasured_reason := case
      when tapped = 0 then
        'Tidak ada satu pun tap mesin absensi pada periode ini. Mesinnya alat bengkel; staf kantor tidak memakainya, dan tidak terukur bukan berarti seratus persen.'
      when judgeable = 0 then
        'Belum ada jam masuk yang ditetapkan untuk orang ini, jadi tidak ada ambang untuk menilai terlambat. Bukan tepat waktu — belum terukur.'
      else format('Baru %s hari yang bisa dinilai, di bawah ambang %s hari.', judgeable, min_days) end;
    m.basis := format('%s hari dengan tap, %s bisa dinilai', tapped, judgeable);
  else
    m.value := round((judgeable - late_days)::numeric / judgeable * 100)::int;
    m.unmeasured_reason := null;
    -- The start time is part of the basis, not a constant behind it: with two
    -- schedules in one business *tepat waktu* means a different clock for the
    -- workshop and the office, and a figure whose threshold is invisible
    -- cannot be argued with (D261, D270).
    m.basis := format('%s dari %s hari tepat waktu (masuk %s)',
                      judgeable - late_days, judgeable, array_to_string(starts, ' dan '));
  end if;
  return next m;

  -- ── Hadir tanpa mangkir ─────────────────────────────────────────────────
  m.key := 'attendance';
  m.label := 'Hadir tanpa mangkir';
  m.source := 'Timesheet · tanda hari dari HRD';
  m.weight := coalesce(ops_core.setting_num('kpi.weight_attendance'), 25);
  if v_recorded < min_days then
    m.value := null;
    m.unmeasured_reason := case when v_recorded = 0
      then 'Tidak ada satu hari pun pada periode ini yang punya catatan — tidak ada tap mesin dan tidak ada tanda hari dari HRD. Tidak ada catatan bukan berarti tidak masuk.'
      else format('Baru %s hari yang punya catatan, di bawah ambang %s hari. Persentase atas dua hari bukan persentase yang sama dengan atas tiga puluh.', v_recorded, min_days) end;
    m.basis := format('%s hari tercatat', v_recorded);
  else
    m.value := round((v_recorded - unexplained)::numeric / v_recorded * 100)::int;
    m.unmeasured_reason := null;
    m.basis := format('%s dari %s hari yang tercatat · hanya hari yang ditandai HRD sebagai mangkir yang dihitung; sakit bersurat dan cuti tidak pernah',
                      v_recorded - unexplained, v_recorded);
  end if;
  return next m;

  -- ── Tugas selesai tepat waktu ───────────────────────────────────────────
  --
  -- Cancelled is neither a success nor a failure, and **blocked is not the
  -- person's** (D261). Both leave the arithmetic rather than landing on one
  -- side of it.
  select
    count(*),
    count(*) filter (where t.status <> 'CANCELLED' and t.blocked_reason is null),
    count(*) filter (where t.status = 'DONE' and t.blocked_reason is null
                       and ops_core.office_day(t.done_at) <= t.due_date),
    count(*) filter (where t.blocked_reason is not null)
    into t_due, t_counted, t_ontime, t_blocked
    from ops_hr.tasks t
   where t.assignee_id = p_employee and t.due_date between p_from and p_to;

  m.key := 'task_delivery';
  m.label := 'Tugas selesai tepat waktu';
  m.source := 'Task tracker';
  m.weight := coalesce(ops_core.setting_num('kpi.weight_tasks'), 50);
  if t_counted = 0 then
    m.value := null;
    m.unmeasured_reason := case when t_due = 0
      then 'Tidak ada tugas yang jatuh tempo pada periode ini. Tidak ada tugas bukan nilai nol — tidak ada yang diukur.'
      else 'Semua tugas periode ini dibatalkan atau tertahan menunggu pihak lain, jadi tidak ada yang bisa dinilai.' end;
    m.basis := format('%s tugas jatuh tempo, tidak ada yang dihitung', t_due);
  else
    m.value := round(t_ontime::numeric / t_counted * 100)::int;
    m.unmeasured_reason := null;
    m.basis := format('%s dari %s tugas%s', t_ontime, t_counted,
                      case when t_blocked > 0
                        then format(' · %s tertahan, tidak dihitung', t_blocked) else '' end);
  end if;
  return next m;
end $$;

/* ── the guard's hours: a default, and said to be one ─────────────────── */
--
-- *Satpam 12 jam lewat hari* gives the length and that it crosses midnight; it
-- does not give the clock. 19:00–07:00 with no break deducted is the default
-- (Q-D330a), written as a **new version** of the latest book and only where
-- the book still has the guard's pattern with no start and no end — a book
-- somebody has already filled in is somebody's answer and is left alone.
--
-- Dated to the latest book's own date, or the day after the last payroll
-- period if that is later, so it never reaches back past a run and never lands
-- inside one (the two rules `pay_rules_not_backdated` enforces). Nobody is on
-- the pattern in the seed, so no figure anybody has seen moves.
do $$
declare
  v_latest ops_hr.pay_rule_sets;
  v_from   date;
begin
  select * into v_latest from ops_hr.pay_rule_sets
   order by effective_from desc, version desc limit 1;
  if not found then return; end if;

  if not exists (
    select 1 from jsonb_array_elements(coalesce(v_latest.rules -> 'schedules','[]'::jsonb)) s
     where s.value ->> 'code' = 'SATPAM'
       and ops_hr.minutes_of(s.value -> 'start_minutes') is null
       and ops_hr.minutes_of(s.value -> 'end_minutes') is null
       and ops_hr.minutes_of(s.value -> 'friday_end_minutes') is null) then
    return;
  end if;

  v_from := greatest(v_latest.effective_from,
                     (select max(period_end) + 1 from ops_hr.payroll_runs));

  insert into ops_hr.pay_rule_sets (version, effective_from, note, rules, created_by)
  select (select max(version) + 1 from ops_hr.pay_rule_sets), v_from,
         'D330: satpam 12 jam melewati tengah malam. Jam 19.00–07.00 tanpa potongan istirahat '
         || 'adalah DEFAULT yang belum dikonfirmasi pemilik — HRD menetapkannya di /hrd/jadwal.',
         jsonb_set(v_latest.rules, '{schedules}', (
           select jsonb_agg(
                    case when s.value ->> 'code' = 'SATPAM'
                      then s.value || jsonb_build_object(
                             'start_minutes', 19 * 60,
                             'end_minutes', 7 * 60,
                             'break_minutes', coalesce(ops_hr.minutes_of(s.value -> 'break_minutes'), 0),
                             'hours_unconfirmed', true)
                      else s.value end
                    order by s.ord)
             from jsonb_array_elements(v_latest.rules -> 'schedules') with ordinality s(value, ord))),
         null;
end $$;
