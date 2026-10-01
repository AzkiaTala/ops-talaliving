-- 0196_procure_po_ledger_link.sql — a payment that reaches its order, and an
-- order that closes the way it says it is finished.
--
-- QA 2026-10-01 (QA-Accounting-Production.xlsx):
--
--   ACC-002  A payment to a vendor booked from *New ledger entry* names no order,
--            so the order it paid stays UNPAID and cannot close. The money moved;
--            the order never heard. Paying again from the order's screen would pay
--            the vendor twice.
--   ACC-005  `v_po_status` calls an order SETTLED within the payment tolerance
--            (Rp 1.000); `close_po` wanted outstanding = 0, so a SETTLED order was
--            refused and asked for a reason it did not need.
--   ACC-006  An order closed early said so only in the audit trail. The order
--            itself could not answer *why is this CLOSED with money owed*.
--   ACC-007  Nothing said which orders were paid and delivered and only waiting
--            to be closed.
--
-- ACC-003 (the Close button shown to people the seam refuses) is the screen's.
--
-- ── What this adds ────────────────────────────────────────────────────────
--
--   * `ops_acct.split_to_po` — the one place a payment is spread over an order:
--     each linked request line takes its share of the contract, the rest names
--     the order alone. `post_to_po` (0139) did this inline; it now calls this,
--     unchanged in what it writes, so paying an order and linking an old
--     payment to it can never split money two different ways.
--   * `ops_acct.link_payment_to_po` — an existing ledger row, already out of the
--     bank, applied to an order. Same vendor, an issued and open order, no more
--     than the transaction has unallocated and no more than the order still
--     owes. Nothing new is posted: the money moved once.
--   * `ops_acct.v_unlinked_vendor_payment` — money out to a vendor that still has
--     an open order, with part of it applied to nothing. The list ACC-002's old
--     data is cleaned up from.
--   * `close_po` closes a SETTLED order without a reason, and records closed_by,
--     closed_at, close_reason and settled_early on the order.
--   * `v_po_detail` says the same, plus `ready_to_close`; `v_po_board` carries
--     `ready_to_close` for the list.

alter table ops_procure.purchase_orders
  add column closed_at     timestamptz,
  add column closed_by     uuid references ops_core.users(id),
  add column close_reason  text,
  add column settled_early boolean,
  -- Orders closed before 0196 have none of these, so the rule runs one way:
  -- whatever carries a close stamp is closed.
  add constraint close_stamp_means_closed check (closed_at is null or status = 'CLOSED');

-- ── the split, in one place ───────────────────────────────────────────────
create or replace function ops_acct.split_to_po(
  p_trx_id uuid, p_po_no text, p_amount numeric)
returns jsonb
-- **Invoker, not definer, and granted to nobody.** It writes allocations
-- without asking anything — the two seams that call it have already decided
-- (authority, order, amount). Called from inside them it runs with their
-- rights; called by a person directly it has none.
language plpgsql security invoker set search_path = ops_acct, ops_procure, ops_core, pg_temp as $$
declare v_po record; x record; v_share numeric; v_spent numeric := 0; v_shares jsonb := '[]'::jsonb;
begin
  select p.id, s.contract_value into v_po
    from ops_procure.purchase_orders p
    join ops_procure.v_po_status s on s.po_id = p.id
   where p.po_no = p_po_no;

  -- Each linked line takes its share of the contract, rounded to the rupiah;
  -- whatever is left — unlinked lines and rounding — names the order alone, so
  -- the shares always add up to the amount applied.
  if coalesce(v_po.contract_value, 0) > 0 then
    for x in
      select l.line_no_full, o.line_total
        from ops_procure.po_lines o
        join ops_procure.pr_lines l on l.id = o.pr_line_id
       where o.po_id = v_po.id and o.superseded_by is null
       order by o.line_no
    loop
      v_share := least(round(p_amount * x.line_total / v_po.contract_value), p_amount - v_spent);
      if v_share > 0 then
        insert into ops_acct.payment_allocations (trx_id, pr_line_no, po_no, amount, method, allocated_by)
        values (p_trx_id, x.line_no_full, p_po_no, v_share, 'transfer', auth.uid());
        v_spent := v_spent + v_share;
        v_shares := v_shares || jsonb_build_object('pr_line_no', x.line_no_full, 'amount', v_share);
      end if;
    end loop;
  end if;
  if p_amount - v_spent > 0 then
    insert into ops_acct.payment_allocations (trx_id, pr_line_no, po_no, amount, method, allocated_by)
    values (p_trx_id, null, p_po_no, p_amount - v_spent, 'transfer', auth.uid());
  end if;
  return v_shares;
