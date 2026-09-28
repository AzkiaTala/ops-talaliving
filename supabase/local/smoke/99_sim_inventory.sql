-- simulasi — inventory: dari rak ke surat jalan.
--
-- The third walk, the same kind of file as `99_sim_procure_to_ledger` and
-- `99_sim_hr_to_ledger`: every step is one person doing one thing on one
-- screen, in the order the week before an opname actually runs, written into
-- `sim_log`. `supabase/local/simulate.sh sim_inventory` prints it; the SOP
-- (`docs/sop/inventory/`) and John Lau's process knowledge (`0180`) were
-- written from it.
--
-- Five people, with the grants the real roles carry:
--   Dewi — staf gudang: inventory write (lokasi, daftar barang, opname, keluar-masuk, barang jadi, aset)
--   Lina — pimpinan yang membaca: inventory read (melihat rak, tidak menulis)
--   Andi — staf procurement: procurement write (mencatat dan menandatangani penerimaan)
--   Budi — produksi: production write (Job Order dan progres)
--   Joko — pengiriman: delivery write (surat jalan)
--
-- Where the application disagrees with itself the step is logged `TEMUAN`
-- rather than asserted away. The screens that write `stock_moves` and
-- `stock_locations` without a seam (adjust, return, transfer, locations) are
-- walked the way `src/lib/api/inventory.ts` writes them: the same insert, as
-- the person, through RLS.

begin;

create temp table sim_log (
  n          int generated always as identity,
  proses     text not null,
  langkah    text not null,
  pelaku     text not null,
  layar      text,
  seam       text,
  hasil      text not null,
  status     text,
  catatan    text
) on commit drop;
grant insert, select on sim_log to authenticated;

create function pg_temp.log(p_proses text, p_langkah text, p_pelaku text, p_layar text,
                            p_seam text, p_hasil text, p_status text, p_catatan text default null)
returns void language sql as $$
  insert into sim_log (proses, langkah, pelaku, layar, seam, hasil, status, catatan)
  values (p_proses, p_langkah, p_pelaku, p_layar, p_seam, p_hasil, p_status, p_catatan);
$$;

create function pg_temp.as_(p_who uuid) returns void language sql as $$
  select set_config('request.jwt.claim.sub', p_who::text, true);
$$;

-- What the refusal said, for the log: an envelope's code, or the outcome.
create function pg_temp.said(r jsonb) returns text language sql as $$
  select coalesce(r -> 'error' ->> 'code', r ->> 'outcome');
$$;

-- On hand, per item and location, the way `v_stock_by_location` sums it.
-- Read as the owner: the person logged may hold no inventory grant at all
-- (procurement signs receipts), and RLS would show them an empty rack.
create function pg_temp.on_hand(p_item text, p_loc text default null) returns numeric
language sql security definer as $$
  select coalesce(sum(qty), 0) from ops_inv.stock_moves
   where item_code = p_item and (p_loc is null or location = p_loc);
$$;

create function pg_temp.stocked(p_ref text) returns numeric
language sql security definer as $$
  select coalesce(sum(qty), 0) from ops_inv.stock_moves where ref_no = p_ref;
$$;

insert into auth.users (id, email, raw_user_meta_data) values
  ('51530000-0000-0000-0000-0000000000d1','dewi.inv@talaliving.com','{"full_name":"Dewi Lestari"}'),
  ('51530000-0000-0000-0000-0000000000e1','lina.inv@talaliving.com','{"full_name":"Lina Hartono"}'),
  ('51530000-0000-0000-0000-00000000a11d','andi.inv@talaliving.com','{"full_name":"Andi Prasetyo"}'),
  ('51530000-0000-0000-0000-0000000000b0','budi.inv@talaliving.com','{"full_name":"Budi Santoso"}'),
  ('51530000-0000-0000-0000-0000000000c0','joko.inv@talaliving.com','{"full_name":"Joko Susilo"}');
insert into ops_core.user_modules (user_id, module, level) values
  ('51530000-0000-0000-0000-0000000000d1','inventory','write'),
  ('51530000-0000-0000-0000-0000000000e1','inventory','read'),
  ('51530000-0000-0000-0000-00000000a11d','procurement','write'),
  ('51530000-0000-0000-0000-0000000000b0','production','write'),
  ('51530000-0000-0000-0000-0000000000c0','delivery','write');

-- What other modules already hold before the week starts: two catalogue
-- items bought through procurement, a supplier, a PR line approved and on
-- its way, a product, and a customer's order for it. None of this is
-- inventory's to create.
insert into ops_procure.vendors (id, code, name) values
  ('51530000-0000-0000-0000-00000000fe01','V-5301','CV Lem Simulasi'),
  ('51530000-0000-0000-0000-00000000fe02','V-5302','UD Kayu Simulasi');
insert into ops_procure.items (id, code, name, category_code, base_uom, kind) values
  ('51530000-0000-0000-0000-000000001f01','I-53001','Wood glue PVAc','production','kg','goods'),
  ('51530000-0000-0000-0000-000000001f02','I-53002','Sandpaper 240','sanding','lembar','goods');
insert into ops_inv.stock_settings (item_code, home_location) values ('I-53001','BENGKEL');
insert into ops_procure.pr_documents (id, doc_no, status, requested_by, submitted_at) values
  ('51530000-0000-0000-0000-00000000d001','pr-sim-inv','SUBMITTED','51530000-0000-0000-0000-00000000a11d', now());
