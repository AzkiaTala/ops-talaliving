-- 0175_asst_generic_seam.sql — one kind of write tool: *call this seam, with
-- these fields, after the person says yes* (D317).
--
-- ── What was there ───────────────────────────────────────────────────────
--
-- Three write tools (`procurement.draft_pr_line`, `procurement.draft_po`,
-- `hr.draft_leave`) and each one hand-written twice over: its card in
-- `draftShape`, its confirm branch in `confirmDraft`, once per layer. Adding a
-- fourth meant TypeScript in five places, which is exactly the "wait for a
-- screen" D317 says an interaction without one should not have to do.
--
-- ── What this adds ───────────────────────────────────────────────────────
--
-- A write tool may now **declare** its seam instead of being coded:
--
--   `tool_seams`   which seam the Confirm calls — a named security-definer
--                  function (`rpc`: `ops_mkt.create_market`) or a function the
--                  two API layers both export (`api`: `procurement.quickAddLine`)
--                  — plus the card's headline, a standing sentence under it,
--                  which parameter carries the draft's idempotency key and
--                  which field of the answer names what was produced;
--   `tool_fields`  one row per field on the card: its key, the parameter it
--                  feeds, its type, both labels, whether it is required, and
--                  where its first value comes from (the sentence, today, a
--                  fixed text, or nowhere).
--
-- The client reads `v_tool_seams`, draws every field editable, and on Confirm
-- asks `may_run` again (D219: a grant can go between the draft and the yes),
-- then calls the seam **as the person**, through PostgREST — never from inside
-- a definer function here, for the reason 0039 gives: a definer runs as
-- `postgres`, which has `bypassrls`. The seam decides and its envelope is
-- shown as it came back; refused, invalid and conflict are read out, not
-- turned into a toast that says *failed*.
--
-- ── The boundaries, unchanged ────────────────────────────────────────────
--
--   * **The model never sends SQL** (D300). It picks a tool name, and the
--     arguments it may fill are the `arg` column of that tool's fields —
--     anything else is dropped by the route, as before.
--   * **An `rpc` seam is named here, by a migration, in a module schema.**
--     `ops_core` (identity, grants, the envelope) and `ops_asst` (this
--     catalogue) are refused by a constraint: an assistant that could reach
--     the function granting modules could widen its own rights, and that
--     undoes D219 in one row. The function itself still decides — the
--     catalogue only says which door the Confirm knocks on.
--   * **Nothing here is writable through the API**, the same as `tools`
--     (0038): no insert/update/delete policy, no grant. Adding an action is a
--     migration, reviewed, beside its seam. John Lau does not write schema.
--   * **`blocked` stays blocked** (D218) — `may_run` reads `reach` first, and
--     a seam row changes nothing about that.
--
-- ── What moves onto it ───────────────────────────────────────────────────
--
-- `procurement.draft_pr_line`, as the proof that the generic road carries an
-- existing tool: same seam (`quickAddLine`), same card headline and warning,
-- same fields — with the quantity and its unit as two fields rather than one
-- string split on a space, and a blank quantity refused rather than written
-- as *1 pcs* (D217: a number nobody typed is a number composed). The purpose a
-- person leaves alone is now **shown** on the card (*Diminta lewat John Lau*)
-- instead of substituted after the yes (D220).
--
-- And one new action with no screen: **`marketing.draft_market`** over
-- `ops_mkt.create_market` (0084), which D316 left with a seam and nothing
-- calling it.

-- ── the shapes ───────────────────────────────────────────────────────────

create type ops_asst.seam_kind_t as enum ('rpc','api');
create type ops_asst.field_type_t as enum ('text','number','date','choice');
create type ops_asst.field_default_t as enum ('blank','today','text');

-- The pair a seam row points at. `name` is already unique; the pair lets a
-- foreign key carry `effect` with it, so a seam can only hang off a write.
alter table ops_asst.tools add constraint tools_name_effect_key unique (name, effect);