end $$;

revoke execute on function ops_acct.split_to_po(uuid, text, numeric) from public;

-- ── paying an order from its screen: unchanged, now through the split ────
create or replace function ops_acct.post_to_po(
  p_po_no         text,
  p_amount        numeric,
  p_account_code  text,
  p_type_code     text,
  p_attachment_id uuid,
  p_trx_date      date default null,
  p_document_kind text default 'Payment Proof',
  p_key           text default null)
returns jsonb language plpgsql security definer
set search_path = ops_acct, ops_core, ops_procure, pg_temp as $$
declare
  v_po record; v_posted jsonb; v_trx_no text; v_trx_id uuid; v_src text;
  v_shares jsonb; v_replayed jsonb; v_res jsonb;
begin
  v_replayed := ops_core.idem_replay('accounting','post_to_po:' || coalesce(p_po_no,'?'), p_key);
  if v_replayed is not null then return v_replayed; end if;

  if not ops_core.has_authority('post_ledger') then
    return ops_core.refused('accounting','transaction', p_po_no,'post_to_po',
      'authority_required',
      'Posting to the ledger belongs to Accounting — logged, not applied.',
      jsonb_build_object('required','post_ledger','attempted_amount', p_amount));
  end if;

  select p.id, p.po_no, p.status, v.code as vendor_code, s.contract_value, s.outstanding
    into v_po
    from ops_procure.purchase_orders p
    join ops_procure.vendors v on v.id = p.vendor_id
    join ops_procure.v_po_status s on s.po_id = p.id
   where p.po_no = p_po_no;
  if not found then
    return ops_core.invalid('accounting','transaction', p_po_no,'post_to_po',
      'po_not_found', format('Order %s does not exist.', p_po_no), jsonb_build_object('field','po_no'));
  end if;
  if v_po.status = 'DRAFT' then
    return ops_core.conflict('accounting','transaction', p_po_no,'post_to_po',
      'not_issued', format('%s has not been issued — nothing is owed on an order the vendor has not received.', p_po_no));
  end if;
  if v_po.status in ('CLOSED','CANCELLED') then
    return ops_core.conflict('accounting','transaction', p_po_no,'post_to_po',
      'order_closed', format('%s is %s.', p_po_no, lower(v_po.status::text)));
  end if;
  if p_amount is null or p_amount <= 0 then
    return ops_core.invalid('accounting','transaction', p_po_no,'post_to_po',
      'amount_positive','A payment is more than nothing.', jsonb_build_object('field','amount'));
  end if;
  if p_amount > v_po.outstanding + ops_core.money_tolerance() then
    return ops_core.invalid('accounting','transaction', p_po_no,'post_to_po',
      'over_contract',
      format('Only %s is still outstanding on %s. Money beyond the contract is a question for the vendor, not a payment on this order.',
             v_po.outstanding, p_po_no),
      jsonb_build_object('field','amount','outstanding', v_po.outstanding));
  end if;
  if p_attachment_id is null then
    return ops_core.invalid('accounting','transaction', p_po_no,'post_to_po',
      'evidence_required',
      'A payment needs its proof. Attach the transfer receipt before recording it.',
      jsonb_build_object('field','attachment_id'));
  end if;

  v_src := format('po:%s:%s:%s', p_po_no, coalesce(p_trx_date, ops_core.office_day()), p_amount);

  v_posted := ops_acct.post_transaction(
    p_account_code => p_account_code,
    p_direction    => 'OUT',
    p_amount       => p_amount,
    p_type_code    => p_type_code,
    p_description  => format('Pembayaran %s', p_po_no),
    p_documents    => jsonb_build_array(jsonb_build_object(
                        'attachment_id', p_attachment_id,
                        'kind', coalesce(nullif(btrim(p_document_kind), ''), 'Payment Proof'))),
    p_trx_date     => p_trx_date,
    p_vendor_code  => v_po.vendor_code,
    p_project_code => null,
    p_lines        => jsonb_build_array(jsonb_build_object(
                        'description', format('Pembayaran %s', p_po_no),
                        'qty', 1, 'uom', 'unit', 'unit_price', p_amount, 'amount', p_amount)),
    p_source_ref   => v_src,
    p_key          => null);
  if v_posted ->> 'outcome' <> 'ok' then
    return v_posted;
  end if;
  v_trx_no := v_posted -> 'data' ->> 'trx_no';
  select id into v_trx_id from ops_acct.transactions where trx_no = v_trx_no;

  v_shares := ops_acct.split_to_po(v_trx_id, p_po_no, p_amount);

  perform ops_core.emit('accounting','accounting.allocation.recorded', p_po_no,
    jsonb_build_object('trx_no', v_trx_no, 'po_no', p_po_no, 'amount', p_amount, 'lines', v_shares));

  v_res := ops_core.ok('accounting','transaction', v_trx_no,'post_to_po',
    jsonb_build_object('trx_no', v_trx_no, 'po_no', p_po_no, 'amount', p_amount,
                       'account', p_account_code, 'type', p_type_code, 'lines', v_shares));
  return ops_core.idem_remember('accounting','post_to_po:' || p_po_no, p_key, v_res);
