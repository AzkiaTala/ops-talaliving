-- acct/statement continuity (0194) — a statement continues the one before it,
-- or somebody writes down why not.
--
-- The failure this exists for: BCA 064 for 8–21 September uploaded with an
-- opening of Rp 0 after a statement that closed at Rp 508.855.500, and the card
-- said *matches*. Proved here:
--
--   an opening that does not meet the previous closing — refused, then taken
--     with a reason, and the reason is kept
--   a hole between two statements — refused
--   a period that overlaps another — refused, reason or not
--   a back-filled month whose closing does not meet the next opening — refused
--   a statement that does continue — taken, no reason asked for or stored
--   another currency on the same account — a separate chain, not compared
--   the view: continuity_ok, prev_statement_no, prev_closing_balance, gap_days

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('eeee0000-0000-0000-0000-00000000c194','rina@talaliving.com','{"full_name":"Rina Kartika"}');
insert into ops_core.user_modules (user_id, module, level) values
  ('eeee0000-0000-0000-0000-00000000c194','accounting','write');

set local role authenticated;
set local request.jwt.claim.sub = 'eeee0000-0000-0000-0000-00000000c194';

do $$
declare r jsonb; v_first text; v_ok boolean; v_prev text; v_prevbal numeric; v_gap int; v_reason text;
        v_row jsonb := jsonb_build_array(jsonb_build_object(
          'value_date','2026-09-10','direction','IN','amount', 100000,'raw_description','SETORAN'));
begin
  -- The first statement on the account: nothing to continue, so nothing to check.
  r := ops_acct.import_statement('BCA 064','2026-08-25','2026-09-07',
        486400000, 486500000, 'IDR','rk-1.csv',
        jsonb_build_array(jsonb_build_object('value_date','2026-08-30','direction','IN',
                          'amount', 100000,'raw_description','SETORAN')));
  assert r ->> 'outcome' = 'ok', format('the first statement is taken as it is, got %s', r);
  v_first := r #>> '{data,statement_no}';

  -- The QA case: opening Rp 0 after a statement that closed at 486.500.000.
  r := ops_acct.import_statement('BCA 064','2026-09-08','2026-09-21',
        0, 100000, 'IDR','rk-2.csv', v_row);
  assert r #>> '{error,code}' = 'continuity_broken', format('an opening that does not meet the closing before it is refused, got %s', r);
  assert r #>> '{error,detail,problems,0,kind}' = 'opening_differs', format('and it says which way, got %s', r #> '{error,detail}');
  assert (r #>> '{error,detail,problems,0,expected}')::numeric = 486500000, 'and what the opening should have been';
  assert r #>> '{error,message}' like '%' || v_first || '%', 'and names the statement it should continue';

  -- A blank reason is not a reason.
  r := ops_acct.import_statement('BCA 064','2026-09-08','2026-09-21',
        0, 100000, 'IDR','rk-2.csv', v_row, null, null, null, '   ');
  assert r #>> '{error,code}' = 'continuity_broken', 'whitespace does not override the chain';

  -- An overlap is refused whatever the reason.
  r := ops_acct.import_statement('BCA 064','2026-09-01','2026-09-15',
        486500000, 486600000, 'IDR','rk-overlap.csv', v_row, null, null, null, 'bank kirim ulang');
  assert r ->> 'outcome' = 'duplicate' and r #>> '{error,code}' = 'period_overlaps',
         format('a period sharing days with another is refused even with a reason, got %s', r);

  -- A hole: the next statement starting on the 15th leaves 8–14 September nowhere.
  r := ops_acct.import_statement('BCA 064','2026-09-15','2026-09-21',
        486500000, 486600000, 'IDR','rk-hole.csv', v_row);
  assert r #>> '{error,code}' = 'continuity_broken', format('a gap is refused, got %s', r);
  assert r #>> '{error,detail,problems,0,kind}' = 'gap_before', format('and called a gap, got %s', r #> '{error,detail}');

  -- The honest one: it continues, and no reason is asked for or kept.
  r := ops_acct.import_statement('BCA 064','2026-09-08','2026-09-21',
        486500000, 486600000, 'IDR','rk-2.csv', v_row, null, null, null, 'tidak perlu');
  assert r ->> 'outcome' = 'ok', format('a statement that continues is taken, got %s', r);
  select continuity_reason into v_reason from ops_acct.bank_statements
   where statement_no = r #>> '{data,statement_no}';
  assert v_reason is null, 'a reason typed against an intact chain is not stored as an exception';

  select continuity_ok, prev_statement_no, prev_closing_balance, gap_days
    into v_ok, v_prev, v_prevbal, v_gap
    from ops_acct.v_bank_statement where statement_no = r #>> '{data,statement_no}';
  assert v_ok and v_prev = v_first and v_prevbal = 486500000 and v_gap = 0,
         format('the view shows the chain: ok=%s prev=%s bal=%s gap=%s', v_ok, v_prev, v_prevbal, v_gap);

  -- A broken link taken with a reason: kept, and the view still says it is broken.
  r := ops_acct.import_statement('BCA 064','2026-10-01','2026-10-31',
        600000000, 600100000, 'IDR','rk-oct.csv',
        jsonb_build_array(jsonb_build_object('value_date','2026-10-05','direction','IN',
                          'amount', 100000,'raw_description','SETORAN')),
        null, null, null, 'Rekening koran 22–30 Sep belum dikirim bank; saldo dari cetakan buku tabungan.');
  assert r ->> 'outcome' = 'ok', format('a broken chain with a reason is taken, got %s', r);
  assert jsonb_array_length(r #> '{data,continuity_problems}') = 2,
         format('and the answer says what was overridden (gap + opening), got %s', r #> '{data}');
  select continuity_ok, continuity_reason into v_ok, v_reason
    from ops_acct.v_bank_statement where statement_no = r #>> '{data,statement_no}';
  assert not v_ok and v_reason like 'Rekening koran 22%', 'the card keeps saying so, and why';

  -- Back-filling a month before the chain: its closing must meet the next opening.
  r := ops_acct.import_statement('BCA 064','2026-08-01','2026-08-24',
        486000000, 486000001, 'IDR','rk-aug.csv',
        jsonb_build_array(jsonb_build_object('value_date','2026-08-05','direction','IN',
                          'amount', 1,'raw_description','BUNGA')));
  assert r #>> '{error,code}' = 'continuity_broken'
     and r #>> '{error,detail,problems,0,kind}' = 'closing_differs',
         format('a back-filled month that does not meet the next opening is refused, got %s', r);

  -- Another currency on the same account is its own chain.
  r := ops_acct.import_statement('BCA 064','2026-09-08','2026-09-20',
        0, 100000, 'USD','rk-usd.csv', v_row);
  assert r ->> 'outcome' = 'ok', format('a dollar statement does not continue a rupiah one, got %s', r);
end $$;

rollback;