create table ops_asst.tool_seams (
  tool        text primary key,
  effect      ops_asst.tool_effect_t not null default 'write',
  kind        ops_asst.seam_kind_t not null,
  -- `ops_mkt.create_market` for rpc; `procurement.quickAddLine` for api.
  seam        text not null,
  -- The rpc parameter that carries the draft's idempotency key, so a double
  -- tap is one row (D220). An api seam takes it as its second argument.
  key_param   text,
  -- The key in the seam's answer that names what was written
  -- (`line_no_full`, `code`), shown as *Tersimpan — …*. Null: the answer has
  -- none worth naming, and the card says *confirmed*.
  result_ref  text,
  headline_en text not null,
  headline_id text not null,
  -- A sentence under every card of this kind: what the write does *not* do.
  note_en     text,
  note_id     text,
  note        text,

  constraint seam_is_a_write foreign key (tool, effect)
    references ops_asst.tools (name, effect),
  constraint seam_on_write_only check (effect = 'write'),
  constraint note_both_or_neither check ((note_en is null) = (note_id is null)),
  constraint seam_shape check (
    case kind
      when 'rpc' then seam ~ '^ops_[a-z]+\.[a-z][a-z0-9_]*$'
                  and split_part(seam, '.', 1) not in ('ops_core','ops_asst')
      when 'api' then seam ~ '^[a-z]+\.[a-z][A-Za-z0-9]*$' and key_param is null
    end)
);

comment on table ops_asst.tool_seams is
  'A write tool that is declared rather than coded: the seam its Confirm calls, as the person, '
  'after `may_run` is asked again. rpc seams live in a module schema, never ops_core or '
  'ops_asst — an assistant that could reach the grant functions could widen its own rights '
  '(D219, D317). (0175)';

create table ops_asst.tool_fields (
  tool        text not null references ops_asst.tool_seams (tool) on delete cascade,
  seq         int  not null,
  -- The card's key and the confirm payload's key. Never a label (see
  -- `AssistantDraft.fields`): a label changes with the language in force.
  key         text not null,
  -- The seam parameter this field feeds: `p_code` for rpc, `description` for api.
  param       text not null,
  type        ops_asst.field_type_t not null default 'text',
  required    boolean not null default false,
  label_en    text not null,
  label_id    text not null,
  choices     text[],
  -- Which argument of the sentence fills it — the router's `extract_args`, or
  -- the model's pick. These are also **the only keys a model may send** for
  -- this tool (D300); the route drops the rest.
  arg         text,
  default_kind ops_asst.field_default_t not null default 'blank',
  default_en  text,
  default_id  text,

  primary key (tool, key),
  unique (tool, seq),
  unique (tool, param),
  constraint key_shape check (key ~ '^[a-z][a-z0-9_]*$'),
  constraint choice_has_choices check ((type = 'choice') = (coalesce(cardinality(choices), 0) > 0)),
  constraint today_is_a_date check (default_kind <> 'today' or type = 'date'),
  constraint text_default_says_it check (
    (default_kind = 'text') = (default_en is not null and default_id is not null))
);

comment on table ops_asst.tool_fields is
  'Every field a declared write shows, editable, before the yes. What is written is what the '
  'card shows after the person edits it (D220); a blank required field is refused, never '
  'filled in by the assistant (D217). (0175)';

alter table ops_asst.tool_seams  enable row level security;
alter table ops_asst.tool_fields enable row level security;
create policy tool_seams_read  on ops_asst.tool_seams  for select to authenticated using (true);
create policy tool_fields_read on ops_asst.tool_fields for select to authenticated using (true);
grant select on ops_asst.tool_seams, ops_asst.tool_fields to authenticated;

-- ── what the client reads ────────────────────────────────────────────────

create or replace view ops_asst.v_tool_seams as
  select s.tool, s.kind, s.seam, s.key_param, s.result_ref,
         s.headline_en, s.headline_id, s.note_en, s.note_id,
         coalesce((
           select jsonb_agg(jsonb_build_object(
                    'key', f.key, 'param', f.param, 'type', f.type,
                    'required', f.required,
                    'label_en', f.label_en, 'label_id', f.label_id,
                    'choices', to_jsonb(f.choices), 'arg', f.arg,
                    'default_kind', f.default_kind,
                    'default_en', f.default_en, 'default_id', f.default_id)
                  order by f.seq)
             from ops_asst.tool_fields f where f.tool = s.tool), '[]'::jsonb) as fields
    from ops_asst.tool_seams s;

