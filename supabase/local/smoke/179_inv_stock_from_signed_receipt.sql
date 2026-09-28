-- inv — a receipt recorded with its delivery note is signed at insert, and
-- that is stock too (0179, F176).
--
-- DERIVATIONS  photo + delivery note → CONFIRMED at insert → a receipt move on
--              the item's home rack, priced from the line; photo only →
--              REPORTED, nothing until confirm_receipt signs it, then stocked
--              once
--              a PO line written from the screen (pr_line_no, no item_id)
--              stocks the item of the request line it buys (F179)
-- REFUSALS     (not stock) WRONG ITEM signed at insert; a PO line with no
--              item and no request line

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('ffffffff-0000-0000-0000-000000179001','terima-179@talaliving.com','{"full_name":"Terima"}');
insert into ops_core.user_modules (user_id, module, level) values
  ('ffffffff-0000-0000-0000-000000179001','procurement','write');

insert into ops_procure.vendors (id, code, name) values
  ('11110000-0000-0000-0000-000000179001','V-9179','Toko Uji 179');
insert into ops_procure.items (id, code, name, category_code, base_uom, kind) values
  ('22220000-0000-0000-0000-000000179001','I-9179','Glue 179','production','kg','goods');
insert into ops_inv.stock_settings (item_code, home_location) values ('I-9179','BENGKEL');
insert into ops_procure.pr_documents (id, doc_no, status, requested_by, submitted_at) values
  ('55550000-0000-0000-0000-000000179001','pr-179','SUBMITTED','ffffffff-0000-0000-0000-000000179001', now());
insert into ops_procure.pr_lines (id, doc_id, doc_no, line_no, item_id, description, qty, uom, unit_price, item_total, vendor_id) values
  ('66660000-0000-0000-0000-000000179001','55550000-0000-0000-0000-000000179001','pr-179',1,
   '22220000-0000-0000-0000-000000179001','Glue', 20,'kg', 45000, 900000,'11110000-0000-0000-0000-000000179001'),
  ('66660000-0000-0000-0000-000000179002','55550000-0000-0000-0000-000000179001','pr-179',2,
   '22220000-0000-0000-0000-000000179001','Glue again', 5,'kg', 45000, 225000,'11110000-0000-0000-0000-000000179001'),
  ('66660000-0000-0000-0000-000000179003','55550000-0000-0000-0000-000000179001','pr-179',3,
   '22220000-0000-0000-0000-000000179001','Glue wrong', 3,'kg', 45000, 135000,'11110000-0000-0000-0000-000000179001');

-- Two order lines the way NewPo.tsx leaves them: no item_id. One names the
-- request line it buys; the other was typed by hand.
insert into ops_procure.pr_lines (id, doc_id, doc_no, line_no, item_id, description, qty, uom, unit_price, item_total, vendor_id) values
  ('66660000-0000-0000-0000-000000179004','55550000-0000-0000-0000-000000179001','pr-179',4,
   '22220000-0000-0000-0000-000000179001','Glue for the PO', 8,'kg', 45000, 360000,'11110000-0000-0000-0000-000000179001');
insert into ops_procure.purchase_orders (id, po_no, vendor_id, status, created_by) values
  ('77770000-0000-0000-0000-000000179001','po-179','11110000-0000-0000-0000-000000179001','ISSUED','ffffffff-0000-0000-0000-000000179001');
insert into ops_procure.po_lines (id, po_id, line_no, description, qty, uom, unit_price, line_total, pr_line_id) values
  ('88880000-0000-0000-0000-000000179001','77770000-0000-0000-0000-000000179001',1,'Lem kayu', 8,'kg', 44000, 352000,
   '66660000-0000-0000-0000-000000179004'),
  ('88880000-0000-0000-0000-000000179002','77770000-0000-0000-0000-000000179001',2,'Something typed', 1,'kg', 1000, 1000, null);

set local role authenticated;
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000179001';

create temp table t179 (k text, v text) on commit drop;
grant all on t179 to authenticated;