end $$;

revoke execute on function ops_acct.post_to_po(text, numeric, text, text, uuid, date, text, text) from public;
grant execute on function ops_acct.post_to_po(text, numeric, text, text, uuid, date, text, text) to authenticated;

-- ── an old payment, applied to the order it paid (ACC-002) ───────────────
create or replace function ops_acct.link_payment_to_po(
  p_trx_no text, p_po_no text, p_amount numeric default null, p_key text default null)
returns jsonb
language plpgsql security definer set search_path = ops_acct, ops_procure, ops_core, pg_temp as $$
declare v_t ops_acct.transactions; v_po record; v_free numeric; v_amount numeric;
        v_shares jsonb; v_replayed jsonb; v_res jsonb;
begin
  v_replayed := ops_core.idem_replay('accounting','link_po:' || coalesce(p_trx_no,'?') || ':' || coalesce(p_po_no,'?'), p_key);
  if v_replayed is not null then return v_replayed; end if;

  if not ops_core.has_authority('post_ledger') then
    return ops_core.refused('accounting','allocation', p_po_no,'link_po',
      'authority_required','Applying money to an order belongs to Accounting.');
  end if;

  select * into v_t from ops_acct.transactions where trx_no = p_trx_no;
  if not found then
    return ops_core.not_found('accounting','allocation', p_po_no,'link_po',
      format('Tidak ada transaksi %s.', p_trx_no));
  end if;
  if v_t.status = 'VOID' then
    return ops_core.conflict('accounting','allocation', p_po_no,'link_po',
      'transaction_void', format('%s sudah VOID dan tidak membiayai apa pun.', p_trx_no));
  end if;
  if v_t.direction <> 'OUT' then
    return ops_core.invalid('accounting','allocation', p_po_no,'link_po',
      'not_a_payment', format('%s adalah uang masuk, bukan pembayaran ke vendor.', p_trx_no),
      jsonb_build_object('field','trx_no'));
  end if;

  select p.id, p.po_no, p.status, p.vendor_id, s.outstanding into v_po
    from ops_procure.purchase_orders p
    join ops_procure.v_po_status s on s.po_id = p.id
   where p.po_no = p_po_no;
  if not found then
    return ops_core.not_found('accounting','allocation', p_po_no,'link_po',
      format('Tidak ada PO %s.', p_po_no));
  end if;
  if v_po.status <> 'ISSUED' then
    return ops_core.conflict('accounting','allocation', p_po_no,'link_po',
      'order_not_open', format('%s berstatus %s — hanya PO yang sudah terbit dan belum ditutup yang bisa menerima pembayaran.', p_po_no, v_po.status));
  end if;
  -- The ledger row names who it paid; the order names who it owes. A payment
  -- to one vendor is never another vendor's order.
  if v_t.vendor_id is distinct from v_po.vendor_id then
    return ops_core.invalid('accounting','allocation', p_po_no,'link_po',
      'vendor_differs', format('%s dibayar ke vendor lain, bukan vendor %s.', p_trx_no, p_po_no),
      jsonb_build_object('field','po_no'));
  end if;

  v_free := v_t.amount_idr - coalesce((select allocated_total from ops_acct.v_allocated where trx_id = v_t.id), 0);
  v_amount := coalesce(p_amount, least(v_free, v_po.outstanding));
  if v_amount is null or v_amount <= 0 then
    return ops_core.invalid('accounting','allocation', p_po_no,'link_po',
      'nothing_to_link',
      case when v_free <= 0 then format('Seluruh %s sudah dialokasikan.', p_trx_no)
           else format('%s sudah lunas.', p_po_no) end,
      jsonb_build_object('field','amount','unallocated', v_free, 'outstanding', v_po.outstanding));
  end if;
  if v_amount > v_free then
    return ops_core.invalid('accounting','allocation', p_po_no,'link_po',
      'over_allocated', format('%s hanya punya %s yang belum dialokasikan.', p_trx_no, v_free),
      jsonb_build_object('field','amount','unallocated', v_free));
  end if;
  if v_amount > v_po.outstanding + ops_core.money_tolerance() then
    return ops_core.invalid('accounting','allocation', p_po_no,'link_po',
      'over_contract', format('Sisa tagihan %s hanya %s.', p_po_no, v_po.outstanding),
      jsonb_build_object('field','amount','outstanding', v_po.outstanding));
  end if;

  v_shares := ops_acct.split_to_po(v_t.id, p_po_no, v_amount);

  perform ops_core.emit('accounting','accounting.allocation.recorded', p_po_no,
    jsonb_build_object('trx_no', p_trx_no, 'po_no', p_po_no, 'amount', v_amount, 'lines', v_shares, 'linked', true));

  v_res := ops_core.ok('accounting','allocation', p_po_no,'link_po',
    jsonb_build_object('trx_no', p_trx_no, 'po_no', p_po_no, 'amount', v_amount, 'lines', v_shares));
  return ops_core.idem_remember('accounting','link_po:' || p_trx_no || ':' || p_po_no, p_key, v_res);
