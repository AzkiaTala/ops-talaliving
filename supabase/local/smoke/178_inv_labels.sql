-- inv — the label sheet's source: item, asset, finished good (0178, D321).
--
-- DERIVATIONS  an item carries its registered date, its location from stock
--              (else its home rack) and whether its category is labelled by
--              default; `since` keeps only what was registered from that day;
--              `codes` asks for exact records; a rented asset carries its
--              ownership and contract end; a product carries its size and
--              where it sits; v_stock_item shows the registered date
-- REFUSALS     somebody without inventory.read; a kind nobody labels

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('ffffffff-0000-0000-0000-000000017801','label-reader@talaliving.com','{"full_name":"Gudang"}'),
  ('ffffffff-0000-0000-0000-000000017802','label-hr@talaliving.com','{"full_name":"HR"}');
insert into ops_core.user_modules (user_id, module, level) values
  ('ffffffff-0000-0000-0000-000000017801','inventory','read'),
  ('ffffffff-0000-0000-0000-000000017802','hrd','read');

insert into ops_procure.item_categories (code, name) values
  ('kayu-uji','Kayu (uji)'), ('amplas-uji','Amplas (uji)')
  on conflict (code) do nothing;
insert into ops_inv.stocked_categories (category_code) values ('kayu-uji'), ('amplas-uji') on conflict do nothing;
insert into ops_inv.label_categories (category_code) values ('kayu-uji') on conflict do nothing;

insert into ops_procure.items (code, name, name_local, category_code, base_uom, kind, created_at) values
  ('I-LBL01', 'Teak board 2cm', 'Papan jati 2cm', 'kayu-uji',   'pcs', 'goods', '2026-09-20 09:00+07'),
  ('I-LBL02', 'Sandpaper 240',  'Amplas 240',     'amplas-uji', 'pcs', 'goods', '2026-09-27 10:00+07'),
  ('I-LBL03', 'Old panel',      null,             'kayu-uji',   'pcs', 'goods', '2025-01-05 10:00+07');

insert into ops_inv.stock_settings (item_code, home_location) values ('I-LBL03', 'GUDANG')
  on conflict (item_code) do update set home_location = excluded.home_location;
insert into ops_inv.stock_moves (item_code, location, kind, qty, uom, reason, moved_by)
values ('I-LBL01', 'BENGKEL', 'adjust', 12, 'pcs', 'opname awal (uji)', 'ffffffff-0000-0000-0000-000000017801');

insert into ops_inv.assets (asset_no, name, category_code, location, holder, ownership, contract_end, created_at)
select 'AST-LBL1', 'Forklift sewa', ac.code, 'GUDANG', 'Budi', 'rented', '2027-03-31', '2026-09-26 08:00+07'
  from ops_inv.asset_categories ac order by ac.code limit 1;

insert into ops_prod.products (product_code, name, category, uom, length_mm, width_mm, height_mm, created_at) values
  ('P-LBL1', 'Meja makan jati', 'Meja', 'unit', 1800, 900, 760, '2026-09-25 08:00+07');

set local role authenticated;

set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000017802';
do $$
declare r jsonb;
begin
  r := ops_inv.label_sources('item');
  assert r->'error'->>'code' = 'not_permitted', 'no inventory.read, got ' || r::text;
end $$;

set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000017801';
do $$
declare r jsonb; x jsonb;
begin
  r := ops_inv.label_sources('rak');
  assert r->'error'->>'code' = 'unknown_kind', 'unknown kind, got ' || r::text;

  r := ops_inv.label_sources('item', null, array['I-LBL01','I-LBL02','I-LBL03']);
  assert ops_core.said_ok(r), 'items: ' || r::text;
  assert jsonb_array_length(r->'data') = 3, 'three items, got ' || (r->'data')::text;
  -- Newest registered first.
  assert r->'data'->0->>'code' = 'I-LBL02', 'newest first, got ' || (r->'data')::text;

  select e into x from jsonb_array_elements(r->'data') e where e->>'code' = 'I-LBL01';
  assert (x->>'labelled')::boolean, 'timber is labelled by default';
  assert x->'locations'->0->>'code' = 'BENGKEL' and (x->'locations'->0->>'qty')::numeric = 12,
    'location from stock, got ' || (x->'locations')::text;
  assert x->>'name_local' = 'Papan jati 2cm' and x->>'registered_at' like '2026-09-20%',
    'name and registered date, got ' || x::text;

  select e into x from jsonb_array_elements(r->'data') e where e->>'code' = 'I-LBL02';
  assert not (x->>'labelled')::boolean, 'sandpaper is not labelled by default';

  select e into x from jsonb_array_elements(r->'data') e where e->>'code' = 'I-LBL03';
  assert x->'locations'->0->>'code' = 'GUDANG' and x->'locations'->0->'qty' = 'null'::jsonb,
    'no stock: the home rack, got ' || (x->'locations')::text;

  r := ops_inv.label_sources('item', '2026-09-21', array['I-LBL01','I-LBL02','I-LBL03']);
  assert jsonb_array_length(r->'data') = 1 and r->'data'->0->>'code' = 'I-LBL02',
    'since keeps only new ones, got ' || (r->'data')::text;

  r := ops_inv.label_sources('item', null, null, 'papan jati');
  assert r->'data'->0->>'code' = 'I-LBL01', 'search by floor name, got ' || (r->'data')::text;

  r := ops_inv.label_sources('asset', null, array['AST-LBL1']);
  x := r->'data'->0;
  assert x->'extra'->>'ownership' = 'rented' and x->'extra'->>'contract_end' = '2027-03-31',
    'a rented asset says so, got ' || coalesce(x::text, 'null');
  assert x->'locations'->0->>'code' = 'GUDANG', 'asset location';

  r := ops_inv.label_sources('product', null, array['P-LBL1']);
  x := r->'data'->0;
  assert (x->'extra'->>'length_mm')::int = 1800 and x->>'category' = 'Meja', 'product size, got ' || coalesce(x::text, 'null');
end $$;

reset role;

do $$
begin
  assert (select registered_at from ops_inv.v_stock_item where item_code = 'I-LBL01')::date = '2026-09-20',
    'v_stock_item carries the registered date';
end $$;

rollback;