do $$
declare r jsonb; ph uuid; sj uuid; n text;
begin
  ph := (ops_core.attach_file('t/ph.jpg','ph.jpg','image/jpeg',1,null,'upload')->'data'->>'attachment_id')::uuid;
  sj := (ops_core.attach_file('t/sj.jpg','sj.jpg','image/jpeg',1,null,'upload')->'data'->>'attachment_id')::uuid;
  select line_no_full into n from ops_procure.pr_lines where id = '66660000-0000-0000-0000-000000179001';
  r := ops_procure.create_receipt(20, 'GOOD', jsonb_build_array(
         jsonb_build_object('attachment_id', ph, 'kind','Receiving Item'),
         jsonb_build_object('attachment_id', sj, 'kind','Delivery Note')), n);
  assert r->'data'->>'status' = 'CONFIRMED', 'signed at insert, got ' || r::text;
  insert into t179 values ('signed', r->'data'->>'receipt_no');

  select line_no_full into n from ops_procure.pr_lines where id = '66660000-0000-0000-0000-000000179002';
  r := ops_procure.create_receipt(5, 'GOOD', jsonb_build_array(
         jsonb_build_object('attachment_id', ph, 'kind','Receiving Item')), n);
  assert r->'data'->>'status' = 'REPORTED', 'photo only, got ' || r::text;
  insert into t179 values ('reported', r->'data'->>'receipt_no');

  select line_no_full into n from ops_procure.pr_lines where id = '66660000-0000-0000-0000-000000179003';
  r := ops_procure.create_receipt(3, 'WRONG ITEM', jsonb_build_array(
         jsonb_build_object('attachment_id', ph, 'kind','Receiving Item'),
         jsonb_build_object('attachment_id', sj, 'kind','Delivery Note')), n);
  insert into t179 values ('wrong', r->'data'->>'receipt_no');

  r := ops_procure.create_receipt(8, 'GOOD', jsonb_build_array(
         jsonb_build_object('attachment_id', ph, 'kind','Receiving Item'),
         jsonb_build_object('attachment_id', sj, 'kind','Delivery Note')), null, '88880000-0000-0000-0000-000000179001');
  assert r->'data'->>'status' = 'CONFIRMED', 'po receipt, got ' || r::text;
  insert into t179 values ('po', r->'data'->>'receipt_no');
  r := ops_procure.create_receipt(1, 'GOOD', jsonb_build_array(
         jsonb_build_object('attachment_id', ph, 'kind','Receiving Item'),
         jsonb_build_object('attachment_id', sj, 'kind','Delivery Note')), null, '88880000-0000-0000-0000-000000179002');
  insert into t179 values ('typed', r->'data'->>'receipt_no');
end $$;

reset role;

do $$
declare m record; s text; rep text; w text;
begin
  select v into s from t179 where k = 'signed';
  select v into rep from t179 where k = 'reported';
  select v into w from t179 where k = 'wrong';
  select * into m from ops_inv.stock_moves where ref_no = s;
  assert m.kind = 'receipt' and m.qty = 20 and m.location = 'BENGKEL' and m.unit_cost = 45000,
    'signed at insert is on the home rack, priced, got ' || coalesce(m.qty::text, '(nothing)');
  assert m.moved_by = 'ffffffff-0000-0000-0000-000000179001', 'the signer moved it';
  assert not exists (select 1 from ops_inv.stock_moves where ref_no = rep), 'reported is not stock yet';
  assert not exists (select 1 from ops_inv.stock_moves where ref_no = w), 'wrong item is not kept';

  select * into m from ops_inv.stock_moves where ref_no = (select v from t179 where k = 'po');
  assert m.item_code = 'I-9179' and m.qty = 8 and m.unit_cost = 44000,
    'the PO line''s request line names the item; priced from the order, got ' || coalesce(m.qty::text, '(nothing)');
  assert not exists (select 1 from ops_inv.stock_moves where ref_no = (select v from t179 where k = 'typed')),
    'no item and no request line: nothing stocked';
  assert exists (select 1 from ops_core.outbox where event_type = 'inventory.receipt.not_stocked'
                   and entity_no = (select v from t179 where k = 'typed')), 'and it says why';
end $$;

set local role authenticated;
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000179001';
do $$
declare r jsonb;
begin
  r := ops_procure.confirm_receipt((select v from t179 where k = 'reported'));
  assert r->>'outcome' = 'ok', 'confirm, got ' || r::text;
end $$;
reset role;

do $$
begin
  assert (select count(*) from ops_inv.stock_moves
           where ref_no = (select v from t179 where k = 'reported')) = 1, 'signed later, stocked once';
  assert (select on_hand from ops_inv.v_stock_item where item_code = 'I-9179') = 33, '20 + 8 + 5';
end $$;

rollback;
