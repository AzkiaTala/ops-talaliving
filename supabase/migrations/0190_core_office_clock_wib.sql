-- 0190_core_office_clock_wib.sql — the office clock is WIB, and the machine's
-- taps are moved by the hour every import misread (D334, F191).
--
-- !! THIS MIGRATION CHANGES EXISTING DATA. Read this header before applying. !!
--
-- ── what the owner decided (2026-09-29) ───────────────────────────────────
--
-- *waktu masuk pakai WIB* — and, asked which scope, **the whole office clock**:
-- the office day, every printed time, the importer, the manual scan. Not only
-- `/profil`, not only a label.
--
-- ── what was wrong ─────────────────────────────────────────────────────────
--
-- The fingerprint machine writes **WIB** wall-clock time with no zone. Every
-- import since `0044` attached `+08:00` to it (`src/lib/biometricFile.ts`), and
-- the manual-scan form attached `+08` (`src/lib/api/hr.ts`). So a tap the
-- machine printed as 07:25 is stored as 07:25 WITA = 06:25 WIB = 23:25 UTC: one
-- hour before it happened. Nothing looked wrong on screen, because every reader
-- also read WITA (`'Asia/Makassar'`, `0004`, `0048`, `0049`, `0053`, `0184`)
-- and the two errors cancelled. They stop cancelling the moment one side moves,
-- which is what this file does, so both sides move together here.
--
-- ── 1. one name for the zone ──────────────────────────────────────────────
--
-- `ops_core.office_tz()` is the zone, stated once — the database twin of
-- `OFFICE_TZ` in `src/lib/office.ts` (F63). `office_day`, `wita_minutes` and
-- `update_task` are recreated explicitly on it, with the same signatures,
-- grants and behaviour. `tap_self` is **not**: D332's `0188` drops
-- `tap_self(text)` and creates it with a location, and an explicit
-- `tap_self(text)` here would put the old signature back beside it as an
-- overload PostgREST cannot choose between. The sweep below rewrites whichever
-- `tap_self` is current. (Production ran an earlier revision of this file,
-- before `0188` existed, that did recreate `tap_self(text)`; `0184` was then
-- applied over it. `0191` repeats the sweep for that order — F191.) `wita_minutes` keeps its name: renaming it
-- means recreating every caller (`read_day`, `payroll_line_for`,
-- `kpi_measures`, …), and those belong to D330's `0186`. Its body is the office
-- clock now; the name is history.
--
-- ── 2. every other function that named the zone ───────────────────────────
--
-- `tap_self` (D327/D332) and `read_day` name the zone too. `read_day` is
-- D330's lane: `0186` rewrites it (and adds `day_begins`/`late_minutes`,
-- which name the zone too). Recreating it here from `0053`'s body would undo
-- `0186` wherever `0186` ran first. So instead of copying a body, the sweep
-- below takes **whatever definition is current** (`pg_get_functiondef`) and
-- replaces the literal `'Asia/Makassar'` with `ops_core.office_tz()` — nothing
-- else in the body changes, and `create or replace` keeps the grants. Then it
-- asserts that no `ops_*` function or view still names `Asia/Makassar` or a
-- `+08` literal, and refuses to commit if one does. Any later migration that
-- writes the literal again is caught by smoke `190`.
--
-- ── 3. the data: machine and HRD taps move +1 hour ────────────────────────
--
-- The owner's answer: **shift** `source in ('import','manual')` by one hour, so
-- each still reads exactly as the machine (or HRD) wrote it — 07:25 stays
-- 07:25, now WIB. **Do not shift** `source = 'self'`: `tap_self` stamps `now()`,
-- a real instant from the server, never a wall-clock time with a guessed zone.
--
-- `work_date` is then recomputed with the new `office_day`. For a shifted tap
-- it does not change (07:25 WITA and 07:25 WIB are the same calendar day). For
-- a self tap it changes only between 23:00 and 24:00 WIB, which the old WITA
-- day filed under tomorrow — that was the bug, now read right.
--
-- `scan_once (employee_id, at)` is dropped for the one update and put back:
-- Postgres checks a non-deferrable unique key row by row, so two taps of one
-- person exactly 3600 s apart would collide half-way through a correct update.
-- Put back, it proves the result has no duplicate — a machine tap landing on a
-- self tap's exact second would stop the migration, and should.
--
-- ── 4. what is deliberately not touched ───────────────────────────────────
--
-- - **APPROVED/PAID payroll runs** (owner's answer). No row of `payroll_runs`,
--   `payroll_adjustments` or `overtime_*` is written. A run's lines are read
--   live from the taps (`payroll_line_for` → `read_day`), and shifting the
--   machine taps is exactly what keeps an approved run reading the same: the
--   wall clock under WIB after the shift equals the wall clock under WITA
--   before it. The one thing that can move is a **self** tap inside an
--   approved period — it was read an hour late until now. The migration counts
--   those and says so in a notice (and in the marker row) rather than guess.
-- - Every other timestamp (`created_at`, `recorded_at`, `approved_at`, …) is a
--   real instant from `now()` and needs nothing.
-- - `tasks.done_at` for a typed finish date was anchored at noon `+08`; noon
--   WITA is 11:00 WIB, the same day, and only the day is ever read (D148).
-- - `day_marks`, `overtime_sheets.work_date`, `leave_requests`: dates, no clock.
-- - Activity labels already written (*Tap presensi pukul …*) stay as said (the
--   same rule `0184` followed).
--
-- ── 5. it cannot run twice ────────────────────────────────────────────────
--
-- The data step is guarded by a marker row, `ops_core.settings` key
-- `office_tz`, inserted `on conflict do nothing`. Only the transaction that
-- inserts it shifts anything; a second run finds the row and moves nothing.
-- The functions are `create or replace` and idempotent on their own.
--
-- ── before applying to production ──────────────────────────────────────────
--
-- The owner confirms the fingerprint machine's clock is set to WIB. If it is
-- not, this migration moves every machine tap by an hour that was right.

-- ── 1. the zone, once ───────────────────────────────────────────────────────

create or replace function ops_core.office_tz()
returns text
language sql immutable parallel safe as $$
  select 'Asia/Jakarta'::text
$$;

comment on function ops_core.office_tz() is
  'The office clock: WIB, Asia/Jakarta (D334). The twin of OFFICE_TZ in src/lib/office.ts; change both or neither.';

grant execute on function ops_core.office_tz() to authenticated;

-- The office day, not the server's (F17, F39). `immutable` as `0004` had it —
-- the zone is a constant, not a setting, and column defaults call this.
create or replace function ops_core.office_day(at timestamptz default now())
returns date language sql immutable as $$
  select (at at time zone ops_core.office_tz())::date
$$;

-- Minutes from midnight on the office clock. Named for WITA before D334; the
-- callers are D330's to rename (see the header).
create or replace function ops_hr.wita_minutes(p_at timestamptz)
returns int
language sql immutable as $$
  select (extract(hour from p_at at time zone ops_core.office_tz())::int) * 60
       + (extract(minute from p_at at time zone ops_core.office_tz())::int)
$$;

-- `0152`'s body. The only change is the finish-day anchor: noon on the office
-- clock, built from the date and the zone rather than a `+08` in a string.
create or replace function ops_hr.update_task(
  p_task_no text, p_action text, p_reason text default null,
  p_delivered text default null, p_done_on date default null)
returns jsonb
language plpgsql security definer set search_path = ops_hr, ops_core, pg_temp as $$
declare t ops_hr.tasks%rowtype;
begin
  if not ops_core.has_permission('hrd.update') then
    return ops_core.refused('hr','task', p_task_no, p_action,
      'not_permitted','Mengubah tugas butuh akses HRD.');
  end if;
  if p_action not in ('done','block','unblock','cancel') then
    return ops_core.invalid('hr','task', p_task_no, coalesce(p_action,'update'),
      'unknown_action', format('Tidak ada tindakan %s.', coalesce(p_action,'(kosong)')),
      jsonb_build_object('field','action'));
  end if;

  select * into t from ops_hr.tasks where task_no = p_task_no;
  if not found then
    return ops_core.not_found('hr','task', p_task_no, p_action,
      format('Tidak ada tugas %s.', p_task_no));
  end if;
  if t.status <> 'OPEN' and p_action <> 'done' then
    return ops_core.conflict('hr','task', p_task_no, p_action,'task_closed',
      format('%s sudah %s.', t.task_no, lower(t.status::text)));
  end if;
  if p_action in ('block','cancel') and coalesce(btrim(coalesce(p_reason,'')),'') = '' then
    return ops_core.invalid('hr','task', p_task_no, p_action,'reason_required',
      case when p_action = 'block'
        then 'Tertahan menunggu apa? Tugas yang tertahan dikeluarkan dari penilaian orangnya — yang menghapus beban harus menyebut alasannya, dan kalimat ini juga yang dibaca pihak yang menahannya.'
        else 'Kenapa dibatalkan? Tugas yang dibatalkan tidak dihitung sebagai berhasil maupun gagal, jadi alasannya adalah satu-satunya jejak yang tersisa.' end,
      jsonb_build_object('field','reason'));
  end if;
  if p_action = 'unblock' and t.blocked_reason is null then
    return ops_core.noop('hr','task', p_task_no,'unblock',
      format('%s memang tidak sedang tertahan.', t.task_no));
  end if;
  if p_action = 'done' and t.status = 'DONE' then
    return ops_core.noop('hr','task', p_task_no,'done',
      format('%s sudah selesai.', t.task_no));
  end if;

  if p_action = 'done' then
    update ops_hr.tasks
       set status = 'DONE',
           -- The day it was finished, not the day it was typed (D148).
           done_at = case when p_done_on is null then now()
                          else (p_done_on + time '12:00') at time zone ops_core.office_tz() end,
           done_by = auth.uid(),
           delivered_note = coalesce(nullif(btrim(coalesce(p_delivered,'')),''), delivered_note),
           blocked_reason = null, blocked_at = null
     where id = t.id;
  elsif p_action = 'block' then
    update ops_hr.tasks set blocked_reason = btrim(p_reason), blocked_at = now() where id = t.id;
  elsif p_action = 'unblock' then
    update ops_hr.tasks set blocked_reason = null, blocked_at = null where id = t.id;
  else
    update ops_hr.tasks set status = 'CANCELLED', cancelled_reason = btrim(p_reason) where id = t.id;
  end if;

  return ops_core.ok('hr','task', t.task_no, p_action,
    jsonb_build_object('task_no', t.task_no, 'action', p_action),
    null,
    jsonb_build_object('reason', nullif(btrim(coalesce(p_reason,'')),''),
                       'delivered', nullif(btrim(coalesce(p_delivered,'')),''),
                       'deliverable_asked', t.deliverable));
end $$;

revoke execute on function ops_hr.update_task(text, text, text, text, date) from public;
grant execute on function ops_hr.update_task(text, text, text, text, date) to authenticated;

-- ── 2. the sweep: whatever still names the old zone ──────────────────────────

do $$
declare
  f record;
  left_over text;
begin
  for f in
    select p.oid
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname like 'ops\_%'
       and p.prosrc like '%''Asia/Makassar''%'
  loop
    execute replace(pg_get_functiondef(f.oid), '''Asia/Makassar''', 'ops_core.office_tz()');
  end loop;

  select string_agg(what, ', ' order by what) into left_over from (
    select n.nspname || '.' || p.proname as what
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname like 'ops\_%'
       and (p.prosrc like '%Asia/Makassar%' or p.prosrc ~ '\+08(:00)?''')
    union all
    select schemaname || '.' || viewname
      from pg_views
     where schemaname like 'ops\_%'
       and (definition like '%Asia/Makassar%' or definition ~ '\+08(:00)?''')
  ) x;

  if left_over is not null then
    raise exception 'D334: still on the old office clock after the sweep: %', left_over;
  end if;
end $$;

-- ── 3. the data, once ────────────────────────────────────────────────────────

do $$
declare
  v_marked int;
  v_shifted int;
  v_redated int;
  v_self_in_closed int;
begin
  insert into ops_core.settings (key, value, note)
  values ('office_tz', to_jsonb(ops_core.office_tz()),
          'The office clock (D334). Its presence also marks that 0190 moved the machine and HRD taps +1 h; it must never run twice.')
  on conflict (key) do nothing;
  get diagnostics v_marked = row_count;

  if v_marked = 0 then
    raise notice 'D334: office_tz is already recorded — attendance was shifted before, nothing moved now.';
    return;
  end if;

  alter table ops_hr.attendance_scans drop constraint scan_once;

  update ops_hr.attendance_scans
     set at = at + interval '1 hour'
   where source::text <> 'self';
  get diagnostics v_shifted = row_count;

  update ops_hr.attendance_scans
     set work_date = ops_core.office_day(at)
   where work_date is distinct from ops_core.office_day(at);
  get diagnostics v_redated = row_count;

  alter table ops_hr.attendance_scans
    add constraint scan_once unique (employee_id, at);

  select count(*) into v_self_in_closed
    from ops_hr.attendance_scans s
   where s.source::text = 'self'
     and exists (select 1 from ops_hr.payroll_runs r
                  where r.status <> 'DRAFT'
                    and s.work_date between r.period_start and r.period_end);

  update ops_core.settings
     set value = jsonb_build_object('zone', ops_core.office_tz(),
                                    'shifted_scans', v_shifted,
                                    'redated_scans', v_redated,
                                    'self_taps_in_closed_runs', v_self_in_closed)
   where key = 'office_tz';

  raise notice 'D334: % machine/HRD taps moved +1 h, % work dates recomputed, % self taps sit inside an APPROVED/PAID run and now read an hour earlier.',
    v_shifted, v_redated, v_self_in_closed;
end $$;

comment on column ops_hr.attendance_scans.work_date is
  'The office day this tap belongs to, on the office clock (ops_core.office_tz(), WIB since D334) — not UTC and not the browser''s (F17, F39).';

analyze ops_hr.attendance_scans;