end $$;

revoke execute on function ops_acct.link_payment_to_po(text, text, numeric, text) from public;
grant execute on function ops_acct.link_payment_to_po(text, text, numeric, text) to authenticated;

-- ── the money that never reached its order ───────────────────────────────
-- Out of the bank, to a vendor that still has an issued order owing money,
-- with part of it applied to nothing. Read as the person: the ledger rows
-- are accounting's to see (RLS on transactions), so a procurement-only reader
-- gets an empty list rather than somebody else's numbers.
create or replace view ops_acct.v_unlinked_vendor_payment as
  select t.trx_no, t.trx_date, a.code as account_code, t.vendor_id, v.name as vendor_name,
         t.description, t.amount_idr,
         t.amount_idr - coalesce(al.allocated_total, 0) as unallocated,
         op.open_orders
    from ops_acct.transactions t
    join ops_acct.accounts a on a.id = t.account_id
    join ops_procure.vendors v on v.id = t.vendor_id
    left join ops_acct.v_allocated al on al.trx_id = t.id
    join lateral (
      select jsonb_agg(jsonb_build_object('po_no', s.po_no, 'outstanding', s.outstanding,
                                          'issued_at', s.issued_at) order by s.issued_at) as open_orders
        from ops_procure.v_po_status s
       where s.vendor_id = t.vendor_id and s.status = 'ISSUED'
         and s.outstanding > ops_core.money_tolerance()
    ) op on op.open_orders is not null
   where t.status <> 'VOID' and t.direction = 'OUT'
     and t.amount_idr - coalesce(al.allocated_total, 0) > 0;