insert into ops_procure.pr_lines (id, doc_id, doc_no, line_no, item_id, description, qty, uom, unit_price, item_total, vendor_id) values
  ('51530000-0000-0000-0000-00000000d101','51530000-0000-0000-0000-00000000d001','pr-sim-inv',1,
   '51530000-0000-0000-0000-000000001f01','Lem kayu PVAc', 20,'kg', 45000, 900000,'51530000-0000-0000-0000-00000000fe01'),
  ('51530000-0000-0000-0000-00000000d102','51530000-0000-0000-0000-00000000d001','pr-sim-inv',2,
   '51530000-0000-0000-0000-000000001f02','Amplas 240', 100,'lembar', 2500, 250000,'51530000-0000-0000-0000-00000000fe01'),
  ('51530000-0000-0000-0000-00000000d103','51530000-0000-0000-0000-00000000d001','pr-sim-inv',3,
   '51530000-0000-0000-0000-000000001f01','Lem kayu (salah kirim)', 5,'kg', 45000, 225000,'51530000-0000-0000-0000-00000000fe01'),
  ('51530000-0000-0000-0000-00000000d104','51530000-0000-0000-0000-00000000d001','pr-sim-inv',4,
   '51530000-0000-0000-0000-000000001f01','Lem kayu lewat PO', 10,'kg', 45000, 450000,'51530000-0000-0000-0000-00000000fe01');
-- The PO procurement wrote for line 4, the way `NewPo.tsx` writes it: the
-- request line it buys, and no item code of its own.
insert into ops_procure.purchase_orders (id, po_no, vendor_id, status, created_by) values
  ('51530000-0000-0000-0000-00000000e001','po-sim-inv','51530000-0000-0000-0000-00000000fe01','ISSUED','51530000-0000-0000-0000-00000000a11d');
insert into ops_procure.po_lines (id, po_id, line_no, description, qty, uom, unit_price, line_total, pr_line_id) values
  ('51530000-0000-0000-0000-00000000e101','51530000-0000-0000-0000-00000000e001',1,'Lem kayu PVAc', 10,'kg', 45000, 450000,
   '51530000-0000-0000-0000-00000000d104');

insert into ops_prod.products (product_code, name, category, uom, stages) values
  ('SIM-CHR','Kursi makan simulasi','Kursi','pcs', array['AMPLAS','PACKING']);
insert into ops_procure.projects (id, code, name, is_active, status) values
  ('51530000-0000-0000-0000-00000000c001','SIM-INV','Villa Simulasi', true, 'IN_PRODUCTION');
insert into ops_procure.project_lines (id, project_id, line_no, product_code, description, qty, uom) values
  ('51530000-0000-0000-0000-00000000c101','51530000-0000-0000-0000-00000000c001', 1, 'SIM-CHR', 'Kursi makan', 10, 'pcs'),
  ('51530000-0000-0000-0000-00000000c102','51530000-0000-0000-0000-00000000c001', 2, 'SIM-CHR', 'Kursi teras', 2, 'pcs');

set local role authenticated;

-- ═════ 1. LOKASI STOK ═════════════════════════════════════════════════════
select pg_temp.as_('51530000-0000-0000-0000-0000000000d1');
do $$
declare n int;
begin
  insert into ops_inv.stock_locations (code, name) values ('RAK-A1', 'Rak A1 — lem & cat');
  perform pg_temp.log('1. Lokasi','Tambah lokasi: kode dan nama rak','Dewi','/inventory/penyesuaian',
    'ops_inv.stock_locations (insert)','OK','aktif',
    'Kode tidak bisa diganti sesudahnya — riwayat stok memakainya. Nama bebas diubah.');

  update ops_inv.stock_locations set name = 'Rak A1 — lem, cat, amplas' where code = 'RAK-A1';
  get diagnostics n = row_count;
  assert n = 1, 'rename';
  perform pg_temp.log('1. Lokasi','Ganti nama lokasi','Dewi','/inventory/penyesuaian',
    'ops_inv.stock_locations (update)','OK','aktif');

  insert into ops_inv.stock_locations (code, name) values ('RAK-LAMA', 'Rak lama dekat pintu');
  update ops_inv.stock_locations set is_active = false where code = 'RAK-LAMA';
  perform pg_temp.log('1. Lokasi','Nonaktifkan rak yang sudah tidak dipakai','Dewi','/inventory/penyesuaian',
    'ops_inv.stock_locations (update)','OK','nonaktif',
    'Tidak ada hapus: rak yang pernah dihitung tetap bisa dibaca di riwayat.');
end $$;

select pg_temp.as_('51530000-0000-0000-0000-0000000000e1');
do $$
declare ok boolean := false;
begin
  begin
    insert into ops_inv.stock_locations (code, name) values ('RAK-X', 'Rak pembaca');
  exception when insufficient_privilege then ok := true;
  end;
  perform pg_temp.log('1. Lokasi','Pembaca mencoba menambah lokasi','Lina','/inventory/penyesuaian',
    'ops_inv.stock_locations (insert)', case when ok then 'DITOLAK' else 'TEMUAN' end, null,
    'Lokasi dikelola pemegang inventory.update.');
  assert ok, 'a reader adds no location';
end $$;

