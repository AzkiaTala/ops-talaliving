-- 0188_hr_located_tap.sql — a tap from the phone says where it was made,
-- checked against the warehouse (D332, F189).
--
-- ── what the owner asked for ──────────────────────────────────────────────
--
-- D326, answers 1, 6 and 7: clocking in away from the warehouse stays
-- possible, through a form with the location, a photo and a note. The only
-- place is the warehouse (gudang). Per-zone detection and tracking every 15
-- or 30 minutes were dropped (W8): a PWA cannot read the location while it is
-- closed, and GPS around a building is 10–50 m out, too coarse to tell packing
-- from finishing. So the location is read **once, at the moment of the tap**,
-- and never in the background. Nothing here is a schedule or a ping.
--
-- ── the four parts ────────────────────────────────────────────────────────
--
-- 1. `work_sites`: the warehouse as a row (a centre, a radius, an active flag),
--    not a constant. Its coordinates are unknown, so **nothing is seeded**.
--    HRD or IT sets it standing in the warehouse (`/hrd/absensi/lokasi`).
-- 2. `judge_location`: where a reading stands against the nearest active site.
--    One function, so the phone, the settings screen and `tap_self` cannot
--    disagree about what "inside" means.
-- 3. `tap_self` gains the reading, plus the off-site note and photo. Off-site
--    is **recorded and flagged, never refused** (answer 1). What is refused is
--    an off-site tap with no note, and the refusal carries the verdict so the
--    phone can show the form.
-- 4. `scan_locations`, 1:1 with `attendance_scans`, and `v_located_tap` for
--    HRD's review. A side table and not columns on the scan: a tap from the
--    reader at the door has no location and never will, `read_day` reads the
--    scans table and is being changed in parallel (D330), and taps stay facts
--    either way. **Nothing here decides what a day is worth**: HRD's day marks
--    do that, as before (D142).
--
-- ── what "inside" means ───────────────────────────────────────────────────
--
-- The phone reports a point and an accuracy: "within `a` metres of here". A tap
-- is judged by that whole circle, not by its centre:
--
--   inside     distance + accuracy <= radius   the whole circle is on site
--   outside    distance - accuracy >  radius   none of it is
--   uncertain  otherwise, or no accuracy       it straddles the edge
--   no_location  the phone gave no point       permission denied, no fix
--   no_site      no active site has a point    see below
--
-- Only `inside` goes through with one press. `outside`, `uncertain` and
-- `no_location` need a note; they are then written and flagged.
--
-- **No site configured → `no_site`: the tap goes through with one press**, and
-- the reading is still stored. Until somebody stands in the warehouse and sets
-- the point there is nothing to judge against, and making forty people write a
-- note every morning for a missing setting would punish them for HRD's to-do.
-- The review screen says the point is not set and counts the unjudged taps.
--
-- ── what this migration keeps from `tap_self` ─────────────────────────────
--
-- The idempotency key, `no_employee_link`, `recorded_by`, `source = 'self'`,
-- and D141: **no masuk/pulang at write time**. D327's fix is carried: the
-- activity label reads the office clock (`0184`), `to_char(v_at at time zone
-- 'Asia/Makassar', …)`. This file sorts after `0184` and replaces its body, so
-- it has to.
--
-- A new signature would be an **overload** beside `tap_self(text)`, and
-- PostgREST cannot choose between two functions that both accept `{p_key}`.
-- So the old one is dropped here, in the same file, and the new one granted.

-- ── 1. the file: label, drive, folder ─────────────────────────────────────
insert into ops_core.doc_kind_labels (kind, label)
values ('foto_presensi', 'Foto Presensi')
on conflict (kind) do nothing;

-- Personal data — a face at a moment somewhere — so the HRD drive (0035).
insert into ops_core.doc_kind_drive (kind, slug, rationale)
values ('foto_presensi', 'hrd', 'A photo taken at a clock-in away from the warehouse (D332). A face and a place: personal data.')
on conflict (kind) do nothing;

insert into ops_core.drive_paths (kind, entity, path, note)
values ('foto_presensi', null, 'PRESENSI LUAR AREA',
        'Photos from a clock-in made outside the warehouse, on /profil or /saya (D332).')