alter view ops_acct.v_unlinked_vendor_payment set (security_invoker = on);
grant select on ops_acct.v_unlinked_vendor_payment to authenticated;

-- ── closing: SETTLED is enough, and the order keeps how it was closed ────
create or replace function ops_procure.close_po(
  p_po_no text, p_settle_reason text default null, p_key text default null)
returns jsonb
language plpgsql security definer set search_path = ops_procure, ops_core, pg_temp as $$
declare
  v_po ops_procure.purchase_orders; v_s record;
  v_blockers text[] := '{}';
  v_reason text; v_early boolean; v_replayed jsonb; v_res jsonb;
begin
  v_replayed := ops_core.idem_replay('procurement','close_po:' || p_po_no, p_key);
  if v_replayed is not null then return v_replayed; end if;

  if not ops_core.has_authority('approve_funds') then
    return ops_core.refused('procurement','purchase_order', p_po_no,'close',
      'authority_required','Closing an order is Finance''s to do — it says we owe nothing more on it.');
  end if;

  select * into v_po from ops_procure.purchase_orders where po_no = p_po_no;
  if not found then
    return ops_core.not_found('procurement','purchase_order', p_po_no,'close','No such order.');
  end if;
  if v_po.status = 'CLOSED' then
    return ops_core.noop('procurement','purchase_order', p_po_no,'close',
      'already closed', jsonb_build_object('po_no', p_po_no));
  end if;
  if v_po.status = 'DRAFT' then
    return ops_core.conflict('procurement','purchase_order', p_po_no,'close',
      'never_issued','It was never issued — cancel it rather than close it.');
  end if;

  select * into v_s from ops_procure.v_po_status where po_id = v_po.id;
  -- The same line `payment_state` draws (ACC-005): within the payment
  -- tolerance an order is SETTLED, and a SETTLED order owes nothing.
  if v_s.outstanding > ops_core.money_tolerance() then
    v_blockers := v_blockers || format('%s of the contract has not been paid.', v_s.outstanding);
  end if;
  if not coalesce(v_s.fully_delivered, false) then
    v_blockers := v_blockers || 'Not everything ordered has arrived.'::text;
  end if;

  v_reason := nullif(btrim(p_settle_reason), '');
  v_early := coalesce(array_length(v_blockers, 1), 0) > 0;
  if v_early and v_reason is null then
    return ops_core.invalid('procurement','purchase_order', p_po_no,'close',
      'close_refused',
      format('%s is not finished: %s Close it anyway by saying why — that reason is what somebody reads in six months.',
             p_po_no, array_to_string(v_blockers, ' ')),
      jsonb_build_object('field','settle_reason','blockers', to_jsonb(v_blockers)));
  end if;

  update ops_procure.purchase_orders
     set status = 'CLOSED', closed_at = now(), closed_by = auth.uid(),
         -- A reason typed against an order that was finished anyway is still
         -- what the person said; it is kept, and settled_early says which.
         close_reason = v_reason, settled_early = v_early
   where id = v_po.id;

  perform ops_core.emit('procurement','procurement.po.closed', p_po_no,
    jsonb_build_object('po_no', p_po_no, 'settled_early', v_early, 'reason', v_reason));
  v_res := ops_core.ok('procurement','purchase_order', p_po_no,'close',
    jsonb_build_object('po_no', p_po_no, 'status','CLOSED',
                       'settled_early', v_early,
                       'blockers', to_jsonb(v_blockers),
                       'outstanding', v_s.outstanding,
                       'reason', v_reason));
  return ops_core.idem_remember('procurement','close_po:' || p_po_no, p_key, v_res);