-- ═════ 2. DAFTARKAN BARANG DARI RAK ═══════════════════════════════════════
select pg_temp.as_('51530000-0000-0000-0000-0000000000d1');
do $$
declare r jsonb; f1 uuid; f2 uuid; f3 uuid; f4 uuid; f5 uuid; v_code text;
begin
  f1 := (ops_core.attach_file('sim/klem-1.jpg','klem-1.jpg','image/jpeg',90000,null,'upload') -> 'data' ->> 'attachment_id')::uuid;
  f2 := (ops_core.attach_file('sim/klem-2.jpg','klem-2.jpg','image/jpeg',90000,null,'upload') -> 'data' ->> 'attachment_id')::uuid;
  f3 := (ops_core.attach_file('sim/klem-3.jpg','klem-3.jpg','image/jpeg',90000,null,'upload') -> 'data' ->> 'attachment_id')::uuid;
  f4 := (ops_core.attach_file('sim/klem-4.jpg','klem-4.jpg','image/jpeg',90000,null,'upload') -> 'data' ->> 'attachment_id')::uuid;
  f5 := (ops_core.attach_file('sim/klem-5.jpg','klem-5.jpg','image/jpeg',90000,null,'upload') -> 'data' ->> 'attachment_id')::uuid;

  r := ops_inv.register_item('F-clamp 30 cm', 'klem F 30', 'hardware', 'pcs', array[]::uuid[]);
  perform pg_temp.log('2. Daftar barang','Daftarkan barang tanpa foto','Dewi','/inventory/material',
    'ops_inv.register_item', case when pg_temp.said(r) = 'photo_required' then 'DITOLAK' else 'TEMUAN' end, null, pg_temp.said(r));
  assert pg_temp.said(r) = 'photo_required', format('no photo: %s', r);

  r := ops_inv.register_item('F-clamp 30 cm', 'klem F 30', 'hardware', 'pcs', array[f1,f2,f3,f4,f5]);
  perform pg_temp.log('2. Daftar barang','Daftarkan barang dengan lima foto','Dewi','/inventory/material',
    'ops_inv.register_item', case when pg_temp.said(r) = 'too_many_photos' then 'DITOLAK' else 'TEMUAN' end, null, pg_temp.said(r));
  assert pg_temp.said(r) = 'too_many_photos', format('five: %s', r);

  r := ops_inv.register_item('F-clamp 30 cm', 'klem F 30', 'hardware', 'pcs', array[f1,f2], 'RAK-A1', 12,
                             'Opname: barang baru, dihitung saat didaftarkan', 'sim-reg-1');
  assert ops_core.said_ok(r), format('register: %s', r);
  v_code := r -> 'data' ->> 'code';
  perform pg_temp.log('2. Daftar barang','Daftarkan barang: foto (1–4), nama katalog, nama lapangan, kategori, satuan, hitungan awal dan raknya','Dewi','/inventory/material',
    'ops_inv.register_item','OK', format('%s · %s di RAK-A1', v_code, pg_temp.on_hand(v_code, 'RAK-A1')),
    'Hitungan awal tercatat sebagai penyesuaian opname (adjust) dengan alasannya — bukan barang masuk.');
  assert pg_temp.on_hand(v_code, 'RAK-A1') = 12, 'counted at registration';

  r := ops_inv.register_item('Clamp F 30cm (lagi)', 'klem f 30', 'hardware', 'pcs', array[f3]);
  perform pg_temp.log('2. Daftar barang','Daftarkan lagi barang yang nama lapangannya sudah ada','Dewi','/inventory/material',
    'ops_inv.register_item', case when pg_temp.said(r) = 'already_catalogued' then 'DITOLAK' else 'TEMUAN' end, null,
    pg_temp.said(r) || ' — hitung di barang yang sudah ada, jangan buat kembarannya.');
  assert pg_temp.said(r) = 'already_catalogued', format('twin: %s', r);

  r := ops_inv.set_item_local_name('I-53002', 'amplas 240');
  assert ops_core.said_ok(r), format('local name: %s', r);
  perform pg_temp.log('2. Daftar barang','Isi nama lapangan untuk barang yang sudah ada di katalog','Dewi','/inventory/material',
    'ops_inv.set_item_local_name','OK','amplas 240');

  -- Taking the last photo off an item: what the evidence strip's remove button
  -- calls. The first goes; the last is refused by the database (0168).
  r := ops_core.attach_unlink((select id from ops_core.attachment_links
         where entity = 'item' and entity_no = v_code and attachment_id = f1 and unlinked_at is null));
  assert ops_core.said_ok(r), format('unlink first: %s', r);
  begin
    r := ops_core.attach_unlink((select id from ops_core.attachment_links
           where entity = 'item' and entity_no = v_code and attachment_id = f2 and unlinked_at is null));
    perform pg_temp.log('2. Daftar barang','Hapus foto terakhir barang','Dewi','/inventory/material',
      'ops_core.attach_unlink', case when ops_core.said_ok(r) then 'TEMUAN' else 'DITOLAK' end, null, pg_temp.said(r));
  exception when check_violation then
    perform pg_temp.log('2. Daftar barang','Hapus foto terakhir barang','Dewi','/inventory/material',
      'ops_core.attach_unlink','DITOLAK', null, 'Minimal satu foto: tambah penggantinya dulu, baru hapus yang lama.');
  end;
end $$;

select pg_temp.as_('51530000-0000-0000-0000-0000000000e1');
do $$
declare r jsonb; f uuid;
begin
  f := (ops_core.attach_file('sim/x.jpg','x.jpg','image/jpeg',1000,null,'upload') -> 'data' ->> 'attachment_id')::uuid;
  r := ops_inv.register_item('Palu karet', null, 'hardware', 'pcs', array[f]);
  perform pg_temp.log('2. Daftar barang','Pembaca mencoba mendaftarkan barang','Lina','/inventory/material',
    'ops_inv.register_item', case when pg_temp.said(r) = 'not_permitted' then 'DITOLAK' else 'TEMUAN' end, null, pg_temp.said(r));
end $$;