on conflict (kind, entity) do nothing;

-- ── 2. the work site ─────────────────────────────────────────────────────
create table ops_hr.work_sites (
  id          uuid primary key default gen_random_uuid(),
  -- The public code (ADR-004): `GUDANG`.
  code        text not null unique check (code ~ '^[A-Z0-9_-]{2,20}$'),
  name        text not null check (length(btrim(name)) > 0),
  -- Null until somebody stands there and sets it. A site with no point judges
  -- nothing, and `judge_location` skips it.
  lat         double precision check (lat between -90 and 90),
  lng         double precision check (lng between -180 and 180),
  -- 150 m by default: a warehouse compound plus a phone's usual 10–50 m of
  -- doubt. An open question (Q-D332), set on the screen.
  radius_m    integer not null default 150 check (radius_m between 20 and 2000),
  active      boolean not null default true,
  updated_by  uuid references ops_core.users(id),
  updated_at  timestamptz not null default now(),
  constraint point_whole check ((lat is null) = (lng is null))
);

comment on table ops_hr.work_sites is
  'Where a phone tap is judged against: a centre and a radius. One active row today (the warehouse). '
  'No seeded point — set on /hrd/absensi/lokasi. (0188, D332)';

alter table ops_hr.work_sites enable row level security;
-- Everybody who can tap may know where "inside" is; nothing about a warehouse's
-- position is a secret from the people who work in it.
create policy sites_read on ops_hr.work_sites for select to authenticated using (true);
grant select on ops_hr.work_sites to authenticated;
-- No insert/update policy: the seam below is the only writer.

analyze ops_hr.work_sites;

-- ── 3. the reading, beside the tap ────────────────────────────────────────
create table ops_hr.scan_locations (
  scan_id     uuid primary key references ops_hr.attendance_scans(id),
  -- The tap's public code, which the photo's link names (ADR-004):
  -- `B-1841/2026-09-29T07:25:03`, the employee and the office clock.
  tap_no      text not null unique,
  site_id     uuid references ops_hr.work_sites(id),
  lat         double precision check (lat between -90 and 90),
  lng         double precision check (lng between -180 and 180),
  accuracy_m  numeric(9,1) check (accuracy_m >= 0),
  distance_m  numeric(10,1) check (distance_m >= 0),
  radius_m    integer,
  verdict     text not null check (verdict in ('inside','outside','uncertain','no_location','no_site')),
  note        text,
  photo_id    uuid references ops_core.attachments(id),
  constraint reading_whole check ((lat is null) = (lng is null)),
  constraint off_site_says_why check (
    verdict in ('inside','no_site') or (note is not null and length(btrim(note)) > 0))
);

comment on table ops_hr.scan_locations is
  'Where a phone tap was made, read once at the tap, and how it stood against the site. 1:1 with a '
  'self tap; the reader at the door has none. Flagged, never refused. (0188, D332)';

create index scan_locations_verdict_idx on ops_hr.scan_locations (verdict) where verdict <> 'inside';

alter table ops_hr.scan_locations enable row level security;
-- HRD reads them all (the review). A person reads their own, the same link
-- `scans_read_own` uses (0164).
create policy scan_locations_read on ops_hr.scan_locations for select to authenticated
  using (ops_core.has_permission('hrd.read')
         or exists (select 1 from ops_hr.attendance_scans s
                     where s.id = scan_id and s.employee_id = ops_hr.my_employee_id()));
grant select on ops_hr.scan_locations to authenticated;

analyze ops_hr.scan_locations;

-- ── 4. judging a reading ──────────────────────────────────────────────────
-- Great-circle distance in metres (haversine). Plenty for a few hundred metres.
create or replace function ops_hr.distance_m(
  p_lat1 double precision, p_lng1 double precision,
  p_lat2 double precision, p_lng2 double precision)
returns double precision
language sql immutable set search_path = pg_temp as $$
  select 2 * 6371008.8 * asin(sqrt(
    power(sin(radians(p_lat2 - p_lat1) / 2), 2)
    + cos(radians(p_lat1)) * cos(radians(p_lat2)) * power(sin(radians(p_lng2 - p_lng1) / 2), 2)));
