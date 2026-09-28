-- 0178_inv_labels.sql — the date a thing was recorded, and a sheet of labels
-- to stick on it (D321).
--
-- ── What the owner asked ──────────────────────────────────────────────────
--
-- *tambahkan fitur untuk inventory tanggal perekaman input baru lalu generate
-- label. karena label 1 lembar bisa banyak tambahkan fitur print yang
-- menjelaskan kode, lokasi, tanggal, dst.*
--
-- Asked which records get a label, the owner answered: assets (rented ones
-- included), finished goods, and raw or half-finished material — *kalau bahan
-- seperti amplas sepertinya tidak perlu*. The date on the label is the date
-- the record was **registered**. The sheet layout is chosen when printing.
--
-- ── What this adds ────────────────────────────────────────────────────────
--
-- 1. `ops_inv.label_categories`: which item categories are labelled by
--    default. Raw and half-finished material (timber and panels, metal stock),
--    not consumables. It is a default for the picker, not a wall. Any stocked
--    item can still be labelled by choosing *all categories*. It lives in a
--    table so a category added later is a row, not a code change.
-- 2. `v_stock_item.registered_at`: the day the item was recorded, which the
--    material list now shows. Appended, because `create or replace view` adds
--    columns only at the end.
-- 3. `ops_inv.label_sources(kind, since, codes, q)`: what a label prints, for
--    items, assets and finished goods, in one shape. That is the code, the
--    name, where it is, when it was registered, and what else belongs on that
--    kind's label (a rented asset's contract end, a product's size). It is
--    read-only and gated on `inventory.read`. It is volatile anyway, because
--    its refusal writes the audit row (F169: PostgREST runs stable functions
--    read-only).

-- ── 1. the default categories ─────────────────────────────────────────────

create table if not exists ops_inv.label_categories (
  category_code text primary key references ops_procure.item_categories(code) on update cascade,
  note          text
);

alter table ops_inv.label_categories enable row level security;
drop policy if exists label_categories_read on ops_inv.label_categories;
create policy label_categories_read on ops_inv.label_categories
  for select to authenticated using (true);
grant select on ops_inv.label_categories to authenticated;

insert into ops_inv.label_categories (category_code, note)
select c.code, x.note
  from (values
    ('raw-wood', 'Kayu dan panel: bahan mentah dan setengah jadi'),
    ('production-metal-stock', 'Bahan logam: mentah, dipotong di bengkel')
  ) x(code, note)
  join ops_procure.item_categories c on c.code = x.code
on conflict (category_code) do nothing;

comment on table ops_inv.label_categories is
  'Item categories whose items the label screen selects by default: raw and half-finished '
  'material, not consumables like sandpaper (D321). Others can still be labelled on request. (0178)';

analyze ops_inv.label_categories;

-- ── 2. the rack, with the day each item was registered ────────────────────
-- 0168's columns in 0168's order, then `registered_at`.

create or replace view ops_inv.v_stock_item as
select
  i.code                                   as item_code,
  i.name                                   as item_name,
  i.category_code,
  c.name                                   as category_name,
  i.base_uom                               as uom,
  coalesce(mv.on_hand, 0)                  as on_hand,
  case when coalesce(mv.priced_qty, 0) > 0
    then round(mv.priced_cost / mv.priced_qty)::bigint end as avg_cost,
  case when coalesce(mv.priced_qty, 0) > 0
    then round(mv.priced_cost / mv.priced_qty
               * greatest(coalesce(mv.on_hand, 0)
                          - least(coalesce(mv.unpriced_in, 0), greatest(coalesce(mv.on_hand, 0), 0)), 0))::bigint
    end as value,
  least(coalesce(mv.unpriced_in, 0), greatest(coalesce(mv.on_hand, 0), 0)) as unpriced_qty,
  s.min_qty,
  (s.min_qty is not null and coalesce(mv.on_hand, 0) < s.min_qty) as below_min,
  s.home_location,
  mv.last_move_at,
  coalesce(mv.moves_count, 0)              as moves_count,
  -- ── 0168 ──
  i.name_local                             as item_name_local,
  coalesce(ph.photo_count, 0)              as photo_count,
  -- ── 0178 ──
  i.created_at                             as registered_at