-- ═════ 3. PENERIMAAN MENAMBAH STOK ════════════════════════════════════════
select pg_temp.as_('51530000-0000-0000-0000-00000000a11d');
do $$
declare r jsonb; ph uuid; sj uuid; ph2 uuid; ph3 uuid; sj3 uuid; rcv text;
begin
  ph  := (ops_core.attach_file('sim/lem.jpg','lem.jpg','image/jpeg',90000,null,'upload') -> 'data' ->> 'attachment_id')::uuid;
  sj  := (ops_core.attach_file('sim/sj-lem.jpg','sj-lem.jpg','image/jpeg',90000,null,'upload') -> 'data' ->> 'attachment_id')::uuid;
  ph2 := (ops_core.attach_file('sim/amplas.jpg','amplas.jpg','image/jpeg',90000,null,'upload') -> 'data' ->> 'attachment_id')::uuid;
  ph3 := (ops_core.attach_file('sim/salah.jpg','salah.jpg','image/jpeg',90000,null,'upload') -> 'data' ->> 'attachment_id')::uuid;
  sj3 := (ops_core.attach_file('sim/sj-salah.jpg','sj-salah.jpg','image/jpeg',90000,null,'upload') -> 'data' ->> 'attachment_id')::uuid;

  -- The everyday receipt: photo and the vendor's delivery note together, which
  -- signs it on the spot (CONFIRMED at insert).
  r := ops_procure.create_receipt(20, 'GOOD', jsonb_build_array(
         jsonb_build_object('attachment_id', ph, 'kind','Receiving Item'),
         jsonb_build_object('attachment_id', sj, 'kind','Delivery Note')), 'pr-sim-inv-L01');
  assert ops_core.said_ok(r), format('receipt: %s', r);
  rcv := r -> 'data' ->> 'receipt_no';
  perform pg_temp.log('3. Penerimaan','Catat barang datang dengan foto barang dan surat jalan vendor sekaligus','Andi',
    '/procurement/tracker/[vendor]','ops_procure.create_receipt',
    case when pg_temp.on_hand('I-53001', 'BENGKEL') = 20 then 'OK' else 'TEMUAN' end,
    format('%s %s · stok lem di BENGKEL %s', rcv, r -> 'data' ->> 'status', pg_temp.on_hand('I-53001', 'BENGKEL')),
    case when pg_temp.on_hand('I-53001', 'BENGKEL') = 20
      then 'Masuk ke lokasi rumah barangnya (BENGKEL), dengan harga baris PR-nya.'
      else 'Penerimaan yang langsung CONFIRMED tidak menambah stok: trigger 0169 hanya membaca UPDATE status (F176, B19).' end);
  assert pg_temp.on_hand('I-53001', 'BENGKEL') = 20, 'a receipt signed at insert is stock (0179)';

  -- Against the PO line: photo and delivery note, signed at once.
  r := ops_procure.create_receipt(10, 'GOOD', jsonb_build_array(
         jsonb_build_object('attachment_id', ph, 'kind','Receiving Item'),
         jsonb_build_object('attachment_id', sj, 'kind','Delivery Note')), null, '51530000-0000-0000-0000-00000000e101');
  assert ops_core.said_ok(r), format('po receipt: %s', r);
  perform pg_temp.log('3. Penerimaan','Catat barang datang untuk baris PO (PO dibuat dari baris PR, tanpa kode barang sendiri)','Andi',
    '/procurement/tracker/[vendor]','ops_procure.create_receipt',
    case when pg_temp.stocked(r -> 'data' ->> 'receipt_no') = 10 then 'OK' else 'TEMUAN' end,
    format('%s CONFIRMED · lem di BENGKEL %s', r -> 'data' ->> 'receipt_no', pg_temp.on_hand('I-53001', 'BENGKEL')),
    case when pg_temp.stocked(r -> 'data' ->> 'receipt_no') = 10
      then 'Barangnya dibaca dari baris PR yang dibeli baris PO itu.'
      else 'Baris PO dari layar tidak membawa item_id; trigger menganggapnya bukan barang katalog (F179, B22).' end);
  assert pg_temp.stocked(r -> 'data' ->> 'receipt_no') = 10, 'a PO line''s request line names the item (0179)';

  -- Photo only: reported, not yet signed. Nothing on the rack until it is.
  r := ops_procure.create_receipt(100, 'GOOD', jsonb_build_array(
         jsonb_build_object('attachment_id', ph2, 'kind','Receiving Item')), 'pr-sim-inv-L02');
  assert ops_core.said_ok(r) and r -> 'data' ->> 'status' = 'REPORTED', format('reported: %s', r);
  rcv := r -> 'data' ->> 'receipt_no';
  perform pg_temp.log('3. Penerimaan','Catat barang datang dengan foto saja (surat jalan menyusul)','Andi',
    '/procurement/tracker/[vendor]','ops_procure.create_receipt',
    case when pg_temp.on_hand('I-53002') = 0 then 'OK' else 'TEMUAN' end,
    format('REPORTED · stok amplas %s', pg_temp.on_hand('I-53002')),
    'Belum ditandatangani, belum masuk stok.');

  r := ops_procure.confirm_receipt(rcv);
  assert ops_core.said_ok(r), format('confirm: %s', r);
  perform pg_temp.log('3. Penerimaan','Tandatangani penerimaan yang dilaporkan','Andi',
    '/procurement/tracker/[vendor]','ops_procure.confirm_receipt',
    case when pg_temp.on_hand('I-53002', 'GUDANG') = 100 then 'OK' else 'TEMUAN' end,
    format('CONFIRMED · amplas di GUDANG %s', pg_temp.on_hand('I-53002', 'GUDANG')),
    'Barang tanpa lokasi rumah masuk ke GUDANG.');

  r := ops_procure.create_receipt(5, 'WRONG ITEM', jsonb_build_array(
         jsonb_build_object('attachment_id', ph3, 'kind','Receiving Item'),
         jsonb_build_object('attachment_id', sj3, 'kind','Delivery Note')), 'pr-sim-inv-L03');
  assert ops_core.said_ok(r), format('wrong: %s', r);
  perform pg_temp.log('3. Penerimaan','Barang salah kirim dicatat WRONG ITEM','Andi',
    '/procurement/tracker/[vendor]','ops_procure.create_receipt',
    case when pg_temp.stocked(r -> 'data' ->> 'receipt_no') = 0 then 'OK' else 'TEMUAN' end,
    'CONFIRMED · tidak masuk stok',
    'WRONG ITEM dan RETURN TO SENDER tidak disimpan; DAMAGED tetap masuk stok (barangnya ada di gedung).');
end $$;

-- ═════ 4. PEMAKAIAN DAN PERPINDAHAN MATERIAL ══════════════════════════════
select pg_temp.as_('51530000-0000-0000-0000-0000000000b0');
do $$
declare r jsonb;
begin
  r := ops_prod.create_work_order(null, 12, null, current_date + 7,
         p_project_line_id => '51530000-0000-0000-0000-00000000c101', p_key => 'sim-jo-1');
  assert ops_core.said_ok(r), format('jo: %s', r);
  perform set_config('sim.jo', r -> 'data' ->> 'wo_no', true);
  perform pg_temp.log('4. Pemakaian','(Produksi) Buat Job Order 12 kursi dari baris pesanan klien 10 kursi (dua cadangan)','Budi','/produksi/jadwal',
    'ops_prod.create_work_order','OK', r -> 'data' ->> 'wo_no', 'Dasar semua barang keluar dan barang jadi di bawah.');