alter view ops_asst.v_tool_seams set (security_invoker = on);
grant select on ops_asst.v_tool_seams to authenticated;

comment on view ops_asst.v_tool_seams is
  'One row per declared write tool, its fields in card order. Read by both the dock and the '
  'model route (the `arg` column is the list of keys a model may fill, D300). (0175)';

-- ── is every declared seam really there ──────────────────────────────────

/* The catalogue names functions by text, so nothing stops a row naming one
 * that was renamed, or a parameter that is not there. This answers *what is
 * wrong with the declared seams*, one row per problem, and the smoke suite
 * asserts it is empty. Only `rpc` seams can be checked here; an `api` seam is
 * TypeScript and `scripts/check-john-lau.mjs` checks both layers export it.
 *
 * Plain `security invoker`: it reads only `pg_catalog` and the catalogue,
 * both readable by everybody already. */
create or replace function ops_asst.seam_problems()
returns table (tool text, problem text)
language sql stable security invoker set search_path = ops_asst, pg_catalog, pg_temp as $$
  with rpc as (
    select s.tool, s.seam, s.key_param,
           split_part(s.seam, '.', 1) as nsp, split_part(s.seam, '.', 2) as fn
      from ops_asst.tool_seams s where s.kind = 'rpc'),
  fns as (
    select r.tool, p.oid, p.prosecdef, p.proargnames, p.pronargs, p.pronargdefaults
      from rpc r
      join pg_namespace n on n.nspname = r.nsp
      join pg_proc p on p.pronamespace = n.oid and p.proname = r.fn)
  select r.tool, format('%s does not exist', r.seam)
    from rpc r where not exists (select 1 from fns f where f.tool = r.tool)
  union all
  select f.tool, 'is overloaded — the call would be ambiguous'
    from fns f group by f.tool having count(*) > 1
  union all
  select f.tool, 'is not security definer — the seam must decide inside'
    from fns f where not f.prosecdef
  union all
  select f.tool, 'is not executable by authenticated'
    from fns f where not has_function_privilege('authenticated', f.oid, 'EXECUTE')
  union all
  select x.tool, format('field %s feeds %s, which is not a parameter', x.key, x.param)
    from (select t.tool, t.key, t.param from ops_asst.tool_fields t
            join rpc r on r.tool = t.tool) x
    join fns f on f.tool = x.tool
   where not (x.param = any (f.proargnames))
  union all
  select r.tool, format('key_param %s is not a parameter', r.key_param)
    from rpc r join fns f on f.tool = r.tool
   where r.key_param is not null and not (r.key_param = any (f.proargnames))
  union all
  -- A parameter with no default that no field feeds: the call would fail on
  -- every Confirm, with an error about a function rather than a field.
  select f.tool, format('parameter %s has no default and no field feeds it', a.name)
    from fns f
    cross join lateral unnest(f.proargnames) with ordinality a(name, pos)
   where a.pos <= f.pronargs - f.pronargdefaults
     and a.name is distinct from (select r.key_param from rpc r where r.tool = f.tool)
     and not exists (select 1 from ops_asst.tool_fields t
                      where t.tool = f.tool and t.param = a.name)
$$;

grant execute on function ops_asst.seam_problems() to authenticated;

-- ── the proof: an existing tool, moved onto the generic road ─────────────

insert into ops_asst.tool_seams
  (tool, kind, seam, key_param, result_ref, headline_en, headline_id, note_en, note_id, note)
values
  ('procurement.draft_pr_line', 'api', 'procurement.quickAddLine', null, 'line_no_full',
   'New purchase request line', 'Baris permintaan pembelian baru',
   'This goes in as a request, not as an approval. Approving it stays a person''s act, on the meeting board.',
   'Baris ini masuk sebagai permintaan, bukan sebagai persetujuan. Yang menyetujui tetap orang, di papan rapat.',
   'Moved from draftShape/confirmDraft to the declared road (0175, D317).');

insert into ops_asst.tool_fields
  (tool, seq, key, param, type, required, label_en, label_id, arg, default_kind, default_en, default_id)