from ops_procure.items i
join ops_procure.item_categories c on c.code = i.category_code
join ops_inv.stocked_categories sc on sc.category_code = i.category_code
left join ops_inv.stock_settings s on s.item_code = i.code
left join lateral (
  select
    sum(qty)                                                        as on_hand,
    sum(qty) filter (where qty > 0 and unit_cost is not null)       as priced_qty,
    sum(qty * unit_cost) filter (where qty > 0 and unit_cost is not null) as priced_cost,
    sum(qty) filter (where qty > 0 and unit_cost is null and kind = 'receipt') as unpriced_in,
    max(moved_at)                                                   as last_move_at,
    count(*)::int                                                   as moves_count
  from ops_inv.stock_moves m where m.item_code = i.code
) mv on true
left join lateral (
  select count(*)::int as photo_count
    from ops_core.attachment_links l
   where l.entity = 'item' and l.entity_no = i.code
     and l.kind = 'foto' and l.unlinked_at is null
) ph on true
where i.merged_into is null;

alter view ops_inv.v_stock_item set (security_invoker = on);

-- ── 3. what a label prints ────────────────────────────────────────────────
--
-- One shape for three kinds, so the sheet has one layout:
--   kind, code, name, name_local, category, uom, registered_at,
--   locations [{code, name, qty}]   where it is now (qty null for an asset),
--   labelled                        in the default selection,
--   extra                           what that kind adds to its label.
--
-- `since` filters on the registered day (the owner's *input baru*); `codes`
-- asks for exact records, e.g. the one just registered; `q` searches code and
-- names. Newest first, 500 at most: a sheet is printed for today's intake,
-- not for the whole catalogue.

create or replace function ops_inv.label_sources(
  p_kind  text,
  p_since date   default null,
  p_codes text[] default null,
  p_q     text   default null)
returns jsonb
language plpgsql volatile security definer
set search_path = ops_inv, ops_procure, ops_prod, ops_core, pg_temp as $$
declare v_rows jsonb; v_q text := nullif(btrim(p_q), '');
begin
  if not ops_core.has_permission('inventory.read') then
    return ops_core.refused('inventory','label', p_kind,'label_sources',
      'not_permitted','Mencetak label butuh akses baca inventory.');
  end if;

  if p_kind = 'item' then
    select coalesce(jsonb_agg(r order by r.registered_at desc nulls last, r.code), '[]'::jsonb) into v_rows
      from (
        select 'item' as kind, i.code, i.name, i.name_local,
               c.name as category, i.base_uom as uom, i.created_at as registered_at,
               coalesce(
                 (select jsonb_agg(jsonb_build_object('code', b.location, 'name', b.location_name, 'qty', b.qty)
                                   order by b.qty desc, b.location)
                    from ops_inv.v_stock_by_location b
                   where b.item_code = i.code and b.qty > 0),
                 case when s.home_location is not null then
                   jsonb_build_array(jsonb_build_object('code', s.home_location,
                     'name', (select l.name from ops_inv.stock_locations l where l.code = s.home_location),
                     'qty', null)) end,
                 '[]'::jsonb) as locations,
               exists (select 1 from ops_inv.label_categories lc where lc.category_code = i.category_code) as labelled,
               jsonb_build_object('category_code', i.category_code) as extra
          from ops_procure.items i
          join ops_procure.item_categories c on c.code = i.category_code
          join ops_inv.stocked_categories sc on sc.category_code = i.category_code
          left join ops_inv.stock_settings s on s.item_code = i.code
         where i.merged_into is null and i.archived_at is null and i.kind = 'goods'
           and (p_since is null or i.created_at >= p_since)
           and (p_codes is null or i.code = any(p_codes))
           and (v_q is null or i.code ilike '%' || v_q || '%' or i.name ilike '%' || v_q || '%'
                or coalesce(i.name_local, '') ilike '%' || v_q || '%')
         order by i.created_at desc, i.code
         limit 500
      ) r;

  elsif p_kind = 'asset' then
    select coalesce(jsonb_agg(r order by r.registered_at desc nulls last, r.code), '[]'::jsonb) into v_rows
      from (
        select 'asset' as kind, a.asset_no as code, a.name, null::text as name_local,
               ac.name as category, null::text as uom, a.created_at as registered_at,
               case when a.location is not null
                 then jsonb_build_array(jsonb_build_object('code', a.location, 'name', a.location, 'qty', null))
                 else '[]'::jsonb end as locations,
               true as labelled,
               jsonb_strip_nulls(jsonb_build_object(
                 'ownership', a.ownership, 'holder', a.holder, 'identifier', a.identifier,
                 'brand', a.brand, 'model', a.model, 'status', a.status,
                 'acquired_on', a.acquired_on, 'contract_end', a.contract_end)) as extra
          from ops_inv.assets a
          join ops_inv.asset_categories ac on ac.code = a.category_code
         where a.status::text not in ('disposed','lost','returned')
           and (p_since is null or a.created_at >= p_since)
           and (p_codes is null or a.asset_no = any(p_codes))
           and (v_q is null or a.asset_no ilike '%' || v_q || '%' or a.name ilike '%' || v_q || '%'
                or coalesce(a.identifier, '') ilike '%' || v_q || '%')
         order by a.created_at desc, a.asset_no
         limit 500
      ) r;

  elsif p_kind = 'product' then
    with led as (
      select l.product_code, l.location, sum(l.qty) as q
        from ops_inv.product_ledger(null) l
       group by 1, 2 having sum(l.qty) > 0
    )
    select coalesce(jsonb_agg(r order by r.registered_at desc nulls last, r.code), '[]'::jsonb) into v_rows
      from (
        select 'product' as kind, p.product_code as code, p.name, null::text as name_local,
               p.category, p.uom, p.created_at as registered_at,
               coalesce(
                 (select jsonb_agg(jsonb_build_object('code', led.location, 'name', sl.name, 'qty', led.q)
                                   order by led.q desc, led.location)
                    from led left join ops_inv.stock_locations sl on sl.code = led.location
                   where led.product_code = p.product_code),
                 '[]'::jsonb) as locations,
               true as labelled,
               jsonb_strip_nulls(jsonb_build_object(
                 'length_mm', p.length_mm, 'width_mm', p.width_mm, 'height_mm', p.height_mm,
                 'dimension_note', p.dimension_note)) as extra
          from ops_prod.products p
         where p.active
           and (p_since is null or p.created_at >= p_since)
           and (p_codes is null or p.product_code = any(p_codes))
           and (v_q is null or p.product_code ilike '%' || v_q || '%' or p.name ilike '%' || v_q || '%')
         order by p.created_at desc, p.product_code
         limit 500
      ) r;

  else
    return ops_core.invalid('inventory','label', p_kind,'label_sources',
      'unknown_kind', format('"%s" is not something this screen labels: item, asset or product.', p_kind),
      jsonb_build_object('field','kind','given', p_kind));
  end if;

  -- A read: answered without an audit row, as `product_stock` is.
  return jsonb_build_object('outcome','ok','status',200,'data', v_rows);
end $$;

revoke all on function ops_inv.label_sources(text, date, text[], text) from public;
grant execute on function ops_inv.label_sources(text, date, text[], text) to authenticated;

comment on function ops_inv.label_sources(text, date, text[], text) is
  'What a label prints for items, assets or finished goods: code, name, location, registered '
  'date and the kind''s extras. Read-only, inventory.read. Volatile because its refusal writes '
  'the audit row. (0178, D321)';