end $$;

select pg_temp.as_('51530000-0000-0000-0000-0000000000d1');
do $$
declare r jsonb; jo text := current_setting('sim.jo'); n int;
begin
  r := ops_inv.issue_stock('I-53001', 'BENGKEL', 0, jo);
  perform pg_temp.log('4. Pemakaian','Keluarkan nol','Dewi','/inventory/material','ops_inv.issue_stock',
    case when pg_temp.said(r) = 'qty_invalid' then 'DITOLAK' else 'TEMUAN' end, null, pg_temp.said(r));

  r := ops_inv.issue_stock('I-53001', 'BENGKEL', 6, jo, 'lem rangka kursi', 'sim-issue-1');
  assert ops_core.said_ok(r), format('issue: %s', r);
  perform pg_temp.log('4. Pemakaian','Keluarkan material untuk Job Order: lokasi, jumlah, nomor JO, untuk apa','Dewi','/inventory/material',
    'ops_inv.issue_stock','OK', format('BENGKEL %s kg', pg_temp.on_hand('I-53001','BENGKEL')));

  r := ops_inv.issue_stock('I-53001', 'BENGKEL', 6, jo, 'lem rangka kursi', 'sim-issue-1');
  select count(*) into n from ops_inv.stock_moves where item_code = 'I-53001' and kind = 'issue';
  perform pg_temp.log('4. Pemakaian','Tombol Catat tertekan dua kali','Dewi','/inventory/material','ops_inv.issue_stock',
    case when n = 1 then 'OK' else 'TEMUAN' end, format('%s gerak keluar', n), 'Tekanan kedua dijawab sama, tidak menulis dua kali.');

  r := ops_inv.issue_for_work_order(jo, 'GUDANG', '[{"item_code":"I-53002","qty":30}]'::jsonb, 'amplas kursi', 'sim-issue-2');
  assert ops_core.said_ok(r), format('issue for jo: %s', r);
  perform pg_temp.log('4. Pemakaian','Keluarkan material dari halaman Job Order','Dewi','/produksi/jadwal',
    'ops_inv.issue_for_work_order','OK', format('amplas GUDANG %s', pg_temp.on_hand('I-53002','GUDANG')));

  r := ops_inv.issue_stock('I-53001', 'BENGKEL', 30, jo, 'lem finishing', 'sim-issue-3');
  perform pg_temp.log('4. Pemakaian','Keluarkan lebih banyak dari yang tercatat','Dewi','/inventory/material',
    'ops_inv.issue_stock', case when (r -> 'data' ->> 'went_negative')::boolean then 'OK' else 'TEMUAN' end,
    format('BENGKEL %s kg', pg_temp.on_hand('I-53001','BENGKEL')),
    'Tidak ditolak (A6): tercatat, dan stok minus ditandai "perlu dihitung ulang".');

  -- Return and transfer are the screen's plain inserts (src/lib/api/inventory.ts).
  insert into ops_inv.stock_moves (item_code, location, kind, qty, uom, ref_no, reason, moved_by)
  values ('I-53001','BENGKEL','return', 4,'kg', jo, 'sisa lem kembali', auth.uid());
  perform pg_temp.log('4. Pemakaian','Kembalikan material yang tidak terpakai','Dewi','/inventory/material',
    'ops_inv.stock_moves (return)','OK', format('BENGKEL %s kg', pg_temp.on_hand('I-53001','BENGKEL')));

  insert into ops_inv.stock_moves (item_code, location, kind, qty, uom, reason, moved_by) values
    ('I-53002','GUDANG','transfer', -20,'lembar','ke rak A1', auth.uid()),
    ('I-53002','RAK-A1','transfer',  20,'lembar','ke rak A1', auth.uid());
  perform pg_temp.log('4. Pemakaian','Pindah lokasi: dari GUDANG ke RAK-A1','Dewi','/inventory/material',
    'ops_inv.stock_moves (transfer)',
    case when pg_temp.on_hand('I-53002') = 70 then 'OK' else 'TEMUAN' end,
    format('GUDANG %s · RAK-A1 %s', pg_temp.on_hand('I-53002','GUDANG'), pg_temp.on_hand('I-53002','RAK-A1')),
    'Dua baris yang saling meniadakan: total tidak berubah.');
end $$;

select pg_temp.as_('51530000-0000-0000-0000-0000000000e1');
do $$
declare r jsonb;
begin
  r := ops_inv.issue_stock('I-53001', 'BENGKEL', 1, null, 'coba');
  perform pg_temp.log('4. Pemakaian','Pembaca mencoba mengeluarkan material','Lina','/inventory/material',
    'ops_inv.issue_stock', case when pg_temp.said(r) = 'not_permitted' then 'DITOLAK' else 'TEMUAN' end, null, pg_temp.said(r));
end $$;

