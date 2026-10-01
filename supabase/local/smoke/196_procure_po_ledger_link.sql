-- procure/acct — a payment that reaches its order, and an order that closes
-- the way it says it is finished (0196).
--
-- Proved here:
--   a payment booked on the ledger with no allocation leaves its order UNPAID,
--     and shows on v_unlinked_vendor_payment (ACC-002)
--   link_payment_to_po refuses: no authority, another vendor's payment, money
--     coming in, more than is unallocated, an order not yet issued
--   linking splits like post_to_po: the linked request line takes its share,
--     the rest names the order alone, and the payment leaves the unlinked list
--   ready_to_close once paid within the tolerance and fully delivered (ACC-007)
--   close_po without a reason on a SETTLED order (ACC-005), and the order keeps
--     who, when, settled_early (ACC-006); an early close keeps its reason

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('19600000-0000-0000-0000-00000000a11d','andi@talaliving.com','{"full_name":"Andi"}'),
  ('19600000-0000-0000-0000-00000000ce00','evin@talaliving.com','{"full_name":"Evin"}'),
  ('19600000-0000-0000-0000-00000000f11a','rina@talaliving.com','{"full_name":"Rina"}'),
  ('19600000-0000-0000-0000-00000000fd00','geryle@talaliving.com','{"full_name":"Geryle"}');
insert into ops_core.user_modules (user_id, module, level) values
  ('19600000-0000-0000-0000-00000000a11d','procurement','write'),
  ('19600000-0000-0000-0000-00000000ce00','procurement','write'),
  ('19600000-0000-0000-0000-00000000f11a','procurement','read'),
  ('19600000-0000-0000-0000-00000000f11a','accounting','write'),
  ('19600000-0000-0000-0000-00000000fd00','procurement','read');
insert into ops_core.user_authorities (user_id, authority) values
  ('19600000-0000-0000-0000-00000000ce00','approve_goods'),
  ('19600000-0000-0000-0000-00000000f11a','post_ledger'),
  ('19600000-0000-0000-0000-00000000fd00','approve_funds');

set local role authenticated;
create temp table t_ctx (k text primary key, v text) on commit drop;
grant all on t_ctx to authenticated;

-- ── a request, approved, and an order: one linked line + an unlinked one ─
set local request.jwt.claim.sub = '19600000-0000-0000-0000-00000000a11d';
do $$
declare r jsonb; doc text; v uuid; att jsonb;
begin
  r := ops_procure.create_vendor('CV TAUT UJI');  insert into t_ctx values ('vendor', r->'data'->>'code');
  r := ops_procure.create_vendor('CV LAIN UJI');  insert into t_ctx values ('other', r->'data'->>'code');
  v := (select id from ops_procure.vendors where name = 'CV TAUT UJI');
  r := ops_procure.create_pr(jsonb_build_array(
        jsonb_build_object('description','Plywood','qty',10,'uom','lembar','unit_price',150000,'vendor_id',v)));
  doc := r->'data'->>'doc_no';
  insert into t_ctx values ('doc', doc);
  perform ops_procure.submit_pr(doc);
  att := ops_core.attach_url('https://toko.example/plywood', 'q');
  perform ops_core.attach_link((att->'data'->>'attachment_id')::uuid, 'pr_line', doc || '-L01', 'quotation');
end $$;

set local request.jwt.claim.sub = '19600000-0000-0000-0000-00000000ce00';
select ops_procure.approve_line((select v from t_ctx where k='doc') || '-L01', true, null, null, null, null);

set local request.jwt.claim.sub = '19600000-0000-0000-0000-00000000a11d';
do $$
declare r jsonb; doc text := (select v from t_ctx where k='doc'); ven text := (select v from t_ctx where k='vendor');
begin
  -- Contract 1.500.000 + 500.000 = 2.000.000.
  r := ops_procure.create_po(ven, jsonb_build_array(
        jsonb_build_object('description','Plywood','qty',10,'uom','lembar','unit_price',150000,'pr_line_no', doc || '-L01'),
        jsonb_build_object('description','Ongkir','qty',1,'uom','unit','unit_price',500000)));
  assert ops_core.said_ok(r), format('order: %s', r);
  insert into t_ctx values ('po', r->'data'->>'po_no');
  -- A second order, left as a draft, for the "not issued" refusal.
  r := ops_procure.create_po(ven, jsonb_build_array(
        jsonb_build_object('description','Lem','qty',1,'uom','unit','unit_price',100000)));
  insert into t_ctx values ('draft', r->'data'->>'po_no');
end $$;
set local request.jwt.claim.sub = '19600000-0000-0000-0000-00000000ce00';
select ops_procure.approve_po(p_po_no => (select v from t_ctx where k='po'));
set local request.jwt.claim.sub = '19600000-0000-0000-0000-00000000a11d';
select ops_procure.issue_po((select v from t_ctx where k='po'));