$$;
grant execute on function ops_hr.distance_m(double precision, double precision, double precision, double precision) to authenticated;

create or replace function ops_hr.judge_location(
  p_lat double precision default null,
  p_lng double precision default null,
  p_accuracy_m double precision default null)
returns jsonb
language plpgsql stable security definer set search_path = ops_hr, ops_core, pg_temp as $$
declare
  s record; v_d double precision; v_verdict text;
begin
  -- The nearest active site with a point. One today; rows, so a second one is
  -- a row and not a migration.
  select w.id, w.code, w.name, w.lat, w.lng, w.radius_m,
         case when p_lat is null or p_lng is null then null
              else ops_hr.distance_m(p_lat, p_lng, w.lat, w.lng) end as d
    into s
    from ops_hr.work_sites w
   where w.active and w.lat is not null
   order by case when p_lat is null or p_lng is null then 0
                 else ops_hr.distance_m(p_lat, p_lng, w.lat, w.lng) end, w.code
   limit 1;

  if not found then
    v_verdict := 'no_site';
  elsif p_lat is null or p_lng is null then
    v_verdict := 'no_location';
  else
    v_d := s.d;
    if p_accuracy_m is not null and v_d + p_accuracy_m <= s.radius_m then
      v_verdict := 'inside';
    elsif v_d - coalesce(p_accuracy_m, 0) > s.radius_m and p_accuracy_m is not null then
      v_verdict := 'outside';
    else
      v_verdict := 'uncertain';
    end if;
  end if;

  return jsonb_build_object(
    'verdict', v_verdict,
    'distance_m', case when v_d is null then null else round(v_d::numeric, 1) end,
    'accuracy_m', case when p_accuracy_m is null then null else round(p_accuracy_m::numeric, 1) end,
    'site_id', s.id,
    'site_code', s.code,
    'site_name', s.name,
    'radius_m', s.radius_m,
    'needs_note', v_verdict in ('outside','uncertain','no_location'));
end $$;

revoke execute on function ops_hr.judge_location(double precision, double precision, double precision) from public;
grant execute on function ops_hr.judge_location(double precision, double precision, double precision) to authenticated;

-- ── 5. setting the site ───────────────────────────────────────────────────
-- HRD or IT: the same pair who hold the attendance and the rule book. Keyed by
-- code, so saving twice is the same row, and deactivating is a flag, not a
-- delete (A5).
create or replace function ops_hr.save_work_site(
  p_code text,
  p_name text,
  p_lat double precision,
  p_lng double precision,
  p_radius_m integer default 150,
  p_active boolean default true,
  p_key text default null)
returns jsonb
language plpgsql security definer set search_path = ops_hr, ops_core, pg_temp as $$
declare
  v_replayed jsonb; v_code text := upper(btrim(coalesce(p_code, ''))); v_id uuid; v_res jsonb;