-- ═════ 5. OPNAME DAN PENYESUAIAN ══════════════════════════════════════════
select pg_temp.as_('51530000-0000-0000-0000-0000000000d1');
do $$
declare have numeric; ok boolean := false;
begin
  -- The glue went negative above. Counted on the rack: 3 kg.
  have := pg_temp.on_hand('I-53001','BENGKEL');
  begin
    insert into ops_inv.stock_moves (item_code, location, kind, qty, uom, moved_by)
    values ('I-53001','BENGKEL','adjust', 3 - have, 'kg', auth.uid());
  exception when check_violation then ok := true;
  end;
  perform pg_temp.log('5. Opname','Catat selisih tanpa alasan','Dewi','/inventory/penyesuaian',
    'ops_inv.stock_moves (adjust)', case when ok then 'DITOLAK' else 'TEMUAN' end, null,
    'Layar tidak membuka tombolnya tanpa alasan; database juga menolak (adjust_says_why).');

  insert into ops_inv.stock_moves (item_code, location, kind, qty, uom, reason, moved_by)
  values ('I-53001','BENGKEL','adjust', 3 - have, 'kg', 'Opname: lem finishing dipakai lebih dari yang dicatat keluar', auth.uid());
  perform pg_temp.log('5. Opname','Catat hasil hitung: barang, lokasi, jumlah fisik, alasan selisih','Dewi','/inventory/penyesuaian',
    'ops_inv.stock_moves (adjust)', case when pg_temp.on_hand('I-53001','BENGKEL') = 3 then 'OK' else 'TEMUAN' end,
    format('selisih %s · BENGKEL %s kg', 3 - have, pg_temp.on_hand('I-53001','BENGKEL')),
    'Yang disimpan selisihnya, bukan angka barunya.');

  perform pg_temp.log('5. Opname','Hitungan sama dengan catatan','Dewi','/inventory/penyesuaian',
    'ops_inv.stock_moves (adjust)','OK', format('RAK-A1 %s = %s', pg_temp.on_hand('I-53002','RAK-A1'), 20),
    'Tidak ada yang ditulis kalau cocok (selisih nol).');
end $$;

select pg_temp.as_('51530000-0000-0000-0000-0000000000e1');
do $$
declare ok boolean := false;
begin
  begin
    insert into ops_inv.stock_moves (item_code, location, kind, qty, uom, reason, moved_by)
    values ('I-53001','BENGKEL','adjust', 1, 'kg', 'coba', auth.uid());
  exception when insufficient_privilege then ok := true;
  end;
  perform pg_temp.log('5. Opname','Pembaca mencoba mencatat selisih','Lina','/inventory/penyesuaian',
    'ops_inv.stock_moves (adjust)', case when ok then 'DITOLAK' else 'TEMUAN' end, null,
    'Penyesuaian butuh inventory.adjust. Siapa yang menyetujui selisih belum diputuskan pemilik (Q57).');
end $$;

-- ═════ 6. BARANG JADI: JOB ORDER → RAK → SURAT JALAN ══════════════════════
select pg_temp.as_('51530000-0000-0000-0000-0000000000b0');
do $$
declare r jsonb; jo text := current_setting('sim.jo');
begin
  r := ops_prod.record_progress(jo, 'AMPLAS', 12, current_date);
  r := ops_prod.record_progress(jo, 'PACKING', 12, current_date);
  assert ops_core.said_ok(r), format('progress: %s', r);
  perform pg_temp.log('6. Barang jadi','(Produksi) Catat progres sampai tahap terakhir: 12 kursi selesai untuk pesanan 10','Budi','/produksi/progress',
    'ops_prod.record_progress','OK', '12 selesai');
end $$;

select pg_temp.as_('51530000-0000-0000-0000-0000000000d1');
do $$
declare r jsonb; jo text := current_setting('sim.jo'); v jsonb;
begin
  r := ops_inv.move_product('SIM-CHR','produced', 12,'FINISHING');
  perform pg_temp.log('6. Barang jadi','Catat hasil produksi tanpa Job Order','Dewi','/inventory/produk',
    'ops_inv.move_product', case when pg_temp.said(r) = 'wo_required' then 'DITOLAK' else 'TEMUAN' end, null, pg_temp.said(r));

  r := ops_inv.move_product('SIM-CHR','produced', 12,'FINISHING', p_wo_no => jo, p_key => 'sim-fg-1');
  assert ops_core.said_ok(r), format('produced: %s', r);
  perform pg_temp.log('6. Barang jadi','Hasil produksi masuk rak: produk, Job Order, jumlah, lokasi','Dewi','/inventory/produk',
    'ops_inv.move_product','OK', '12 di FINISHING',
    'Pesanan kliennya diambil dari Job Order, bukan dari formulir.');

  r := ops_inv.move_product('SIM-CHR','transfer', 13,'FINISHING', p_to_location => 'GUDANG',
         p_project_line_id => '51530000-0000-0000-0000-00000000c101');
  perform pg_temp.log('6. Barang jadi','Pindahkan lebih banyak dari yang ada','Dewi','/inventory/produk',
    'ops_inv.move_product', case when pg_temp.said(r) = 'insufficient' then 'DITOLAK' else 'TEMUAN' end, null, pg_temp.said(r));

  r := ops_inv.move_product('SIM-CHR','transfer', 8,'FINISHING', p_to_location => 'GUDANG',
         p_project_line_id => '51530000-0000-0000-0000-00000000c101', p_key => 'sim-fg-2');
  assert ops_core.said_ok(r), format('transfer: %s', r);
  perform pg_temp.log('6. Barang jadi','Pindah lokasi 8 kursi dari FINISHING ke GUDANG','Dewi','/inventory/produk',
    'ops_inv.move_product','OK','FINISHING 4 · GUDANG 8');
end $$;

select pg_temp.as_('51530000-0000-0000-0000-0000000000c0');
do $$
declare r jsonb;
begin
  r := ops_dlv.create_delivery('SIM-INV', current_date, '[{"project_line_id":"51530000-0000-0000-0000-00000000c101","qty":13}]');
  perform pg_temp.log('6. Barang jadi','(Pengiriman) Surat jalan untuk lebih banyak dari yang selesai','Joko','/pengiriman',
    'ops_dlv.create_delivery', case when pg_temp.said(r) = 'not_enough_made' then 'DITOLAK' else 'TEMUAN' end, null,
    pg_temp.said(r) || ' — siap kirim dihitung dari progres Job Order, bukan dari rak barang jadi.');

  r := ops_dlv.create_delivery('SIM-INV', current_date, '[{"project_line_id":"51530000-0000-0000-0000-00000000c101","qty":10}]',
         'L300 DK 1234', 'Pak Made', null, null, 'sim-sj-1');
  assert ops_core.said_ok(r), format('delivery: %s', r);
  perform set_config('sim.sj', r -> 'data' ->> 'delivery_no', true);
  perform pg_temp.log('6. Barang jadi','(Pengiriman) Buat surat jalan 10 kursi','Joko','/pengiriman',
    'ops_dlv.create_delivery','OK', (r -> 'data' ->> 'delivery_no') || ' IN_TRANSIT',
    'Gudang tidak mencatat pengiriman lagi: rak barang jadi membaca surat jalan.');
