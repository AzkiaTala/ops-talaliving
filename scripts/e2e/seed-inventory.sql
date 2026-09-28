-- People and reference data for the inventory walk (scripts/e2e/walk-inventory.mjs),
-- on top of seed-procurement.sql. Same roles as the SQL walk (99_sim_inventory):
--   Dewi — staf gudang: inventory write
--   Lina — pimpinan yang membaca: inventory read
--   Andi — staf procurement (from seed-procurement): signs the receipt
--   Budi — produksi: production write (Job Order and progress)
--   Joko — pengiriman: delivery write (surat jalan)
--
-- What other modules hold before the inventory week starts is seeded here, not
-- walked: two catalogue items, a PR line for the glue approved by leadership
-- (procurement's walk presses that), a product and a customer's order for it,
-- and the Job Order production opened for it with its progress recorded.
insert into auth.users (id, email, raw_user_meta_data) values
  ('e2e00000-0000-0000-0000-0000000000d1','dewi@talaliving.com','{"full_name":"Dewi Lestari"}'),
  ('e2e00000-0000-0000-0000-0000000000e1','lina@talaliving.com','{"full_name":"Lina Hartono"}'),
  ('e2e00000-0000-0000-0000-0000000000b0','budi@talaliving.com','{"full_name":"Budi Santoso"}'),
  ('e2e00000-0000-0000-0000-0000000000c0','joko@talaliving.com','{"full_name":"Joko Susilo"}')
on conflict do nothing;
insert into ops_core.user_modules (user_id, module, level) values
  ('e2e00000-0000-0000-0000-0000000000d1','inventory','write'),
  ('e2e00000-0000-0000-0000-0000000000e1','inventory','read'),
  ('e2e00000-0000-0000-0000-0000000000b0','production','write'),
  ('e2e00000-0000-0000-0000-0000000000c0','delivery','write')
on conflict do nothing;

insert into ops_procure.vendors (id, code, name, is_curated) values
  ('e2e00000-0000-0000-0000-00000000fe01','V-E2E3','CV LEM SIMULASI', true)
on conflict do nothing;
insert into ops_procure.items (id, code, name, category_code, base_uom, kind, is_curated) values
  ('e2e00000-0000-0000-0000-000000001f01','I-E2E01','Wood glue PVAc','production','kg','goods', true),
  ('e2e00000-0000-0000-0000-000000001f02','I-E2E02','Sandpaper 240','sanding','lembar','goods', true)
on conflict do nothing;
insert into ops_inv.stock_settings (item_code, home_location) values ('I-E2E01','BENGKEL') on conflict do nothing;

insert into ops_prod.products (product_code, name, category, uom, stages) values
  ('E2E-CHR','Kursi makan walk','Kursi','pcs', array['AMPLAS','PACKING'])
on conflict do nothing;
insert into ops_procure.projects (id, code, name, client_name, location, is_active, status) values
  ('e2e00000-0000-0000-0000-00000000c001','E2E-INV','VILLA WALK','Ibu Walk','Sanur', true, 'IN_PRODUCTION')
on conflict do nothing;
insert into ops_procure.project_lines (id, project_id, line_no, product_code, description, qty, uom) values
  ('e2e00000-0000-0000-0000-00000000c101','e2e00000-0000-0000-0000-00000000c001', 1, 'E2E-CHR', 'Kursi makan', 10, 'pcs')
on conflict do nothing;

-- The procurement half, as its own people: Andi raises the PR, Evin approves it.
set role authenticated;
select set_config('request.jwt.claim.sub', 'e2e00000-0000-0000-0000-00000000a11d', false);
select ops_procure.create_pr(jsonb_build_array(
  jsonb_build_object('description','Lem kayu PVAc','qty',20,'uom','kg','unit_price',45000,
    'vendor_id','e2e00000-0000-0000-0000-00000000fe01','item_id','e2e00000-0000-0000-0000-000000001f01',
    'purpose','Rangka kursi')), '25777') ->> 'outcome' as pr_created;
select ops_procure.submit_pr((select doc_no from ops_procure.pr_documents order by created_at desc limit 1)) ->> 'outcome' as pr_submitted;
select ops_core.attach_link((ops_core.attach_url('https://toko.example/lem-pvac', 'penawaran-lem') -> 'data' ->> 'attachment_id')::uuid,
  'pr_line', (select doc_no from ops_procure.pr_documents order by created_at desc limit 1) || '-L01', 'quotation') ->> 'outcome' as support;
select set_config('request.jwt.claim.sub', 'e2e00000-0000-0000-0000-00000000ce00', false);
select ops_procure.approve_line((select doc_no from ops_procure.pr_documents order by created_at desc limit 1) || '-L01',
  true, null, null, null, null) ->> 'outcome' as line_approved;

-- Andi orders the approved line from the vendor; Evin, holding approve_goods,
-- writes nothing here but confirms it; Andi issues it. The walk then records
-- its arrival on the tracker.
select set_config('request.jwt.claim.sub', 'e2e00000-0000-0000-0000-00000000a11d', false);
select ops_procure.create_po('V-E2E3', jsonb_build_array(
  jsonb_build_object('description','Lem kayu PVAc','qty',20,'uom','kg','unit_price',45000,
    'pr_line_no', (select doc_no from ops_procure.pr_documents order by created_at desc limit 1) || '-L01')),
  0, 'Bayar saat barang datang.', ops_core.office_day() + 3) -> 'data' ->> 'po_no' as po;
select ops_procure.request_po_approval(p_po_no => (select po_no from ops_procure.purchase_orders order by created_at desc limit 1)) ->> 'outcome' as asked;
select set_config('request.jwt.claim.sub', 'e2e00000-0000-0000-0000-00000000ce00', false);
select ops_procure.approve_po(p_po_no => (select po_no from ops_procure.purchase_orders order by created_at desc limit 1)) ->> 'outcome' as po_confirmed;
select set_config('request.jwt.claim.sub', 'e2e00000-0000-0000-0000-00000000a11d', false);
select ops_procure.issue_po((select po_no from ops_procure.purchase_orders order by created_at desc limit 1)) ->> 'outcome' as po_issued;

-- Production opens the Job Order (12 for an order of 10: two spare) and
-- reports all twelve through its last stage.
select set_config('request.jwt.claim.sub', 'e2e00000-0000-0000-0000-0000000000b0', false);
select ops_prod.create_work_order(null, 12, null, ops_core.office_day() + 7,
  p_project_line_id => 'e2e00000-0000-0000-0000-00000000c101', p_key => 'e2e-jo-1') -> 'data' ->> 'wo_no' as jo;
select ops_prod.record_progress((select wo_no from ops_prod.work_orders where project_line_id = 'e2e00000-0000-0000-0000-00000000c101'),
  'AMPLAS', 12, ops_core.office_day()) ->> 'outcome' as amplas;
select ops_prod.record_progress((select wo_no from ops_prod.work_orders where project_line_id = 'e2e00000-0000-0000-0000-00000000c101'),
  'PACKING', 12, ops_core.office_day()) ->> 'outcome' as packing;
reset role;