begin
  v_replayed := ops_core.idem_replay('hr','save_work_site', p_key);
  if v_replayed is not null then return v_replayed; end if;

  if not (ops_core.has_permission('hrd.update') or ops_core.has_permission('it.update')) then
    return ops_core.refused('hr','work_site', v_code,'save',
      'not_permitted','Titik lokasi kerja diatur oleh HRD atau IT.');
  end if;
  if v_code !~ '^[A-Z0-9_-]{2,20}$' then
    return ops_core.invalid('hr','work_site', v_code,'save',
      'bad_code','Kode lokasi 2–20 huruf besar/angka, mis. GUDANG.',
      jsonb_build_object('field','code'));
  end if;
  if coalesce(btrim(p_name), '') = '' then
    return ops_core.invalid('hr','work_site', v_code,'save',
      'name_required','Lokasi butuh nama.', jsonb_build_object('field','name'));
  end if;
  if p_lat is null or p_lng is null
     or p_lat not between -90 and 90 or p_lng not between -180 and 180 then
    return ops_core.invalid('hr','work_site', v_code,'save',
      'point_required','Titik tengah (lintang dan bujur) harus diisi dan masuk akal.',
      jsonb_build_object('field','lat'));
  end if;
  if p_radius_m is null or p_radius_m not between 20 and 2000 then
    return ops_core.invalid('hr','work_site', v_code,'save',
      'bad_radius','Radius antara 20 dan 2000 meter.',
      jsonb_build_object('field','radius_m','min',20,'max',2000));
  end if;

  insert into ops_hr.work_sites as w (code, name, lat, lng, radius_m, active, updated_by, updated_at)
  values (v_code, btrim(p_name), p_lat, p_lng, p_radius_m, coalesce(p_active, true), auth.uid(), now())
  on conflict (code) do update
     set name = excluded.name, lat = excluded.lat, lng = excluded.lng,
         radius_m = excluded.radius_m, active = excluded.active,
         updated_by = excluded.updated_by, updated_at = excluded.updated_at
  returning w.id into v_id;

  v_res := ops_core.ok('hr','work_site', v_code,'save',
    (select jsonb_build_object('id', w.id, 'code', w.code, 'name', w.name, 'lat', w.lat, 'lng', w.lng,
                               'radius_m', w.radius_m, 'active', w.active, 'updated_at', w.updated_at)
       from ops_hr.work_sites w where w.id = v_id));
  return ops_core.idem_remember('hr','save_work_site', p_key, v_res);
end $$;

revoke execute on function ops_hr.save_work_site(text, text, double precision, double precision, integer, boolean, text) from public;
grant execute on function ops_hr.save_work_site(text, text, double precision, double precision, integer, boolean, text) to authenticated;

-- ── 6. the tap ────────────────────────────────────────────────────────────
drop function if exists ops_hr.tap_self(text);

create or replace function ops_hr.tap_self(
  p_lat double precision default null,
  p_lng double precision default null,
  p_accuracy_m double precision default null,
  p_note text default null,
  p_photo_id uuid default null,
  p_key text default null)
returns jsonb
language plpgsql security definer set search_path = ops_hr, ops_core, pg_temp as $$
declare
  v_replayed jsonb; v_emp uuid; v_emp_no text; v_id uuid; v_at timestamptz := now(); v_res jsonb;
  v_where jsonb; v_verdict text; v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_tap_no text; v_owner uuid;