values
  ('procurement.draft_pr_line', 1, 'item',    'description', 'text',   true,  'Item',     'Barang',    'name',    'blank', null, null),
  ('procurement.draft_pr_line', 2, 'qty',     'qty',         'number', true,  'Quantity', 'Jumlah',    'qty',     'blank', null, null),
  ('procurement.draft_pr_line', 3, 'uom',     'uom',         'text',   true,  'Unit',     'Satuan',    'uom',     'blank', null, null),
  ('procurement.draft_pr_line', 4, 'purpose', 'purpose',     'text',   false, 'Purpose',  'Keperluan', 'purpose', 'text',
     'Requested through John Lau', 'Diminta lewat John Lau');

-- ── the first action with no screen: a market (D316, D317) ───────────────

insert into ops_asst.tools
  (name, module, level, effect, reach, label_en, label_id, blocked_reason_en, blocked_reason_id, instead_at, sort_order, note)
values
  ('marketing.draft_market', 'marketing', 'write', 'write', 'open',
   'Define a new market', 'Menyiapkan pasar baru',
   null, null, '/marketing/pipeline', 33,
   'No screen calls ops_mkt.create_market (D316); the declared road is its form (0175, D317).');

insert into ops_asst.tool_seams
  (tool, kind, seam, key_param, result_ref, headline_en, headline_id, note_en, note_id, note)
values
  ('marketing.draft_market', 'rpc', 'ops_mkt.create_market', 'p_key', 'code',
   'New market', 'Pasar baru',
   'The code is COUNTRY[-REGION]-CITY-AREA and every filter is a prefix of it. The database checks the code, the country, the currency and the time zone, and says which one is wrong.',
   'Kodenya NEGARA[-WILAYAH]-KOTA-AREA dan setiap filter adalah awalan dari kode itu. Database memeriksa kode, negara, mata uang dan zona waktunya, dan menyebut mana yang salah.',
   null);

insert into ops_asst.tool_fields
  (tool, seq, key, param, type, required, label_en, label_id, arg, default_kind, default_en, default_id)
values
  ('marketing.draft_market', 1, 'code',         'p_code',         'text', true,  'Market code (e.g. AU-QLD-GOLDCOAST-SPNORTH)', 'Kode pasar (mis. AU-QLD-GOLDCOAST-SPNORTH)', 'code',         'blank', null, null),
  ('marketing.draft_market', 2, 'country_code', 'p_country_code', 'text', true,  'Country code (ISO, 2 letters)',               'Kode negara (ISO, 2 huruf)',                  'country_code', 'blank', null, null),
  ('marketing.draft_market', 3, 'country_name', 'p_country_name', 'text', true,  'Country',                                     'Negara',                                      'country_name', 'blank', null, null),
  ('marketing.draft_market', 4, 'region',       'p_region',       'text', false, 'Region / state',                              'Wilayah / provinsi',                          'region',       'blank', null, null),
  ('marketing.draft_market', 5, 'city',         'p_city',         'text', true,  'City',                                        'Kota',                                        'city',         'blank', null, null),
  ('marketing.draft_market', 6, 'area_label',   'p_area_label',   'text', true,  'Area, as it is called there',                 'Area, sebutan setempat',                      'area_label',   'blank', null, null),
  ('marketing.draft_market', 7, 'currency',     'p_currency',     'text', true,  'Currency (ISO, 3 letters)',                   'Mata uang (ISO, 3 huruf)',                    'currency',     'blank', null, null),
  ('marketing.draft_market', 8, 'timezone',     'p_timezone',     'text', true,  'Time zone (e.g. Australia/Brisbane)',         'Zona waktu (mis. Australia/Brisbane)',        'timezone',     'blank', null, null),
  ('marketing.draft_market', 9, 'language',     'p_language',     'text', false, 'Outreach language',                           'Bahasa penjangkauan',                         'language',     'text', 'en', 'en');

-- A writing rule, after the blocked ones and beside the other writes.
insert into ops_asst.rules (seq, tool, stage, all_words, any_words, not_words, understood_en, understood_id, note) values
 (63,'marketing.draft_market','main','{}',
     '{"pasar baru","buat pasar","tambah pasar","bikin pasar","daftarkan pasar","new market","add a market","create a market","define a market"}',
     '{}','defining a new market','menyiapkan pasar baru', null);

analyze ops_asst.tool_seams;
analyze ops_asst.tool_fields;