end $$;

revoke execute on function ops_procure.close_po(text, text, text) from public;
grant execute on function ops_procure.close_po(text, text, text) to authenticated;

-- ── the drawer: 0139's body, with two changes marked 0196 ─────────────────
-- Copied from 0139 rather than rewritten: the close blockers now use the
-- payment tolerance (ACC-005), and five columns are appended (ACC-006/007).
create or replace view ops_procure.v_po_detail as
SELECT po.po_no,
    po.vendor_id,
    v.name AS vendor_name,
    v.pic_name AS vendor_pic,
    COALESCE(v.pic_phone, v.phone) AS vendor_phone,
    po.status,
    po.expected_delivery,
        CASE
            WHEN (po.expected_delivery IS NULL) THEN NULL::integer
            WHEN (po.status = ANY (ARRAY['CLOSED'::ops_procure.po_status_t, 'CANCELLED'::ops_procure.po_status_t])) THEN NULL::integer
            WHEN s.fully_delivered THEN NULL::integer
            WHEN (ops_core.office_day() > po.expected_delivery) THEN (ops_core.office_day() - po.expected_delivery)
            ELSE NULL::integer
        END AS days_late,
    po.revision,
    po.sent_revision,
    po.approval_asked_at,
    asked.full_name AS approval_asked_by_name,
    po.approved_at,
    appr.full_name AS approved_by_name,
    po.approval_note,
    po.note,
    po.created_at,
    po.issued_at,
    iss.full_name AS issued_by_name,
    s.contract_value,
    s.paid_to_date,
    s.outstanding,
    s.value_received,
    s.exposure,
    s.credit,
    s.payment_state,
    s.delivery_state,
    s.dp_percent,
    j.billable_now,
    COALESCE(ln.lines, '[]'::jsonb) AS lines,
    COALESCE(tm.terms, '[]'::jsonb) AS terms,
    COALESCE(tm.payable_now, (0)::numeric) AS payable_now,
    COALESCE(am.amendments, '[]'::jsonb) AS amendments,
    COALESCE(pm.payments, '[]'::jsonb) AS payments,
    COALESCE(dc.documents, '[]'::jsonb) AS documents,
    ( SELECT COALESCE(jsonb_agg(blockers.b), '[]'::jsonb) AS "coalesce"
           FROM ( SELECT 'It is already closed.'::text AS b
                  WHERE (po.status = 'CLOSED'::ops_procure.po_status_t)
                UNION ALL
                 SELECT 'It was never issued — cancel it rather than close it.'::text
                  WHERE (po.status = 'DRAFT'::ops_procure.po_status_t)
                UNION ALL
                 SELECT format('%s of the contract has not been paid.'::text, s.outstanding) AS format
                  WHERE (s.outstanding > ops_core.money_tolerance())
                UNION ALL
                 SELECT 'Not everything ordered has arrived.'::text
                  WHERE (NOT s.fully_delivered)) blockers) AS close_blockers,
    jsonb_build_object('po_id', s.po_id, 'contract_value', s.contract_value, 'paid_to_date', s.paid_to_date, 'outstanding', s.outstanding, 'value_received', s.value_received, 'exposure', s.exposure, 'payment_state', s.payment_state, 'delivery_state', s.delivery_state) AS status_view,
    po.self_confirmed,
    (po.approval_sent_to)::text AS approval_sent_to,
    -- 0196: who closed it, when, why, and whether anything was waived.
    po.closed_at,
    ( SELECT u.full_name FROM ops_core.users u WHERE (u.id = po.closed_by)) AS closed_by_name,
    po.close_reason,
    po.settled_early,
    -- 0196: paid (within the payment tolerance) and fully delivered, and
    -- still open — the order Finance has nothing left to do on but close.
    ((po.status = 'ISSUED'::ops_procure.po_status_t)
      AND (s.outstanding <= ops_core.money_tolerance())
      AND s.fully_delivered) AS ready_to_close
   FROM (((((((((((ops_procure.purchase_orders po
     JOIN ops_procure.vendors v ON ((v.id = po.vendor_id)))
     JOIN ops_procure.v_po_status s ON ((s.po_id = po.id)))
     JOIN ops_procure.v_po_journey j ON ((j.po_id = po.id)))
     LEFT JOIN ops_core.users asked ON ((asked.id = po.approval_asked_by)))
     LEFT JOIN ops_core.users appr ON ((appr.id = po.approved_by)))
     LEFT JOIN ops_core.users iss ON ((iss.id = po.issued_by)))
     LEFT JOIN LATERAL ( SELECT jsonb_agg(jsonb_build_object('po_line_id', d.po_line_id, 'line_no', d.line_no, 'description', d.description, 'qty', d.qty, 'uom', d.uom, 'unit_price', d.unit_price, 'line_total', d.line_total, 'received', d.received, 'reported', d.reported, 'over', d.over, 'condition', d.condition, 'receipts', COALESCE(rc.receipts, '[]'::jsonb), 'pr_line_no', ( SELECT p.line_no_full
                   FROM (ops_procure.po_lines x
                     JOIN ops_procure.pr_lines p ON ((p.id = x.pr_line_id)))
                  WHERE (x.id = d.po_line_id))) ORDER BY d.line_no) AS lines
           FROM (ops_procure.v_po_line_delivery d
             LEFT JOIN LATERAL ( SELECT jsonb_agg(jsonb_build_object('receipt_no', r.receipt_no, 'qty', r.qty_received, 'condition', r.condition, 'at', r.received_at, 'by', COALESCE(rb.full_name, '—'::text), 'qc_by', COALESCE(qb.full_name, '—'::text), 'note', r.note, 'status', r.status, 'photo_attachment_id', ( SELECT k.attachment_id
                           FROM ops_core.attachment_links k
                          WHERE ((k.entity = 'receipt'::ops_core.link_entity_t) AND (k.entity_no = r.receipt_no) AND (k.kind = 'goods_photo'::ops_core.doc_kind_t) AND (k.unlinked_at IS NULL))
                          ORDER BY k.linked_at
                         LIMIT 1), 'delivery_note_attachment_id', ( SELECT k.attachment_id
                           FROM ops_core.attachment_links k
                          WHERE ((k.entity = 'receipt'::ops_core.link_entity_t) AND (k.entity_no = r.receipt_no) AND (k.kind = 'delivery_note'::ops_core.doc_kind_t) AND (k.unlinked_at IS NULL))
                          ORDER BY k.linked_at
                         LIMIT 1)) ORDER BY r.received_at) AS receipts
                   FROM ((ops_procure.receipts r
                     LEFT JOIN ops_core.users rb ON ((rb.id = r.received_by)))
                     LEFT JOIN ops_core.users qb ON ((qb.id = r.qc_by)))
                  WHERE (r.po_line_id = d.po_line_id)) rc ON (true))
          WHERE (d.po_id = po.id)) ln ON (true))
     LEFT JOIN LATERAL ( SELECT jsonb_agg(jsonb_build_object('term_no', t.term_no, 'kind', t.kind, 'basis', t.basis, 'basis_value', t.basis_value, 'due_rule', t.due_rule, 'due_date', t.due_date, 'amount', t.amount, 'covered', t.covered, 'state', t.state, 'blocked_by', t.blocked_by, 'trigger', t.trigger) ORDER BY t.term_no) AS terms,
            sum(GREATEST((t.amount - t.covered), (0)::numeric)) FILTER (WHERE (t.state = ANY (ARRAY['PAYABLE'::ops_procure.po_term_state_t, 'PARTIAL'::ops_procure.po_term_state_t]))) AS payable_now
           FROM ops_procure.v_po_terms t
          WHERE (t.po_id = po.id)) tm ON (true))
     LEFT JOIN LATERAL ( SELECT jsonb_agg(jsonb_build_object('line_no', old.line_no, 'from', ((((old.qty || ' '::text) || old.uom) || ' × '::text) || old.unit_price), 'to',
                CASE
                    WHEN (new_l.id IS NULL) THEN 'removed'::text
                    ELSE ((((new_l.qty || ' '::text) || new_l.uom) || ' × '::text) || new_l.unit_price)
                END, 'at', '') ORDER BY old.line_no DESC) AS amendments
           FROM (ops_procure.po_lines old
             LEFT JOIN ops_procure.po_lines new_l ON ((new_l.id = old.superseded_by)))
          WHERE ((old.po_id = po.id) AND (old.superseded_by IS NOT NULL))) am ON (true))
     LEFT JOIN LATERAL ( SELECT jsonb_agg(jsonb_build_object('trx_no', t.trx_no, 'trx_date', t.trx_date, 'amount', al.amount, 'description', t.description) ORDER BY t.trx_date) AS payments
           FROM (ops_acct.payment_allocations al
             JOIN ops_acct.transactions t ON ((t.id = al.trx_id)))
          WHERE ((al.po_no = po.po_no) AND (al.superseded_by IS NULL) AND (t.status <> 'VOID'::ops_acct.trx_status_t))) pm ON (true))
     LEFT JOIN LATERAL ( SELECT jsonb_agg(jsonb_build_object('attachment_id', a.id, 'filename', a.filename, 'url', a.url, 'kind', k.kind, 'linked_at', k.linked_at) ORDER BY k.linked_at) AS documents
           FROM (ops_core.attachment_links k
             JOIN ops_core.attachments a ON ((a.id = k.attachment_id)))
          WHERE ((k.entity = 'purchase_order'::ops_core.link_entity_t) AND (k.entity_no = po.po_no) AND (k.unlinked_at IS NULL))) dc ON (true));