begin
  v_replayed := ops_core.idem_replay('hr','tap_self', p_key);
  if v_replayed is not null then return v_replayed; end if;

  v_emp := ops_hr.my_employee_id();
  if v_emp is null then
    return ops_core.refused('hr','attendance', null,'tap_self',
      'no_employee_link',
      'Akun ini belum tertaut ke data karyawan, jadi presensi tidak bisa dicatat sendiri. Minta HRD menautkannya.');
  end if;

  -- A reading is a point, or nothing. Half a point is a client bug, not a place.
  if (p_lat is null) <> (p_lng is null)
     or p_lat not between -90 and 90 or p_lng not between -180 and 180
     or p_accuracy_m < 0 then
    return ops_core.invalid('hr','attendance', null,'tap_self',
      'bad_location','Lokasi dari HP tidak utuh atau tidak masuk akal.',
      jsonb_build_object('field','lat'));
  end if;

  v_where := ops_hr.judge_location(p_lat, p_lng, p_accuracy_m);
  v_verdict := v_where ->> 'verdict';

  -- Off-site is recorded, never refused (D326, answer 1) — but it says why.
  -- This refusal is the phone's cue to show the form, so it carries the verdict.
  if (v_where ->> 'needs_note')::boolean and v_note is null then
    return ops_core.invalid('hr','attendance', null,'tap_self',
      'off_site_needs_note',
      case v_verdict
        when 'outside' then format('Anda di luar area %s (%s m dari titiknya). Tulis keterangan, lalu tap lagi.',
                                   v_where ->> 'site_name', round((v_where ->> 'distance_m')::numeric))
        when 'uncertain' then 'Lokasi HP kurang tepat untuk memastikan Anda di area. Tulis keterangan, lalu tap lagi.'
        else 'Lokasi tidak terbaca. Tulis keterangan, lalu tap lagi.'
      end,
      v_where || jsonb_build_object('field','note'));
  end if;

  if p_photo_id is not null then
    select a.uploaded_by into v_owner from ops_core.attachments a where a.id = p_photo_id;
    if not found then
      return ops_core.invalid('hr','attendance', null,'tap_self',
        'photo_not_found','Foto tidak ditemukan. Unggah ulang.', jsonb_build_object('field','photo_id'));
    end if;
    if v_owner is distinct from auth.uid() then
      return ops_core.refused('hr','attendance', null,'tap_self',
        'photo_not_yours','Foto presensi harus diunggah dari akun yang sama.');
    end if;
  end if;

  insert into ops_hr.attendance_scans
    (employee_id, work_date, at, verify, source, recorded_by)
  values (v_emp, ops_core.office_day(v_at), v_at, 'app', 'self', auth.uid())
  returning id into v_id;

  select e.employee_no into v_emp_no from ops_hr.employees e where e.id = v_emp;
  v_tap_no := format('%s/%s', v_emp_no, to_char(v_at at time zone 'Asia/Makassar', 'YYYY-MM-DD"T"HH24:MI:SS.US'));

  insert into ops_hr.scan_locations
    (scan_id, tap_no, site_id, lat, lng, accuracy_m, distance_m, radius_m, verdict, note, photo_id)
  values (v_id, v_tap_no, (v_where ->> 'site_id')::uuid, p_lat, p_lng,
          (v_where ->> 'accuracy_m')::numeric, (v_where ->> 'distance_m')::numeric,
          (v_where ->> 'radius_m')::integer, v_verdict, v_note, p_photo_id);

  -- The photo on the evidence road, filed against this tap, so it is found
  -- from the tap and not only from the drive folder.
  if p_photo_id is not null then
    insert into ops_core.attachment_links (attachment_id, entity, entity_no, kind, note, linked_by)
    values (p_photo_id, 'attendance_scan', v_tap_no, 'foto_presensi', v_note, auth.uid())
    on conflict do nothing;
  end if;

  -- D327 (0184): the office clock, not the session's.
  perform ops_core.record_activity_event('attendance_tap','attendance',
    format('Tap presensi pukul %s%s', to_char(v_at at time zone 'Asia/Makassar', 'HH24:MI'),
           case when (v_where ->> 'needs_note')::boolean then ' · di luar area' else '' end));

  v_res := ops_core.ok('hr','attendance', v_tap_no,'tap_self',
    jsonb_build_object('id', v_id, 'at', v_at, 'work_date', ops_core.office_day(v_at),
                       'tap_no', v_tap_no, 'location', v_where - 'site_id'));
  return ops_core.idem_remember('hr','tap_self', p_key, v_res);
end $$;

revoke execute on function ops_hr.tap_self(double precision, double precision, double precision, text, uuid, text) from public;
grant execute on function ops_hr.tap_self(double precision, double precision, double precision, text, uuid, text) to authenticated;

-- ── 7. HRD's review ───────────────────────────────────────────────────────
-- Every located tap, with who and where. The screen filters to the flagged
-- ones; `flagged` is decided here so it means one thing.
create or replace view ops_hr.v_located_tap with (security_invoker = on) as
select l.tap_no,
       s.id           as scan_id,
       e.employee_no,
       e.full_name,
       e.unit,
       s.at,
       s.work_date,
       l.verdict,
       l.verdict in ('outside','uncertain','no_location') as flagged,
       l.lat, l.lng, l.accuracy_m, l.distance_m, l.radius_m,
       w.code         as site_code,
       w.name         as site_name,
       l.note,
       l.photo_id,
       a.web_view_link as photo_link,
       a.filename     as photo_filename
  from ops_hr.scan_locations l
  join ops_hr.attendance_scans s on s.id = l.scan_id
  join ops_hr.employees e on e.id = s.employee_id
  left join ops_hr.work_sites w on w.id = l.site_id
  left join ops_core.attachments a on a.id = l.photo_id;

grant select on ops_hr.v_located_tap to authenticated;

comment on view ops_hr.v_located_tap is
  'Phone taps with their reading, for HRD''s review of off-site, no-location and uncertain taps. (0188, D332)';
