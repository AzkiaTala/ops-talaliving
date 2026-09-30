-- acct/statement abandon (0195) — a wrong upload taken back out, never deleted.
--
--   no reason — refused
--   a line already booked or matched — refused, and says how many
--   abandoned — the row stays, with who/when/why; the view carries it
--   twice — a noop, not an error
--   the period is free: the corrected file uploads over the same dates
--   an abandoned statement is out of the chain: the next one continues the
--     corrected one, not the abandoned one
--   its lines cannot be decided any more

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('eeee0000-0000-0000-0000-00000000c195','rina@talaliving.com','{"full_name":"Rina Kartika"}');
insert into ops_core.user_modules (user_id, module, level) values
  ('eeee0000-0000-0000-0000-00000000c195','accounting','write');

set local role authenticated;
set local request.jwt.claim.sub = 'eeee0000-0000-0000-0000-00000000c195';

do $$
declare r jsonb; v_wrong text; v_right text; v_status text; v_reason text; v_by text; v_line uuid;
        v_row jsonb := jsonb_build_array(jsonb_build_object(
          'value_date','2026-09-10','direction','IN','amount', 100000,'raw_description','SETORAN'));
begin
  r := ops_acct.import_statement('BCA 064','2026-09-01','2026-09-30',
        0, 100000, 'IDR','salah-saldo.csv', v_row);
  assert r ->> 'outcome' = 'ok', format('first upload, got %s', r);
  v_wrong := r #>> '{data,statement_no}';

  r := ops_acct.abandon_statement(v_wrong, '   ');
  assert r #>> '{error,code}' = 'reason_required', format('no reason, no abandon — got %s', r);

  r := ops_acct.abandon_statement(v_wrong, 'Salah saldo awal; diunggah ulang.');
  assert r ->> 'outcome' = 'ok', format('abandoning works, got %s', r);

  select status::text, abandoned_reason, abandoned_by_name into v_status, v_reason, v_by
    from ops_acct.v_bank_statement where statement_no = v_wrong;
  assert v_status = 'ABANDONED' and v_reason like 'Salah saldo%' and v_by = 'Rina Kartika',
         format('the row stays with who and why: %s / %s / %s', v_status, v_reason, v_by);

  r := ops_acct.abandon_statement(v_wrong, 'lagi');
  assert r ->> 'outcome' = 'noop', format('twice is a noop, got %s', r);

  -- Its lines are nobody's to decide now.
  select id into v_line from ops_acct.statement_lines sl
    join ops_acct.bank_statements s on s.id = sl.statement_id where s.statement_no = v_wrong;
  begin
    r := ops_acct.ignore_statement_line(v_line, 'coba');
    assert false, format('a line of an abandoned statement cannot be decided, got %s', r);
  exception when check_violation then null;
  end;

  -- The period is free, and the corrected file is the first of the chain.
  r := ops_acct.import_statement('BCA 064','2026-09-01','2026-09-30',
        500000000, 500100000, 'IDR','benar.csv', v_row);
  assert r ->> 'outcome' = 'ok', format('the corrected file takes the same dates, got %s', r);
  v_right := r #>> '{data,statement_no}';

  -- The next month continues the corrected one, not the abandoned one.
  r := ops_acct.import_statement('BCA 064','2026-10-01','2026-10-31',
        500100000, 500200000, 'IDR','okt.csv',
        jsonb_build_array(jsonb_build_object('value_date','2026-10-10','direction','IN',
                          'amount', 100000,'raw_description','SETORAN')));
  assert r ->> 'outcome' = 'ok', format('October continues %s, got %s', v_right, r);

  -- A statement with a line in the ledger cannot be abandoned. The line is
  -- marked matched directly (as the table owner) — how it got there is
  -- 09_acct_statement's business, not this file's.
  execute 'reset role';
  update ops_acct.statement_lines set status = 'matched'
   where statement_id = (select id from ops_acct.bank_statements where statement_no = r #>> '{data,statement_no}');
  execute 'set local role authenticated';
  r := ops_acct.abandon_statement(r #>> '{data,statement_no}', 'salah');
  assert r #>> '{error,code}' = 'lines_in_ledger'
     and (r #>> '{error,detail,decided_lines}')::int = 1,
         format('a line in the ledger holds the statement, got %s', r);
end $$;

rollback;