alter view ops_procure.v_po_detail set (security_invoker = on);
grant select on ops_procure.v_po_detail to authenticated;

-- ── the board carries ready_to_close ─────────────────────────────────────
-- `po.*` expands when the view is created, so the new order columns would land
-- in the middle; `create or replace` cannot move columns. Dropped and
-- recreated — nothing in the ladder depends on it (it is read by the client).
drop view ops_procure.v_po_board;
create view ops_procure.v_po_board as
  select
    po.*,
    v.name as vendor_name,
    case
      when po.expected_delivery is null then null
      when po.status in ('CLOSED','CANCELLED') then null
      when s.fully_delivered then null
      when ops_core.office_day() > po.expected_delivery
        then (ops_core.office_day() - po.expected_delivery)
      else null
    end as days_late,
    jsonb_build_object(
      'po_id',          s.po_id,
      'contract_value', s.contract_value,
      'paid_to_date',   s.paid_to_date,
      'outstanding',    s.outstanding,
      'value_received', s.value_received,
      'exposure',       s.exposure,
      'payment_state',  s.payment_state,
      'delivery_state', s.delivery_state
    ) as status_view,
    coalesce((
      select jsonb_agg(jsonb_build_object(
               'id',            l.id,
               'po_id',         l.po_id,
               'line_no',       l.line_no,
               'item_id',       l.item_id,
               'description',   l.description,
               'qty',           l.qty,
               'uom',           l.uom,
               'unit_price',    l.unit_price,
               'line_total',    l.line_total,
               'superseded_by', l.superseded_by) order by l.line_no)
        from ops_procure.po_lines l
       where l.po_id = po.id and l.superseded_by is null
    ), '[]'::jsonb) as lines,
    -- 0196, ACC-007: the same predicate as v_po_detail.ready_to_close.
    coalesce(po.status = 'ISSUED'
             and s.outstanding <= ops_core.money_tolerance()
             and s.fully_delivered, false) as ready_to_close
  from ops_procure.purchase_orders po
  join ops_procure.vendors v on v.id = po.vendor_id
  left join ops_procure.v_po_status s on s.po_id = po.id;

alter view ops_procure.v_po_board set (security_invoker = on);
grant select on ops_procure.v_po_board to authenticated;

analyze ops_procure.purchase_orders;
