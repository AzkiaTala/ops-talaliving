-- 0191_core_office_clock_sweep.sql — the office-clock sweep from `0190`,
-- again, for the order production actually ran things in (D334, F191).
--
-- On a fresh ladder this file changes nothing: `0190` runs after `0184` and
-- `0188` and has already rewritten every `'Asia/Makassar'` literal.
--
-- Production ran them in a different order. `0190` was applied at 07:24:15
-- UTC on 2026-09-29, and `0184` at 07:24:48 by another session. `0184`'s
-- `create or replace` put `tap_self`'s activity label back on
-- `'Asia/Makassar'`. D332's `0188` had not been applied yet, and it writes the
-- literal twice more: the label and the tap's code (`tap_no`). A migration
-- number orders the ladder. It does not order a production apply, and a
-- function body is only as current as the last file that wrote it.
--
-- So the sweep lives here too, and it is safe in any order and any number of
-- times: it takes whatever definition is current (`pg_get_functiondef`),
-- replaces only the literal `'Asia/Makassar'` with `ops_core.office_tz()`, and
-- `create or replace` keeps the grants. It then refuses to commit if any
-- `ops_*` function or view still names `Asia/Makassar` or a `+08` literal.
-- **In production, apply it after `0188`.** Applied before `0188`, it fixes
-- `0184`'s label but not the function `0188` brings.
--
-- No data. The attendance shift is `0190`'s, guarded by its marker, and is not
-- repeated here.

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