-- ── ACC-002: paid from New ledger entry, with no allocation ──────────────
set local request.jwt.claim.sub = '19600000-0000-0000-0000-00000000f11a';
do $$
declare r jsonb; att uuid; po text := (select v from t_ctx where k='po'); u record;
  function_docs jsonb;
begin
  r := ops_core.attach_file('t/bukti196.jpg','bukti196.jpg','image/jpeg',1000,null,'upload');
  att := (r->'data'->>'attachment_id')::uuid;
  insert into t_ctx values ('proof', att::text);
  function_docs := jsonb_build_array(jsonb_build_object('attachment_id', att, 'kind', 'Payment Proof'));

  r := ops_acct.post_transaction('BCA 271','OUT', 1200000, 'SUPPLIERS', 'Bayar CV TAUT UJI', function_docs,
        null, (select v from t_ctx where k='vendor'), null,
        jsonb_build_array(jsonb_build_object('description','Plywood','qty',8,'uom','lembar','unit_price',150000,'amount',1200000)),
        null, 'smoke196:manual');
  assert ops_core.said_ok(r), format('manual payment: %s', r);
  insert into t_ctx values ('trx', r->'data'->>'trx_no');

  assert (select paid_to_date from ops_procure.v_po_status where po_no = po) = 0,
    'a payment that names no order is not the order''s';
  select * into u from ops_acct.v_unlinked_vendor_payment where trx_no = r->'data'->>'trx_no';
  assert u.unallocated = 1200000, format('it shows as unlinked money, got %s', u.unallocated);
  assert u.open_orders @> jsonb_build_array(jsonb_build_object('po_no', po)),
    format('naming the open order it probably paid, got %s', u.open_orders);

  -- Another vendor's payment, and money coming in, for the refusals.
  r := ops_acct.post_transaction('BCA 271','OUT', 300000, 'SUPPLIERS', 'Bayar CV LAIN UJI', function_docs,
        null, (select v from t_ctx where k='other'), null,
        jsonb_build_array(jsonb_build_object('description','Lain','qty',1,'uom','unit','unit_price',300000,'amount',300000)),
        null, 'smoke196:other');
  insert into t_ctx values ('other_trx', r->'data'->>'trx_no');
  r := ops_acct.post_transaction('BCA 271','IN', 50000, 'CASHFLOW', 'Refund', function_docs,
        null, null, null, '[]'::jsonb, null, 'smoke196:in');
  insert into t_ctx values ('in_trx', r->'data'->>'trx_no');
end $$;

-- ── link_payment_to_po: the refusals ─────────────────────────────────────
set local request.jwt.claim.sub = '19600000-0000-0000-0000-00000000a11d';
do $$
declare r jsonb;
begin
  r := ops_acct.link_payment_to_po((select v from t_ctx where k='trx'), (select v from t_ctx where k='po'));
  assert r->'error'->>'code' = 'authority_required', format('procurement does not apply money, got %s', r);
end $$;

set local request.jwt.claim.sub = '19600000-0000-0000-0000-00000000f11a';
do $$
declare r jsonb; po text := (select v from t_ctx where k='po');
begin
  r := ops_acct.link_payment_to_po((select v from t_ctx where k='other_trx'), po);
  assert r->'error'->>'code' = 'vendor_differs', format('another vendor''s payment, got %s', r);
  r := ops_acct.link_payment_to_po((select v from t_ctx where k='in_trx'), po);
  assert r->'error'->>'code' = 'not_a_payment', format('money in is not a payment, got %s', r);
  r := ops_acct.link_payment_to_po((select v from t_ctx where k='trx'), po, 1300000);
  assert r->'error'->>'code' = 'over_allocated', format('more than the row moved, got %s', r);
  r := ops_acct.link_payment_to_po((select v from t_ctx where k='trx'), (select v from t_ctx where k='draft'));
  assert r->'error'->>'code' = 'order_not_open', format('a draft owes nothing, got %s', r);
end $$;

-- ── linking: split like post_to_po ───────────────────────────────────────
do $$
declare r jsonb; po text := (select v from t_ctx where k='po'); doc text := (select v from t_ctx where k='doc');
        trx text := (select v from t_ctx where k='trx');
begin
  r := ops_acct.link_payment_to_po(trx, po);
  assert ops_core.said_ok(r), format('link: %s', r);
  assert (r->'data'->>'amount')::numeric = 1200000, 'the whole unallocated amount by default';

  assert (select paid_to_date from ops_procure.v_po_status where po_no = po) = 1200000,
    'the order hears about the money now';
  -- 1.200.000 × 1.500.000 / 2.000.000 = 900.000 to the linked line; 300.000 to the order alone.
  assert (select covered from ops_procure.v_line_coverage where line_no_full = doc || '-L01') = 900000,
    'the linked request line takes its share';
  assert (select sum(amount) from ops_acct.payment_allocations
           where trx_id = (select id from ops_acct.transactions where trx_no = trx) and superseded_by is null) = 1200000,
    'the shares add up to the payment';
  assert not exists (select 1 from ops_acct.v_unlinked_vendor_payment where trx_no = trx),
    'and it leaves the unlinked list';

  r := ops_acct.link_payment_to_po(trx, po);
  assert r->'error'->>'code' = 'nothing_to_link', format('twice has nothing left, got %s', r);
