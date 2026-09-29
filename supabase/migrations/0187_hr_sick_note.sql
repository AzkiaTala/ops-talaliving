-- 0187_hr_sick_note.sql — the surat dokter travels with the sick request.
--
-- ── what was missing ──────────────────────────────────────────────────────
--
-- D144 pays a sick day only with the doctor's letter attached, and `read_day`
-- looks for that letter on the **day mark** (`entity = 'day_mark'`, kind
-- `surat_dokter`, the mark's public number). A mark only exists once HRD
-- approves. So a production worker asking for *sakit* from a phone (D331) had
-- nowhere to put the photo at the moment they had it in hand — the request
-- existed, the mark did not, and the only road to the mark was HRD's own
-- `attach_surat_dokter`, one day at a time, after the fact.
--
-- ── what this does ────────────────────────────────────────────────────────
--
-- 1. The letter is filed against the **request** (`entity = 'leave_request'`,
--    0187_core_leave_link_entity), by the person asking or by HRD. Nobody
--    else: a link to somebody else's sick request is refused.
-- 2. When the request is approved, `decide_leave` carries every letter on it
--    to each sick mark it covers. A letter that arrives **after** approval is
--    carried the moment it is linked (a trigger), which is D144's own promise:
--    *it can arrive late and the day turns paid the moment it does*.
--    `read_day` is not touched — it still reads the mark, and there is still
--    one place a sick day's pay is decided (A3).
-- 3. `v_leave_request.letter_attached` says so where HRD decides (`/hrd/cuti`).
-- 4. The file goes to the HRD drive (`doc_kind_drive` already maps
--    `surat_dokter` there, 0035 — personal data) in its own task folder under
--    `ops-talaliving` (D313, D320).
--
-- Not done: unlinking the letter from the request does not unlink the copies
-- on the marks. Taking a letter back after the day was paid is a correction
-- HRD makes on the day itself (`/hrd/absensi`), where it can be seen.

-- ── 1. the folder ─────────────────────────────────────────────────────────
insert into ops_core.drive_paths (kind, entity, path, note) values
  ('surat_dokter', null, 'CUTI IZIN SAKIT/SURAT DOKTER',
   'Doctor''s notes — from a sick request on /saya or filed by HRD on the day (D144, D331).')
on conflict (kind, entity) do nothing;

-- ── 2. who may file a letter against a request ────────────────────────────
--
-- `attach_link` lets any signed-in person link any file to any record (0024):
-- evidence is additive and the trail names who did it. A leave request is
-- different in one way — it is somebody's own medical paper, and a stranger
-- attaching one to it could turn their unpaid day into a paid one. So only
-- the requester's own account, or HRD, may.
create or replace function ops_hr.leave_link_rules()
returns trigger
language plpgsql security definer set search_path = ops_hr, ops_core, pg_temp as $$
declare v_emp uuid;
begin
  if new.entity <> 'leave_request' then return new; end if;
  select employee_id into v_emp from ops_hr.leave_requests where request_no = new.entity_no;
  if v_emp is null then
    raise exception using errcode = 'foreign_key_violation',
      message = format('Tidak ada pengajuan %s.', new.entity_no);
  end if;
  if v_emp is distinct from ops_hr.my_employee_id()
     and not ops_core.has_permission('hrd.update') then
    raise exception using errcode = 'insufficient_privilege',
      message = 'Surat untuk pengajuan orang lain hanya bisa dilampirkan HRD.';
  end if;
  return new;
end $$;

revoke all on function ops_hr.leave_link_rules() from public;
-- A trigger function cannot be called on its own; granted to satisfy D218's check.
grant execute on function ops_hr.leave_link_rules() to authenticated;

drop trigger if exists leave_link_rules on ops_core.attachment_links;
create trigger leave_link_rules
  before insert on ops_core.attachment_links
  for each row when (new.entity = 'leave_request')
  execute function ops_hr.leave_link_rules();

-- ── 3. carrying the letter to the days ────────────────────────────────────
--
-- Every live surat dokter on an approved sick request, onto every live sick
-- mark of that person inside its dates. Matched by person, kind and date —
-- not by parsing the mark's reason — so a sick mark HRD typed by hand on one
-- of those days (and that `decide_leave` therefore skipped) gets the letter
-- too: the letter covers the dates, whoever wrote the mark.
create or replace function ops_hr.carry_sick_note(p_request_no text)
returns int
language plpgsql security definer set search_path = ops_hr, ops_core, pg_temp as $$
declare req ops_hr.leave_requests%rowtype; v_n int;
begin
  select * into req from ops_hr.leave_requests where request_no = p_request_no;
  if not found or req.kind <> 'sakit' or req.status <> 'APPROVED' then return 0; end if;

  insert into ops_core.attachment_links (attachment_id, entity, entity_no, kind, note, linked_by)
  select l.attachment_id, 'day_mark', m.mark_no, 'surat_dokter',
         format('Dari pengajuan %s.', req.request_no), l.linked_by
    from ops_core.attachment_links l
    join ops_hr.day_marks m
      on m.employee_id = req.employee_id and m.kind = 'sick' and m.withdrawn_at is null
     and m.work_date between req.from_date and req.to_date
   where l.entity = 'leave_request' and l.entity_no = req.request_no
     and l.kind = 'surat_dokter' and l.unlinked_at is null
  on conflict do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end $$;
-- Granted like every definer (D218), and safe to call by anyone: it decides
-- nothing — it copies a letter that is already on an approved request onto
-- days that are already marked, and does nothing otherwise.
revoke all on function ops_hr.carry_sick_note(text) from public;
grant execute on function ops_hr.carry_sick_note(text) to authenticated;

create or replace function ops_hr.sick_note_arrived()
returns trigger
language plpgsql security definer set search_path = ops_hr, ops_core, pg_temp as $$
begin
  perform ops_hr.carry_sick_note(new.entity_no);
  return null;
end $$;

revoke all on function ops_hr.sick_note_arrived() from public;
grant execute on function ops_hr.sick_note_arrived() to authenticated;

drop trigger if exists sick_note_arrived on ops_core.attachment_links;
create trigger sick_note_arrived
  after insert on ops_core.attachment_links
  for each row when (new.entity = 'leave_request' and new.kind = 'surat_dokter' and new.unlinked_at is null)
  execute function ops_hr.sick_note_arrived();

-- `decide_leave` — 0123's body, with one line added after the marks are
-- written: carry the letter. Everything else is unchanged, in the same order.
create or replace function ops_hr.decide_leave(
  p_request_no text, p_approved boolean, p_note text default null,
  p_key text default null)
returns jsonb
language plpgsql security definer set search_path = ops_hr, ops_core, pg_temp as $$
declare
  v_replayed jsonb; req ops_hr.leave_requests%rowtype; emp ops_hr.employees%rowtype;
  v_kind ops_hr.day_mark_t; d date;
  marked text[] := '{}'; v_skipped text[] := '{}';
  v_letters int := 0;
  v_res jsonb;
begin
  v_replayed := ops_core.idem_replay('hr','decide_leave', p_key);
  if v_replayed is not null then return v_replayed; end if;

  if not ops_core.has_permission('hrd.update') then
    return ops_core.refused('hr','leave_request', p_request_no,'decide',
      'not_permitted','Memutuskan cuti butuh akses HRD.');
  end if;

  select * into req from ops_hr.leave_requests where request_no = p_request_no;
  if not found then
    return ops_core.not_found('hr','leave_request', p_request_no,'decide',
      format('Tidak ada pengajuan %s.', p_request_no));
  end if;
  if req.status <> 'PENDING' then
    return ops_core.conflict('hr','leave_request', p_request_no,'decide',
      'already_decided',
      format('%s sudah %s — tidak ada yang berubah.', req.request_no, lower(req.status::text)));
  end if;
  if not p_approved and coalesce(btrim(coalesce(p_note,'')),'') = '' then
    return ops_core.invalid('hr','leave_request', p_request_no,'decide',
      'reason_required',
      'Penolakan harus punya alasan. Yang ditolak tanpa kalimat tidak bisa dibantah orangnya.',
      jsonb_build_object('field','note'));
  end if;

  select * into emp from ops_hr.employees where id = req.employee_id;

  update ops_hr.leave_requests
     set status = case when p_approved then 'APPROVED' else 'REJECTED' end::ops_hr.leave_status_t,
         decided_by = auth.uid(), decided_at = now(),
         decision_note = nullif(btrim(coalesce(p_note,'')), '')
   where id = req.id;

  if p_approved then
    v_kind := case req.kind when 'cuti' then 'leave'
                            when 'izin' then 'permit'
                            else 'sick' end::ops_hr.day_mark_t;
    for d in select generate_series(req.from_date, req.to_date, interval '1 day')::date loop
      if exists (select 1 from ops_hr.day_marks m
                  where m.work_date = d and m.withdrawn_at is null
                    and (m.employee_id = emp.id or m.employee_id is null)) then
        v_skipped := v_skipped || d::text;
      else
        insert into ops_hr.day_marks (employee_id, work_date, kind, reason, marked_by)
        values (emp.id, d, v_kind,
                format('%s: %s', req.request_no, req.reason), auth.uid());
        marked := marked || d::text;
      end if;
    end loop;
    -- The surat dokter on the request becomes the surat dokter on each day (D144).
    v_letters := ops_hr.carry_sick_note(req.request_no);
  end if;

  v_res := ops_core.ok('hr','leave_request', req.request_no,
    case when p_approved then 'approve' else 'reject' end,
    jsonb_build_object('request_no', req.request_no,
                       'status', case when p_approved then 'APPROVED' else 'REJECTED' end,
                       'marked', to_jsonb(marked), 'skipped', to_jsonb(v_skipped)),
    null,
    jsonb_build_object('employee', emp.employee_no,
                       'marked', to_jsonb(marked), 'skipped', to_jsonb(v_skipped),
                       'letters_carried', v_letters,
                       'note', nullif(btrim(coalesce(p_note,'')), '')));
  return ops_core.idem_remember('hr','decide_leave', p_key, v_res);
end $$;

grant execute on function ops_hr.decide_leave(text, boolean, text, text) to authenticated;

-- ── 4. where HRD decides ──────────────────────────────────────────────────
--
-- 0123's view, with `letter_attached` appended (a replace may only add columns at
-- the end). Derived on read, never stored.
create or replace view ops_hr.v_leave_request
with (security_invoker = on) as
  with req as (
    select r.*, e.employee_no, e.full_name, e.paid_leave_days,
           (r.to_date - r.from_date + 1) as span
      from ops_hr.leave_requests r
      join ops_hr.employees e on e.id = r.employee_id
  ),
  used as (
    select q.id,
           (select count(*) from ops_hr.day_marks m
             where m.employee_id = q.employee_id and m.kind = 'leave'
               and m.withdrawn_at is null
               and extract(year from m.work_date) = extract(year from q.from_date)) as taken
      from req q
  ),
  clash as (
    select q.id,
           coalesce(array_agg(d::date::text order by d) filter (where m.id is not null), '{}') as days
      from req q
      cross join lateral generate_series(q.from_date, q.to_date, interval '1 day') d
      left join ops_hr.day_marks m
        on m.work_date = d::date
       and (m.employee_id = q.employee_id or m.employee_id is null)
       and m.withdrawn_at is null
     group by q.id
  )
  select
    q.id, q.request_no, q.employee_id, q.kind, q.from_date, q.to_date,
    q.span as days, q.reason, q.status,
    q.requested_by, q.requested_at, q.decided_by, q.decided_at, q.decision_note,
    q.employee_no, q.full_name,
    u.full_name as decided_by_name,
    case when q.kind <> 'cuti' then 0
         else least(q.span, greatest(q.paid_leave_days - used.taken, 0)) end as paid_days,
    case when q.kind <> 'cuti' then q.span
         else q.span - least(q.span, greatest(q.paid_leave_days - used.taken, 0)) end as unpaid_days,
    clash.days as clashes,
    exists (select 1 from ops_core.attachment_links al
             where al.entity = 'leave_request' and al.entity_no = q.request_no
               and al.kind = 'surat_dokter' and al.unlinked_at is null) as letter_attached
  from req q
  join used  on used.id  = q.id
  join clash on clash.id = q.id
  left join ops_core.users u on u.id = q.decided_by;

grant select on ops_hr.v_leave_request to authenticated;

analyze ops_core.drive_paths;