end $$;

select pg_temp.as_('51530000-0000-0000-0000-0000000000d1');
do $$
declare r jsonb; v jsonb; sj text := current_setting('sim.sj');
begin
  r := ops_inv.product_stock('SIM-CHR');
  select x into v from jsonb_array_elements(r -> 'data') x
   where x ->> 'project_line_id' = '51530000-0000-0000-0000-00000000c101';
  perform pg_temp.log('6. Barang jadi','Baca rak barang jadi setelah surat jalan berangkat','Dewi','/inventory/produk',
    'ops_inv.product_stock',
    case when (v ->> 'shipped')::numeric = 10 and (v ->> 'on_hand')::numeric = 2
              and (v ->> 'overrun')::numeric = 2 and (v ->> 'surplus')::numeric = 2
              and not exists (select 1 from jsonb_each_text(v -> 'by_location') e where e.value::numeric < 0)
         then 'OK' else 'TEMUAN' end,
    format('dibuat %s · terkirim %s · di rak %s · lebih %s · surplus %s · per lokasi %s',
           v ->> 'produced', v ->> 'shipped', v ->> 'on_hand', v ->> 'overrun', v ->> 'surplus', v -> 'by_location'),
    case when exists (select 1 from jsonb_each_text(v -> 'by_location') e where e.value::numeric < 0)
      then format('Surat jalan %s mengurangi 10 dari lokasi rumah (GUDANG) yang hanya memegang 8; FINISHING tetap 4. Per lokasi jadi minus (F177, B20).', sj)
      else 'Surat jalan mengurangi rak dari lokasi tempat batch itu berada.' end);

  r := ops_inv.allocate_product('SIM-CHR','51530000-0000-0000-0000-00000000c101',
         '51530000-0000-0000-0000-00000000c102', 'FINISHING', 2, 'Kelebihan kursi makan dipakai untuk pesanan teras', 'sim-al-1');
  perform pg_temp.log('6. Barang jadi','Surplus dipakai untuk pesanan lain (produk yang sama)','Dewi','/inventory/produk',
    'ops_inv.allocate_product', case when ops_core.said_ok(r) then 'OK' else 'TEMUAN' end,
    coalesce(r -> 'data' ->> 'move_no', pg_temp.said(r)),
    'Hanya surplus yang boleh pindah; yang masih menjadi hak pesanan asal tetap di sana.');

  r := ops_inv.count_product('SIM-CHR', 'FINISHING', 1, null, '51530000-0000-0000-0000-00000000c102');
  perform pg_temp.log('6. Barang jadi','Opname barang jadi: selisih tanpa alasan','Dewi','/inventory/produk',
    'ops_inv.count_product', case when pg_temp.said(r) = 'reason_required' then 'DITOLAK' else 'TEMUAN' end, null, pg_temp.said(r));
  r := ops_inv.count_product('SIM-CHR', 'FINISHING', 1, 'Satu kursi teras cacat kaki, dipisah', '51530000-0000-0000-0000-00000000c102', 'sim-cnt-1');
  perform pg_temp.log('6. Barang jadi','Opname barang jadi: jumlah fisik dan alasan selisih','Dewi','/inventory/produk',
    'ops_inv.count_product', case when ops_core.said_ok(r) then 'OK' else 'TEMUAN' end,
    format('selisih %s', r -> 'data' ->> 'diff'));

  r := ops_inv.move_product('SIM-CHR','sold', 1,'FINISHING', p_project_line_id => '51530000-0000-0000-0000-00000000c102');
  perform pg_temp.log('6. Barang jadi','Jual tanpa menyebut pembelinya','Dewi','/inventory/produk',
    'ops_inv.move_product', case when pg_temp.said(r) = 'reason_required' then 'DITOLAK' else 'TEMUAN' end, null, pg_temp.said(r));
end $$;

select pg_temp.as_('51530000-0000-0000-0000-0000000000e1');
do $$
declare r jsonb;
begin
  r := ops_inv.move_product('SIM-CHR','produced', 1,'GUDANG', p_wo_no => current_setting('sim.jo'));
  perform pg_temp.log('6. Barang jadi','Pembaca mencoba mencatat hasil produksi','Lina','/inventory/produk',
    'ops_inv.move_product', case when pg_temp.said(r) = 'not_permitted' then 'DITOLAK' else 'TEMUAN' end, null, pg_temp.said(r));
end $$;