end $$;

-- ── ACC-005/007: paid within the tolerance and delivered → ready ────────
do $$
declare r jsonb; po text := (select v from t_ctx where k='po'); att uuid := (select v::uuid from t_ctx where k='proof');
begin
  -- 800.000 outstanding; pay 799.500 — SETTLED within Rp 1.000.
  r := ops_acct.post_to_po(po, 799500, 'BCA 271', 'SUPPLIERS', att);
  assert ops_core.said_ok(r), format('pay the rest: %s', r);
  assert (select payment_state::text from ops_procure.v_po_status where po_no = po) = 'SETTLED', 'settled within tolerance';
end $$;

set local request.jwt.claim.sub = '19600000-0000-0000-0000-00000000a11d';
do $$
declare r jsonb; po text := (select v from t_ctx where k='po'); x record; photo uuid;
begin
  assert not (select ready_to_close from ops_procure.v_po_detail where po_no = po), 'not ready before the goods arrive';
  r := ops_core.attach_file('t/foto196.jpg','foto196.jpg','image/jpeg',1000,null,'upload');
  photo := (r->'data'->>'attachment_id')::uuid;
  for x in select o.id, o.qty from ops_procure.po_lines o join ops_procure.purchase_orders p on p.id = o.po_id
            where p.po_no = po and o.superseded_by is null loop
    r := ops_procure.create_receipt(x.qty, 'GOOD',
          jsonb_build_array(jsonb_build_object('attachment_id', photo, 'kind','Receiving Item')), null, x.id);
    assert ops_core.said_ok(r), format('receipt: %s', r);
    r := ops_procure.confirm_receipt(r->'data'->>'receipt_no');
    assert ops_core.said_ok(r), format('confirm: %s', r);
  end loop;
end $$;

-- Read as Rina: the money behind *paid* is accounting's to see (RLS), so a
-- procurement-only reader sees every order unpaid — the same reason 22 reads
-- money as Rina. Whoever closes holds accounting read (Penyetuju dana).
set local request.jwt.claim.sub = '19600000-0000-0000-0000-00000000f11a';
do $$
declare po text := (select v from t_ctx where k='po');
begin
  assert (select ready_to_close from ops_procure.v_po_detail where po_no = po), 'paid and delivered: ready to close';
  assert (select ready_to_close from ops_procure.v_po_board where po_no = po), 'and the board says so too';
  assert (select jsonb_array_length(close_blockers) from ops_procure.v_po_detail where po_no = po) = 0,
    'nothing blocks a SETTLED order';
end $$;

-- ── ACC-005/006: closing a SETTLED order, no reason needed ──────────────
set local request.jwt.claim.sub = '19600000-0000-0000-0000-00000000fd00';
do $$
declare r jsonb; po text := (select v from t_ctx where k='po'); o record;
begin
  r := ops_procure.close_po(p_po_no => po);
  assert ops_core.said_ok(r), format('a settled, delivered order closes without a reason, got %s', r);
  select * into o from ops_procure.v_po_detail where po_no = po;
  assert o.status = 'CLOSED' and o.closed_at is not null and o.closed_by_name = 'Geryle'
     and o.settled_early = false and o.close_reason is null,
    format('the order keeps how it was closed: %s %s %s %s', o.status, o.closed_by_name, o.settled_early, o.close_reason);
  assert not o.ready_to_close, 'and is no longer waiting to be closed';
end $$;

-- An early close keeps its reason on the order.
set local request.jwt.claim.sub = '19600000-0000-0000-0000-00000000ce00';
select ops_procure.approve_po(p_po_no => (select v from t_ctx where k='draft'));
set local request.jwt.claim.sub = '19600000-0000-0000-0000-00000000a11d';
select ops_procure.issue_po((select v from t_ctx where k='draft'));
set local request.jwt.claim.sub = '19600000-0000-0000-0000-00000000fd00';
do $$
declare r jsonb; po text := (select v from t_ctx where k='draft'); o record;
begin
  r := ops_procure.close_po(p_po_no => po);
  assert r->'error'->>'code' = 'close_refused', format('unpaid and undelivered needs a reason, got %s', r);
  r := ops_procure.close_po(p_po_no => po, p_settle_reason => 'Vendor membatalkan pesanan.');
  assert ops_core.said_ok(r), format('%s', r);
  select * into o from ops_procure.v_po_detail where po_no = po;
  assert o.settled_early and o.close_reason = 'Vendor membatalkan pesanan.',
    format('the reason is on the order, not only in the audit trail: %s / %s', o.settled_early, o.close_reason);
end $$;

rollback;
