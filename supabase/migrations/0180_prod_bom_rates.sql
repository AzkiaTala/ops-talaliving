-- 0180_prod_bom_rates.sql — a price-rate list for estimating a BOM, a
-- *komponen* on every BOM line, and the seams that keep both honest (D323).
--
-- ── What the owner asked ──────────────────────────────────────────────────
--
-- *Cek di modul BOM tambahkan 1 kolom sebelum di komponen, yaitu komponen -
-- material - kebutuhan per item - satuan - rate. Misal: Kaki kaki - kayu mindi
-- grade A - 0.23 - m3 - 120.000.*
--
-- *Kita juga perlu update database selain items yang didapat dari transaksi
-- perlu menyusun price rate sebagai bahan bom. Yang berisi rate karton, rate
-- kayu mindi grade A, rate kayu jati grade C, rate finishing, rate labour,
-- rate packing dst.*
--
-- And an AI that reads the gambar kerja and proposes the lines. The model is
-- called from a server route (`/api/production/bom/suggest`) and **writes
-- nothing**: a person checks every proposed line and adds it through
-- `save_bom_line`, as themselves, like any line typed by hand (D200's rule for
-- a model's reading). Nothing in this migration knows a model exists.
--
-- ── What this adds ────────────────────────────────────────────────────────
--
-- 1. `ops_prod.bom_rates`: the estimator's price list. The item database is
--    what procurement has bought, priced at what it paid; this is what the
--    estimator costs a BOM at — kayu mindi grade A per m³, finishing per m²,
--    a carpenter's day, packing per unit — including things that are never
--    bought as an item (labour, finishing as a service). A rate may name the
--    item it stands for (`item_code`), so a line priced from it still points
--    at something procurement can buy and the storeman can issue.
-- 2. `bom_components.part`: the *komponen* — *Kaki-kaki*, *Top*, *Rangka*. The
--    material is still `ref_code`. Two parts of the same table may both be
--    kayu mindi, so *one line per material per revision* becomes *one line per
--    material per part per revision*.
-- 3. `bom_components.rate_code`: the rate the line follows. Left without a
--    typed rate, a draft line follows the rate list live, the way a material
--    follows the catalogue; releasing freezes it with `rate_source = 'rate'`.
-- 4. `ops_prod.save_bom_rate`: the one road to change the list, behind
--    `production.update` — the authority that edits a BOM (default taken in
--    D323; the owner may move it to procurement).

-- ── 1. the rate list ──────────────────────────────────────────────────────

create table if not exists ops_prod.bom_rates (
  id          uuid primary key default gen_random_uuid(),
  -- `RT-0001`. Set by the seam and never changed: a BOM line names it.
  code        text not null unique check (code ~ '^RT-[0-9]{4,}$'),
  name        text not null check (length(btrim(name)) > 0),
  -- Kayu, other material, finishing, labour, packing, anything else. Decides
  -- which kind of BOM line a rate becomes (labour → a labour line) and how the
  -- list is filtered; not a hierarchy.
  rate_group  text not null check (rate_group in ('kayu','material','finishing','labour','packing','lain')),
  -- Free text, not `ops_procure.uom`: a carpenter's day (`hari`) and an hour
  -- (`jam`) are units a rate is quoted in and nothing is bought in.
  uom         text not null check (length(btrim(uom)) > 0),
  -- Rupiah per `uom`. Named `unit_rate`, not `rate`, like the BOM line's own:
  -- `check_shadowing.sh` treats every column name as off-limits to a PL/pgSQL
  -- local, and four payroll functions already declare a local `rate`.
  unit_rate   numeric not null check (unit_rate >= 0),
  -- The purchasable item this rate stands for, by code at the seam like every
  -- BOM reference (ADR-004) — not a foreign key.
  item_code   text,
  note        text,
  -- Retired rather than deleted: a released BOM line froze the figure, and a
  -- draft still following it should say what it followed.
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  created_by  uuid references ops_core.users(id),
  updated_at  timestamptz not null default now(),
  updated_by  uuid references ops_core.users(id)
);

-- One active rate per name. *Kayu mindi grade A* twice is two prices for one
-- thing, and whichever the next BOM picks is an accident.
create unique index if not exists bom_rates_name_once
  on ops_prod.bom_rates (lower(btrim(name))) where active;

alter table ops_prod.bom_rates enable row level security;
-- Read like the BOM it prices: by everybody signed in (0060). Written only
-- through `save_bom_rate`, so there is no insert or update policy at all.
drop policy if exists bomrate_read on ops_prod.bom_rates;
create policy bomrate_read on ops_prod.bom_rates for select to authenticated using (true);
grant select on ops_prod.bom_rates to authenticated;

-- ── 2. the line: a part, and the rate it follows ──────────────────────────

alter table ops_prod.bom_components
  -- *Komponen* — Kaki-kaki, Top, Rangka. Null on lines written before it
  -- existed, which read as they always did.
  add column if not exists part      text,
  -- `bom_rates.code`. Null for a line that follows the catalogue or carries
  -- only a typed rate.
  add column if not exists rate_code text;

alter table ops_prod.bom_components drop constraint if exists part_not_blank;
alter table ops_prod.bom_components add constraint part_not_blank check (
  part is null or length(btrim(part)) > 0);

-- One line per material **per part** per revision. Kayu mindi for the legs and
-- kayu mindi for the top are two lines; kayu mindi for the legs twice is still
-- refused (`save_bom_line` says so before the index does).
alter table ops_prod.bom_components drop constraint if exists component_once;
create unique index if not exists bom_component_once_idx
  on ops_prod.bom_components (product_id, rev, ref_code, lower(coalesce(part, '')));

alter table ops_prod.bom_components drop constraint if exists rate_source_known;
alter table ops_prod.bom_components add constraint rate_source_known check (
  rate_source is null or rate_source in ('manual','standard','last_paid','sub_assembly','rate'));

-- A labour line is a name and a rate — typed, or taken from the rate list.
alter table ops_prod.bom_components drop constraint if exists labour_is_named_and_priced;
alter table ops_prod.bom_components add constraint labour_is_named_and_priced check (
  kind <> 'labour'
  or (label is not null and length(btrim(label)) > 0
      and (unit_rate is not null or rate_code is not null)));

-- ── 3. what one line costs ────────────────────────────────────────────────
--
-- One step added between the line's own rate and the catalogue: the rate it
-- follows from the list. A typed rate still wins; a released line still reads
-- its frozen figure.
create or replace function ops_prod.line_rate(
  p_component_id uuid, p_depth int default 0,
  out rate numeric, out source text)
language plpgsql stable set search_path = ops_prod, ops_procure, pg_temp as $$
declare c ops_prod.bom_components; v_sub uuid; v_cost ops_prod.bom_cost_t;
begin
  select * into c from ops_prod.bom_components where id = p_component_id;
  if not found then return; end if;

  if c.unit_rate is not null then
    rate := c.unit_rate; source := c.rate_source; return;
  end if;

  if c.rate_code is not null then
    select r.unit_rate into rate from ops_prod.bom_rates r where r.code = c.rate_code;
    if rate is not null then source := 'rate'; return; end if;
  end if;

  if c.kind = 'material' then
    select coalesce(i.standard_price, i.last_price),
           case when i.standard_price is not null then 'standard'
                when i.last_price     is not null then 'last_paid' end
      into rate, source
      from ops_procure.items i where i.code = c.ref_code;
  elsif c.kind = 'product' and p_depth < 8 then
    select id into v_sub from ops_prod.products where product_code = c.ref_code;
    if v_sub is not null and ops_prod.released_rev(v_sub) is not null then
      v_cost := ops_prod.bom_cost(v_sub, ops_prod.released_rev(v_sub), p_depth + 1);
      if v_cost.production_cost is not null then
        rate := v_cost.production_cost; source := 'sub_assembly';
      end if;
    end if;
  end if;
end $$;

-- Same columns in the same order as `0109`, the new ones after. A material
-- that exists only on the rate list (`ref_code` = its `RT-` code) is named from
-- the list; `catalogue_price` is the list's figure where the line follows one,
-- so a typed rate far from it is still a question worth seeing.
create or replace view ops_prod.v_product_bom as
select
  c.id,
  c.product_id,
  p.product_code,
  c.rev,
  c.kind,
  c.ref_code,
  case when c.kind = 'labour' then c.label else coalesce(i.name, sub.name, rr.name) end as ref_name,
  c.qty,
  c.uom,
  c.waste_percent,
  round(c.qty * (1 + c.waste_percent / 100), 4)        as qty_with_waste,
  lr.rate                                              as unit_price,
  lr.source                                            as price_source,
  case when lr.rate is null then null
       else round(c.qty * (1 + c.waste_percent / 100) * lr.rate) end as subtotal,
  c.note,
  c.label,
  c.unit_rate,
  c.rate_source,
  coalesce(rt.unit_rate, i.standard_price, i.last_price) as catalogue_price,
  i.category_code                                      as item_category_code,
  c.part,
  c.rate_code,
  rt.name                                              as rate_name,
  rt.rate_group
from ops_prod.bom_components c
join ops_prod.products p on p.id = c.product_id
left join ops_procure.items i on i.code = c.ref_code and c.kind = 'material'
left join ops_prod.products sub on sub.product_code = c.ref_code and c.kind = 'product'
left join ops_prod.bom_rates rt on rt.code = c.rate_code
left join ops_prod.bom_rates rr on rr.code = c.ref_code and c.kind = 'material'
left join lateral ops_prod.line_rate(c.id) lr on true;

-- The purchase walk (0065), with one fallback: a material that is only on the
-- rate list is named and priced from it rather than reported as nameless.
create or replace function ops_prod.explode_bom(
  p_product_code text, p_qty numeric, p_rev int default null)
returns setof ops_prod.bom_exploded_line
language sql stable set search_path = ops_prod, pg_temp as $$
  with recursive root as (
    select p.id, p.product_code, coalesce(p_rev, ops_prod.start_rev(p.id)) as rev
      from ops_prod.products p where p.product_code = p_product_code
  ),
  walk as (
    select
      c.ref_code,
      c.kind,
      c.uom,
      (p_qty * c.qty * (1 + c.waste_percent / 100))::numeric as amount,
      array[r.product_code]::text[]                          as chain,
      array[]::text[]                                        as path,
      1                                                      as depth
    from root r
    join ops_prod.bom_components c on c.product_id = r.id and c.rev = r.rev
    union all
    select
      c.ref_code,
      c.kind,
      c.uom,
      (w.amount * c.qty * (1 + c.waste_percent / 100))::numeric,
      w.chain || sub.product_code,
      w.path  || sub.product_code,
      w.depth + 1
    from walk w
    join ops_prod.products sub on sub.product_code = w.ref_code
    join ops_prod.bom_components c
      on c.product_id = sub.id and c.rev = ops_prod.released_rev(sub.id)
    where w.kind = 'product'
      and not (sub.product_code = any(w.chain))
  ),
  classified as (
    select
      w.*,
      (w.kind = 'product' and w.ref_code = any(w.chain))            as is_cycle,
      (w.kind = 'product' and w.ref_code <> all(w.chain)
       and not exists (
         select 1 from ops_prod.products s
           join ops_prod.bom_components bc
             on bc.product_id = s.id and bc.rev = ops_prod.released_rev(s.id)
          where s.product_code = w.ref_code))                       as is_unexploded
    from walk w
  ),
  kept as (
    select * from classified where kind = 'material' or is_cycle or is_unexploded
  ),
  merged as (
    select
      k.ref_code,
      min(k.kind::text)                                        as kind,
      round(sum(k.amount), 4)                                  as qty,
      min(k.uom)                                               as uom,
      max(k.depth)                                             as depth,
      bool_or(k.is_unexploded)                                 as unexploded,
      bool_or(k.is_cycle)                                      as cycle,
      array_agg(distinct case when cardinality(k.path) = 0 then '—'
                              else array_to_string(k.path, ' > ') end) as via
    from kept k group by k.ref_code
  )
  select
    m.ref_code,
    coalesce(i.name, sub.name, rt.name),
    m.kind::ops_prod.bom_ref_t,
    m.qty,
    m.uom,
    coalesce(i.standard_price, i.last_price, rt.unit_rate),
    case when i.standard_price is not null then 'standard'
         when i.last_price     is not null then 'last_paid'
         when rt.unit_rate     is not null then 'rate'
         else null end,
    case when coalesce(i.standard_price, i.last_price, rt.unit_rate) is null then null
         else round(m.qty * coalesce(i.standard_price, i.last_price, rt.unit_rate))::bigint end,
    m.via,
    m.depth,
    m.unexploded,
    m.cycle
  from merged m
  left join ops_procure.items i    on i.code = m.ref_code and m.kind = 'material'
  left join ops_prod.products sub  on sub.product_code = m.ref_code and m.kind = 'product'
  left join ops_prod.bom_rates rt  on rt.code = m.ref_code and m.kind = 'material'
  order by m.depth, m.ref_code
$$;

-- The list as the rate screen reads it: the linked item's name, who last
-- changed it, and how many products' current BOMs follow it — the number that
-- says what a change here moves.
create or replace view ops_prod.v_bom_rate as
select
  r.id,
  r.code,
  r.name,
  r.rate_group,
  r.uom,
  r.unit_rate,
  r.item_code,
  i.name                                               as item_name,
  r.note,
  r.active,
  r.created_at,
  r.updated_at,
  u.full_name                                          as updated_by_name,
  (select count(distinct c.product_id)::int
     from ops_prod.bom_components c
    where c.rate_code = r.code
      and c.rev = ops_prod.start_rev(c.product_id))    as used_by
from ops_prod.bom_rates r
left join ops_procure.items i on i.code = r.item_code
left join ops_core.users u on u.id = r.updated_by;

alter view ops_prod.v_product_bom set (security_invoker = on);
alter view ops_prod.v_bom_rate    set (security_invoker = on);
grant select on ops_prod.v_bom_rate to authenticated;

-- ── 4. the seams ──────────────────────────────────────────────────────────

-- The next draft copies the part and the rate a line follows. A line that
-- follows the list goes back to following it — the frozen figure is let go,
-- exactly like a catalogue rate (0109) — so the draft prices at today's list.
create or replace function ops_prod.open_draft(p_product_id uuid)
returns int
language plpgsql security definer set search_path = ops_prod, pg_temp as $$
declare v_rev int; v_from int; v_misc numeric;
begin
  select rev into v_rev from ops_prod.bom_revisions
   where product_id = p_product_id and released_at is null;
  if v_rev is not null then return v_rev; end if;

  v_from := ops_prod.released_rev(p_product_id);
  v_rev := coalesce((select max(rev) from ops_prod.bom_revisions where product_id = p_product_id), 0) + 1;
  select miscalc_percent into v_misc from ops_prod.bom_revisions
   where product_id = p_product_id and rev = v_from;

  insert into ops_prod.bom_revisions (product_id, rev, miscalc_percent, created_by)
  values (p_product_id, v_rev, coalesce(v_misc, 0), auth.uid());

  if v_from is not null then
    insert into ops_prod.bom_components
      (product_id, rev, kind, ref_code, qty, uom, waste_percent, note, label,
       unit_rate, rate_source, part, rate_code)
    select product_id, v_rev, kind, ref_code, qty, uom, waste_percent, note, label,
           case when rate_source = 'manual' or (kind = 'labour' and rate_code is null) then unit_rate end,
           case when rate_source = 'manual' or (kind = 'labour' and rate_code is null) then 'manual' end,
           part, rate_code
      from ops_prod.bom_components
     where product_id = p_product_id and rev = v_from;
  end if;
  return v_rev;
end $$;
revoke all on function ops_prod.open_draft(uuid) from public;

-- A line on the draft, with its part and the rate it follows. Two parameters
-- appended, so every positional call written against `0109` still reads the
-- same; the old signature is dropped rather than overloaded, because two
-- `save_bom_line`s with defaults are one PostgREST call that cannot decide.
drop function if exists ops_prod.save_bom_line(text, uuid, text, text, text, numeric, text, numeric, numeric, text);

create or replace function ops_prod.save_bom_line(
  p_product_code text,
  p_component_id uuid default null,
  p_kind text default 'material',
  p_ref_code text default null,
  p_label text default null,
  p_qty numeric default null,
  p_uom text default null,
  p_unit_rate numeric default null,
  p_waste_percent numeric default 0,
  p_note text default null,
  p_part text default null,
  p_rate_code text default null)
returns jsonb
language plpgsql security definer set search_path = ops_prod, ops_core, pg_temp as $$
declare p ops_prod.products; v_kind ops_prod.bom_ref_t; v_rev int; v_ref text;
        v_label text := nullif(btrim(coalesce(p_label, '')), '');
        v_part text := nullif(btrim(coalesce(p_part, '')), '');
        v_rate_code text := nullif(upper(btrim(coalesce(p_rate_code, ''))), '');
        v_rate ops_prod.bom_rates;
        existing ops_prod.bom_components; v_id uuid;
begin
  if not ops_core.has_permission('production.update') then
    return ops_core.refused('production','bom', p_product_code,'save_line',
      'not_permitted','Mengubah BOM butuh akses produksi (update).');
  end if;
  select * into p from ops_prod.products where product_code = p_product_code;
  if not found then
    return ops_core.not_found('production','bom', p_product_code,'save_line',
      format('Tidak ada produk %s.', p_product_code));
  end if;

  begin
    v_kind := p_kind::ops_prod.bom_ref_t;
  exception when invalid_text_representation then
    return ops_core.invalid('production','bom', p_product_code,'save_line',
      'unknown_kind', format('"%s" bukan jenis komponen.', p_kind), jsonb_build_object('field','kind'));
  end;

  if p_qty is null or p_qty <= 0 then
    return ops_core.invalid('production','bom', p_product_code,'save_line',
      'qty_required','Kebutuhan per unit harus lebih dari nol.', jsonb_build_object('field','qty'));
  end if;
  if p_unit_rate is not null and p_unit_rate < 0 then
    return ops_core.invalid('production','bom', p_product_code,'save_line',
      'negative_rate','Rate tidak bisa negatif.', jsonb_build_object('field','unit_rate'));
  end if;
  if coalesce(p_waste_percent, 0) < 0 or coalesce(p_waste_percent, 0) > 90 then
    return ops_core.invalid('production','bom', p_product_code,'save_line',
      'waste_out_of_range','Susut antara 0 dan 90%.', jsonb_build_object('field','waste_percent'));
  end if;

  if v_rate_code is not null then
    select * into v_rate from ops_prod.bom_rates where code = v_rate_code;
    if not found then
      return ops_core.invalid('production','bom', p_product_code,'save_line',
        'unknown_rate', format('Tidak ada rate %s di daftar rate BOM.', v_rate_code),
        jsonb_build_object('field','rate_code'));
    end if;
    if v_kind = 'product' then
      return ops_core.invalid('production','bom', p_product_code,'save_line',
        'rate_on_sub_assembly','Sub-rakitan dihitung dari BOM-nya sendiri, bukan dari daftar rate.',
        jsonb_build_object('field','rate_code'));
    end if;
  end if;

  if v_kind = 'labour' then
    v_label := coalesce(v_label, v_rate.name);
    if v_label is null then
      return ops_core.invalid('production','bom', p_product_code,'save_line',
        'label_required','Tenaga kerja apa? Mis. "Tukang finishing".', jsonb_build_object('field','label'));
    end if;
    if p_unit_rate is null and v_rate_code is null then
      return ops_core.invalid('production','bom', p_product_code,'save_line',
        'rate_required','Tenaga kerja butuh rate — upah per hari, per jam, atau per unit, diketik atau dari daftar rate.',
        jsonb_build_object('field','unit_rate'));
    end if;
    v_ref := 'LABOUR:' || upper(left(regexp_replace(v_label, '[^A-Za-z0-9]+', '-', 'g'), 40));
  else
    v_ref := upper(btrim(coalesce(p_ref_code, '')));
    -- Picked from the rate list: the item it stands for, else the rate itself.
    if v_ref = '' and v_rate_code is not null then
      v_ref := coalesce(nullif(upper(btrim(coalesce(v_rate.item_code, ''))), ''), v_rate.code);
    end if;
    if v_ref = '' then
      return ops_core.invalid('production','bom', p_product_code,'save_line',
        'ref_required','Materialnya apa?', jsonb_build_object('field','ref_code'));
    end if;
    if v_kind = 'product' and ops_prod.would_cycle(p.product_code, v_ref) then
      return ops_core.invalid('production','bom', p_product_code,'save_line',
        'bom_cycle', format('%s memuat %s (langsung atau lewat sub-rakitan) — rakitan yang memuat dirinya sendiri tidak punya biaya yang terhingga.', v_ref, p.product_code),
        jsonb_build_object('field','ref_code'));
    end if;
  end if;

  if p_component_id is not null then
    select * into existing from ops_prod.bom_components where id = p_component_id and product_id = p.id;
    if not found then
      return ops_core.not_found('production','bom', p_product_code,'save_line','Baris itu tidak ada.');
    end if;
  end if;

  v_rev := ops_prod.open_draft(p.id);

  -- Edited from a released revision: the edit lands on that line's copy in
  -- the draft — the same material for the same part. The released line itself
  -- is never touched (A5).
  if existing.id is not null and existing.rev <> v_rev then
    select id into v_id from ops_prod.bom_components
     where product_id = p.id and rev = v_rev and ref_code = existing.ref_code
       and lower(coalesce(part, '')) = lower(coalesce(existing.part, ''));
    p_component_id := v_id;
    v_id := null;
  end if;

  if exists (select 1 from ops_prod.bom_components
              where product_id = p.id and rev = v_rev and ref_code = v_ref
                and lower(coalesce(part, '')) = lower(coalesce(v_part, ''))
                and id is distinct from p_component_id) then
    return ops_core.conflict('production','bom', p_product_code,'save_line',
      'already_on_bom', format('%s%s sudah ada di BOM ini — ubah jumlahnya, jangan tambah baris kedua.',
        coalesce(v_label, v_rate.name, v_ref),
        case when v_part is null then '' else ' untuk ' || v_part end));
  end if;

  if p_component_id is not null then
    update ops_prod.bom_components set
      kind = v_kind, ref_code = v_ref, label = v_label, qty = p_qty,
      uom = coalesce(nullif(btrim(p_uom), ''), v_rate.uom, uom),
      waste_percent = coalesce(p_waste_percent, 0),
      unit_rate = p_unit_rate,
      rate_source = case when p_unit_rate is null then null else 'manual' end,
      note = nullif(btrim(p_note), ''),
      part = v_part,
      rate_code = v_rate_code
    where id = p_component_id
    returning id into v_id;
  else
    insert into ops_prod.bom_components
      (product_id, rev, kind, ref_code, label, qty, uom, waste_percent, unit_rate, rate_source,
       note, part, rate_code)
    values (p.id, v_rev, v_kind, v_ref, v_label, p_qty,
      coalesce(nullif(btrim(p_uom), ''), v_rate.uom, 'pcs'), coalesce(p_waste_percent, 0),
      p_unit_rate, case when p_unit_rate is null then null else 'manual' end,
      nullif(btrim(p_note), ''), v_part, v_rate_code)
    returning id into v_id;
  end if;

  return ops_core.ok('production','bom', p_product_code,
    case when p_component_id is null then 'add_line' else 'update_line' end,
    jsonb_build_object('component_id', v_id, 'rev', v_rev, 'ref_code', v_ref, 'part', v_part),
    case when existing.id is null then null else to_jsonb(existing) end,
    (select to_jsonb(x) from ops_prod.bom_components x where x.id = v_id));
end $$;

-- Taking a line off a released revision takes off its copy in the draft — the
-- same material for the same part.
create or replace function ops_prod.remove_bom_line(p_product_code text, p_component_id uuid)
returns jsonb
language plpgsql security definer set search_path = ops_prod, ops_core, pg_temp as $$
declare p ops_prod.products; c ops_prod.bom_components; v_rev int; v_ref text; v_part text;
begin
  if not ops_core.has_permission('production.update') then
    return ops_core.refused('production','bom', p_product_code,'remove_line',
      'not_permitted','Mengubah BOM butuh akses produksi (update).');
  end if;
  select * into p from ops_prod.products where product_code = p_product_code;
  if not found then
    return ops_core.not_found('production','bom', p_product_code,'remove_line',
      format('Tidak ada produk %s.', p_product_code));
  end if;
  select * into c from ops_prod.bom_components where id = p_component_id and product_id = p.id;
  if not found then
    return ops_core.not_found('production','bom', p_product_code,'remove_line','Baris itu tidak ada.');
  end if;

  if exists (select 1 from ops_prod.bom_revisions r
              where r.product_id = p.id and r.rev = c.rev and r.released_at is not null) then
    v_ref := c.ref_code;
    v_part := c.part;
    v_rev := ops_prod.open_draft(p.id);
    select * into c from ops_prod.bom_components
     where product_id = p.id and rev = v_rev and ref_code = v_ref
       and lower(coalesce(part, '')) = lower(coalesce(v_part, ''));
    if not found then
      return ops_core.noop('production','bom', p_product_code,'remove_line',
        'Baris itu sudah tidak ada di draft.');
    end if;
  end if;

  delete from ops_prod.bom_components where id = c.id;
  return ops_core.ok('production','bom', p_product_code,'remove_line',
    jsonb_build_object('component_id', c.id, 'rev', c.rev), to_jsonb(c), null);
end $$;

-- Releasing: the same refusals as `0109`, with the part and the followed rate
-- counted as part of what a line is — moving kayu mindi from the legs to the
-- top, or from a typed price to the list, is a change worth a revision.
create or replace function ops_prod.release_bom(p_product_code text, p_note text)
returns jsonb
language plpgsql security definer set search_path = ops_prod, ops_core, pg_temp as $$
declare p ops_prod.products; v_rev int; v_from int; v_unpriced text[]; v_changed boolean;
begin
  if not ops_core.has_permission('production.update') then
    return ops_core.refused('production','bom', p_product_code,'release',
      'not_permitted','Merilis BOM butuh akses produksi (update).');
  end if;
  select * into p from ops_prod.products where product_code = p_product_code;
  if not found then
    return ops_core.not_found('production','bom', p_product_code,'release',
      format('Tidak ada produk %s.', p_product_code));
  end if;
  select rev into v_rev from ops_prod.bom_revisions where product_id = p.id and released_at is null;
  if v_rev is null then
    return ops_core.conflict('production','bom', p_product_code,'release',
      'no_draft','Tidak ada draft yang terbuka. Ubah satu komponen dan drafnya terbuka sendiri.');
  end if;
  if coalesce(btrim(p_note), '') = '' then
    return ops_core.invalid('production','bom', p_product_code,'release',
      'note_required','Kenapa versi ini ada? Satu kalimat — dibaca orang yang nanti bertanya soal selisih.',
      jsonb_build_object('field','note'));
  end if;
  if not exists (select 1 from ops_prod.bom_components where product_id = p.id and rev = v_rev) then
    return ops_core.invalid('production','bom', p_product_code,'release',
      'empty_revision','BOM tanpa komponen tidak bisa dirilis.', jsonb_build_object('field','components'));
  end if;

  select array_agg(coalesce(b.part || ' · ', '') || coalesce(b.ref_name, b.ref_code)
                   || ' (' || b.ref_code || ')' order by b.ref_code) into v_unpriced
    from ops_prod.v_product_bom b
   where b.product_id = p.id and b.rev = v_rev and b.unit_price is null;
  if v_unpriced is not null then
    return ops_core.invalid('production','bom', p_product_code,'release',
      'unpriced_lines', format('Belum ada rate untuk: %s. Isi rate-nya dulu — biaya yang dirilis tidak boleh bolong.',
        array_to_string(v_unpriced, ', ')),
      jsonb_build_object('field','unit_rate','lines', to_jsonb(v_unpriced)));
  end if;

  v_from := ops_prod.released_rev(p.id);
  if v_from is not null then
    select exists (
        (select kind, ref_code, coalesce(lower(part),''), coalesce(rate_code,''), qty, uom, waste_percent,
                coalesce(label,''), round(unit_price, 2)
           from ops_prod.v_product_bom where product_id = p.id and rev = v_rev
         except
         select kind, ref_code, coalesce(lower(part),''), coalesce(rate_code,''), qty, uom, waste_percent,
                coalesce(label,''), round(unit_price, 2)
           from ops_prod.v_product_bom where product_id = p.id and rev = v_from)
        union all
        (select kind, ref_code, coalesce(lower(part),''), coalesce(rate_code,''), qty, uom, waste_percent,
                coalesce(label,''), round(unit_price, 2)
           from ops_prod.v_product_bom where product_id = p.id and rev = v_from
         except
         select kind, ref_code, coalesce(lower(part),''), coalesce(rate_code,''), qty, uom, waste_percent,
                coalesce(label,''), round(unit_price, 2)
           from ops_prod.v_product_bom where product_id = p.id and rev = v_rev))
      or (select miscalc_percent from ops_prod.bom_revisions where product_id = p.id and rev = v_rev)
         is distinct from
         (select miscalc_percent from ops_prod.bom_revisions where product_id = p.id and rev = v_from)
      into v_changed;
    if not v_changed then
      return ops_core.invalid('production','bom', p_product_code,'release',
        'nothing_changed', format('Draft rev %s sama persis dengan rev %s — komponen, jumlah, rate dan miskalkulasi.', v_rev, v_from),
        jsonb_build_object('field','components'));
    end if;
  end if;

  -- Freeze: every line keeps the rate it is costed at today, and says where
  -- that rate came from — `rate` for one taken from the list.
  update ops_prod.bom_components c
     set unit_rate = lr.rate, rate_source = lr.source
    from ops_prod.bom_components c2
    cross join lateral ops_prod.line_rate(c2.id) lr
   where c.id = c2.id and c.product_id = p.id and c.rev = v_rev and c.unit_rate is null;

  update ops_prod.bom_revisions
     set released_at = now(), released_by = auth.uid(), note = btrim(p_note)
   where product_id = p.id and rev = v_rev;

  perform ops_core.emit('production','production.bom.released', p.product_code,
    jsonb_build_object('product_code', p.product_code, 'rev', v_rev, 'from_rev', v_from));
  return ops_core.ok('production','bom', p_product_code,'release',
    jsonb_build_object('rev', v_rev, 'from_rev', v_from,
      'production_cost', (ops_prod.bom_cost(p.id, v_rev)).production_cost));
end $$;

-- Adding a rate, or changing one. `p_code` null adds; named, it updates that
-- rate in full. A changed figure moves every **draft** that follows it the
-- next time it is read, and no released revision, which froze its own.
create or replace function ops_prod.save_bom_rate(
  p_code       text default null,
  p_name       text default null,
  p_rate_group text default null,
  p_uom        text default null,
  p_rate       numeric default null,
  p_item_code  text default null,
  p_note       text default null,
  p_active     boolean default null)
returns jsonb
language plpgsql security definer set search_path = ops_prod, ops_core, pg_temp as $$
declare v_code text := nullif(upper(btrim(coalesce(p_code, ''))), '');
        v_name text := btrim(coalesce(p_name, ''));
        v_uom  text := btrim(coalesce(p_uom, ''));
        v_item text := nullif(upper(btrim(coalesce(p_item_code, ''))), '');
        r ops_prod.bom_rates; v_active boolean; n int; v_id uuid;
begin
  if not ops_core.has_permission('production.update') then
    return ops_core.refused('production','bom_rate', v_code,'save',
      'not_permitted','Mengubah daftar rate BOM butuh akses produksi (update).');
  end if;
  if v_code is not null then
    select * into r from ops_prod.bom_rates where code = v_code;
    if not found then
      return ops_core.not_found('production','bom_rate', v_code,'save',
        format('Tidak ada rate %s.', v_code));
    end if;
  end if;

  if v_name = '' then
    return ops_core.invalid('production','bom_rate', v_code,'save',
      'name_required','Rate untuk apa? Mis. "Kayu mindi grade A".', jsonb_build_object('field','name'));
  end if;
  if p_rate_group is null or p_rate_group not in ('kayu','material','finishing','labour','packing','lain') then
    return ops_core.invalid('production','bom_rate', v_code,'save',
      'unknown_group', format('"%s" bukan kelompok rate.', coalesce(p_rate_group, '')),
      jsonb_build_object('field','rate_group'));
  end if;
  if v_uom = '' then
    return ops_core.invalid('production','bom_rate', v_code,'save',
      'uom_required','Rate per apa? m3, m2, lembar, hari, unit…', jsonb_build_object('field','uom'));
  end if;
  if p_rate is null then
    return ops_core.invalid('production','bom_rate', v_code,'save',
      'rate_required','Berapa rate-nya?', jsonb_build_object('field','rate'));
  end if;
  if p_rate < 0 then
    return ops_core.invalid('production','bom_rate', v_code,'save',
      'negative_rate','Rate tidak bisa negatif.', jsonb_build_object('field','rate'));
  end if;
  if v_item is not null and not exists (select 1 from ops_procure.items i where i.code = v_item) then
    return ops_core.invalid('production','bom_rate', v_code,'save',
      'no_such_item', format('Tidak ada item %s di database items.', v_item), jsonb_build_object('field','item_code'));
  end if;

  v_active := coalesce(p_active, r.active, true);
  if v_active and exists (select 1 from ops_prod.bom_rates x
                           where lower(btrim(x.name)) = lower(v_name) and x.active
                             and x.id is distinct from r.id) then
    return ops_core.conflict('production','bom_rate', v_code,'save',
      'rate_name_taken', format('"%s" sudah ada di daftar rate — ubah yang itu, jangan buat dua harga untuk satu barang.', v_name));
  end if;

  if r.id is null then
    select coalesce(max(substring(code from 4)::int), 0) + 1 into n from ops_prod.bom_rates;
    v_code := 'RT-' || lpad(n::text, 4, '0');
    insert into ops_prod.bom_rates
      (code, name, rate_group, uom, unit_rate, item_code, note, active, created_by, updated_by)
    values (v_code, v_name, p_rate_group, v_uom, p_rate, v_item, nullif(btrim(p_note), ''),
      v_active, auth.uid(), auth.uid())
    returning id into v_id;
    return ops_core.ok('production','bom_rate', v_code,'create',
      jsonb_build_object('code', v_code), null,
      (select to_jsonb(x) from ops_prod.bom_rates x where x.id = v_id));
  end if;

  update ops_prod.bom_rates set
    name = v_name, rate_group = p_rate_group, uom = v_uom, unit_rate = p_rate,
    item_code = v_item, note = nullif(btrim(p_note), ''), active = v_active,
    updated_at = now(), updated_by = auth.uid()
  where id = r.id;
  return ops_core.ok('production','bom_rate', v_code,'update',
    jsonb_build_object('code', v_code), to_jsonb(r),
    (select to_jsonb(x) from ops_prod.bom_rates x where x.id = r.id));
end $$;

revoke all on function
  ops_prod.save_bom_line(text, uuid, text, text, text, numeric, text, numeric, numeric, text, text, text),
  ops_prod.save_bom_rate(text, text, text, text, numeric, text, text, boolean)
  from public;
grant execute on function
  ops_prod.save_bom_line(text, uuid, text, text, text, numeric, text, numeric, numeric, text, text, text),
  ops_prod.save_bom_rate(text, text, text, text, numeric, text, text, boolean)
  to authenticated;

analyze ops_prod.bom_rates;