-- ═════ 7. ASET ════════════════════════════════════════════════════════════
select pg_temp.as_('51530000-0000-0000-0000-0000000000d1');
do $$
declare r jsonb; a text; b text;
begin
  r := ops_inv.create_asset('  ', 'tool');
  perform pg_temp.log('7. Aset','Simpan aset tanpa nama','Dewi','/inventory/assets','ops_inv.create_asset',
    case when pg_temp.said(r) = 'name_required' then 'DITOLAK' else 'TEMUAN' end, null, pg_temp.said(r));

  r := ops_inv.create_asset('Mesin amplas Makita 9403', 'tool', 'Makita', '9403', 'SN-9403-77', 'BENGKEL', 'Pak Wayan',
         'in_use', current_date - 200, 4500000, null, null, current_date + 165, null, 'sim-as-1');
  assert ops_core.said_ok(r), format('asset: %s', r);
  a := r -> 'data' ->> 'asset_no';
  perform pg_temp.log('7. Aset','Tambah aset milik sendiri: nama, kategori, merek, nomor seri, lokasi, pemegang','Dewi','/inventory/assets',
    'ops_inv.create_asset','OK', a || ' in_use');

  r := ops_inv.create_asset('Forklift sewa', 'vehicle', p_location => 'GUDANG', p_ownership => 'rented',
         p_rent_amount => 3000000, p_rent_period => 'monthly', p_rent_due_day => 5,
         p_contract_start => current_date - 30, p_contract_end => current_date + 335, p_key => 'sim-as-2');
  assert ops_core.said_ok(r), format('rented: %s', r);
  b := r -> 'data' ->> 'asset_no';
  perform pg_temp.log('7. Aset','Tambah aset sewa: pemilik, biaya sewa, periode, tanggal jatuh tempo, masa kontrak','Dewi','/inventory/assets',
    'ops_inv.create_asset','OK', b || ' rented');

  r := ops_inv.add_asset_service(a, current_date - 3, 'Ganti karbon brush', 'repair', null, 150000);
  perform pg_temp.log('7. Aset','Catat servis/perbaikan','Dewi','/inventory/assets','ops_inv.add_asset_service',
    case when ops_core.said_ok(r) then 'OK' else 'TEMUAN' end, pg_temp.said(r));

  r := ops_inv.set_asset_status(a, 'lost', null);
  perform pg_temp.log('7. Aset','Tandai aset hilang tanpa keterangan','Dewi','/inventory/assets','ops_inv.set_asset_status',
    case when pg_temp.said(r) = 'note_required' then 'DITOLAK' else 'TEMUAN' end, null, pg_temp.said(r));

  r := ops_inv.set_asset_status(a, 'under_repair', 'dibawa ke servis Makita');
  perform pg_temp.log('7. Aset','Ubah status aset: dalam perbaikan','Dewi','/inventory/assets','ops_inv.set_asset_status',
    case when ops_core.said_ok(r) then 'OK' else 'TEMUAN' end, (select status::text from ops_inv.assets where asset_no = a));
end $$;

select pg_temp.as_('51530000-0000-0000-0000-0000000000e1');
do $$
declare r jsonb;
begin
  r := ops_inv.create_asset('Bor listrik', 'tool');
  perform pg_temp.log('7. Aset','Pembaca mencoba menambah aset','Lina','/inventory/assets','ops_inv.create_asset',
    case when pg_temp.said(r) = 'not_permitted' then 'DITOLAK' else 'TEMUAN' end, null, pg_temp.said(r));
end $$;

-- ═════ 8. KAYU LOG DAN PAPAN ══════════════════════════════════════════════
select pg_temp.as_('51530000-0000-0000-0000-0000000000d1');
do $$
declare r jsonb; v_no text; k text;
begin
  r := ops_inv.receive_logs('V-5302', current_date - 2, '', 5000000);
  perform pg_temp.log('8. Kayu','Terima kayu tanpa menyebut jenisnya','Dewi','/inventory/log','ops_inv.receive_logs',
    case when pg_temp.said(r) = 'species_required' then 'DITOLAK' else 'TEMUAN' end, null, pg_temp.said(r));

  r := ops_inv.receive_logs('V-5302', current_date - 2, 'Mahoni', 5000000, null, 'round', null, null, 'nota diketik',
         jsonb_build_array(jsonb_build_object('tag','#1','diameter_cm',30,'length_cm',250)),
         jsonb_build_array(jsonb_build_object('thickness_mm',25,'width_mm',150,'length_mm',2000,'qty',8,'grade','A')),
         'sim-log-1');
  assert ops_core.said_ok(r), format('logs: %s', r);
  v_no := r -> 'data' ->> 'purchase_no';
  perform pg_temp.log('8. Kayu','Terima kayu: supplier, tanggal, jenis, harga, log dan papan hasil gergaji','Dewi','/inventory/log',
    'ops_inv.receive_logs','OK', v_no);

  select board_key into k from ops_inv.v_board_stock where species = 'Mahoni' limit 1;
  r := ops_inv.move_boards(k, 'issue', 3, null);
  perform pg_temp.log('8. Kayu','Pakai papan tanpa menyebut pekerjaannya','Dewi','/inventory/log','ops_inv.move_boards',
    case when pg_temp.said(r) = 'ref_required' then 'DITOLAK' else 'TEMUAN' end, null, pg_temp.said(r));
  r := ops_inv.move_boards(k, 'issue', 3, current_setting('sim.jo'), null, null, 'sim-bd-1');
  perform pg_temp.log('8. Kayu','Pakai papan untuk Job Order','Dewi','/inventory/log','ops_inv.move_boards',
    case when ops_core.said_ok(r) then 'OK' else 'TEMUAN' end,
    format('%s tersisa %s lembar', k, (select qty from ops_inv.v_board_stock where board_key = k)));
end $$;

-- ═════ 9. LABEL ═══════════════════════════════════════════════════════════
select pg_temp.as_('51530000-0000-0000-0000-0000000000e1');
do $$
declare r jsonb;
begin
  r := ops_inv.label_sources('item', null, null, 'klem');
  perform pg_temp.log('9. Label','Cari barang yang baru didaftarkan untuk dicetak labelnya','Lina','/inventory/label',
    'ops_inv.label_sources', case when ops_core.said_ok(r) and jsonb_array_length(r -> 'data') >= 1 then 'OK' else 'TEMUAN' end,
    coalesce(jsonb_array_length(r -> 'data')::text, pg_temp.said(r)) || ' label',
    'Membaca saja: pemegang inventory read boleh mencetak.');
end $$;

-- The whole week, one row per thing somebody did. `simulate.sh` prints this.
select n, proses, langkah, pelaku, layar, seam, hasil, status, catatan from sim_log order by n;

do $$
declare n int;
begin
  select count(*) into n from sim_log where hasil = 'TEMUAN';
  raise notice 'simulasi inventory: % langkah, % temuan', (select count(*) from sim_log), n;
end $$;

rollback;
