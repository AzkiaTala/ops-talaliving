-- 0195_acct_statement_abandon.sql — taking a wrong upload back out.
--
-- Asked for in QA, 2026-09-30: *tambahkan action seperti delete jika nantinya
-- salah memasukkan data*. A statement uploaded against the wrong account, with
-- the wrong balances, or from the wrong file had no way out: it sat in the
-- chain (0194), it held its period so the right file could not be uploaded, and
-- its lines waited to be booked.
--
-- **Abandoned, not deleted** (A2, A5). The statement stays, with who took it
-- out, when and why; it leaves the chain, frees its period, and its lines can
-- no longer be decided. `ABANDONED` has been in `statement_status_t` since 0001
-- for exactly this and nothing ever wrote it.
--
-- **Refused while any line reached the ledger.** A line that was booked made a
-- transaction; a matched one is tied to one. Abandoning the statement under
-- them would leave ledger rows citing a statement that no longer counts. So
-- the refusal names how many, and the way out is the ledger's own: void the
-- transaction (booked) — a matched line points at a row that existed before
-- the statement and stays true either way, but it was decided against *this*
-- file, so it is refused too and the person decides what the tie was worth.
-- Ignored lines are fine: ignoring created nothing.

alter table ops_acct.bank_statements
  add column abandoned_reason text,
  add column abandoned_by     uuid references ops_core.users(id),
  add column abandoned_at     timestamptz,
  -- The three travel together, and only with the status that means them.
  add constraint abandoned_says_why check (
    (status = 'ABANDONED') = (abandoned_at is not null)
    and (abandoned_at is null or (abandoned_reason is not null and abandoned_by is not null)));

create or replace function ops_acct.abandon_statement(
  p_statement_no text, p_reason text, p_key text default null)
returns jsonb
language plpgsql security definer set search_path = ops_acct, ops_core, pg_temp as $$
declare v_s ops_acct.bank_statements; v_decided int; v_res jsonb; v_replayed jsonb;
        v_reason text := nullif(btrim(p_reason), '');
begin
  v_replayed := ops_core.idem_replay('accounting','abandon_statement:' || coalesce(p_statement_no,''), p_key);
  if v_replayed is not null then return v_replayed; end if;

  if not ops_core.has_permission('accounting.update') then
    return ops_core.refused('accounting','bank_statement', p_statement_no,'abandon',
      'permission_required','Me-void rekening koran adalah pekerjaan Accounting.');
  end if;

  select * into v_s from ops_acct.bank_statements where statement_no = p_statement_no for update;
  if not found then
    return ops_core.not_found('accounting','bank_statement', p_statement_no,'abandon',
      format('Tidak ada rekening koran %s.', p_statement_no));
  end if;
  if v_s.status = 'ABANDONED' then
    return ops_core.noop('accounting','bank_statement', p_statement_no,'abandon',
      'already_abandoned', jsonb_build_object('statement_no', p_statement_no));
  end if;
  if v_reason is null then
    return ops_core.invalid('accounting','bank_statement', p_statement_no,'abandon',
      'reason_required','Tulis kenapa rekening koran ini di-void — mis. salah rekening, salah saldo, salah file.',
      jsonb_build_object('field','reason'));
  end if;

  select count(*) into v_decided from ops_acct.statement_lines
   where statement_id = v_s.id and status in ('matched','booked');
  if v_decided > 0 then
    return ops_core.refused('accounting','bank_statement', p_statement_no,'abandon',
      'lines_in_ledger',
      format('%s baris dari %s sudah masuk atau ditautkan ke buku besar. Void dulu transaksi yang dibukukan dari rekening koran ini, baru void rekening koran ini.',
             v_decided, p_statement_no),
      jsonb_build_object('decided_lines', v_decided));
  end if;

  update ops_acct.bank_statements
     set status = 'ABANDONED', abandoned_reason = v_reason,
         abandoned_by = auth.uid(), abandoned_at = now()
   where id = v_s.id;

  perform ops_core.emit('accounting','accounting.statement.abandoned', p_statement_no,
    jsonb_build_object('statement_no', p_statement_no, 'reason', v_reason,
                       'period_start', v_s.period_start, 'period_end', v_s.period_end));

  v_res := ops_core.ok('accounting','bank_statement', p_statement_no,'abandon',
    jsonb_build_object('statement_no', p_statement_no, 'reason', v_reason));
  return ops_core.idem_remember('accounting','abandon_statement:' || p_statement_no, p_key, v_res);
end $$;

revoke execute on function ops_acct.abandon_statement(text, text, text) from public;
grant execute on function ops_acct.abandon_statement(text, text, text) to authenticated;

-- ── an abandoned statement's lines are not anybody's to decide ────────────
-- The four line seams (0025) read the line, not the statement, so this is the
-- one place that catches all of them — and any seam written later. The screen
-- hides the buttons; this is the answer if something calls them anyway.
create or replace function ops_acct.lines_of_live_statement()
returns trigger language plpgsql set search_path = ops_acct, pg_temp as $$
begin
  if exists (select 1 from ops_acct.bank_statements
              where id = new.statement_id and status = 'ABANDONED') then
    raise exception 'statement_abandoned: this line belongs to a statement that was abandoned'
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

create trigger statement_lines_live
  before update on ops_acct.statement_lines
  for each row execute function ops_acct.lines_of_live_statement();

-- ── the period is free again ──────────────────────────────────────────────
-- An abandoned statement no longer holds its period, or the corrected file
-- could never be uploaded — the whole point of abandoning. That exclusion is
-- written into 0194's `import_statement` (`period_already_uploaded` and
-- `period_overlaps` both skip ABANDONED), since both arrived together.

-- ── the view carries it ───────────────────────────────────────────────────
create or replace view ops_acct.v_bank_statement as
  select s.id, s.statement_no, s.account_id, a.code as account_code, a.name as account_name,
         s.period_start, s.period_end, s.opening_balance, s.closing_balance,
         s.currency, s.filename, s.status, s.attachment_id, s.note,
         s.uploaded_by, u.full_name as uploaded_by_name, s.uploaded_at,
         coalesce(l.movement, 0) as movement,
         s.opening_balance + coalesce(l.movement, 0) as computed_closing,
         abs(s.opening_balance + coalesce(l.movement, 0) - s.closing_balance)
           <= ops_core.money_tolerance() as balance_ok,
         coalesce(l.unmatched, 0) as unmatched,
         coalesce(l.matched, 0)   as matched,
         coalesce(l.booked, 0)    as booked,
         coalesce(l.ignored, 0)   as ignored,
         coalesce(l.awaiting_rate, 0) as awaiting_rate,
         nb.prev_no      as prev_statement_no,
         nb.prev_closing as prev_closing_balance,
         case when nb.prev_no is null then null
              else (s.period_start - nb.prev_end) - 1 end as gap_days,
         s.status = 'ABANDONED' or nb.prev_no is null
           or (abs(s.opening_balance - nb.prev_closing) <= ops_acct.statement_tolerance()
               and nb.prev_end + 1 = s.period_start) as continuity_ok,
         s.continuity_reason,
         s.abandoned_reason,
         s.abandoned_at,
         s.abandoned_by,
         ab.full_name as abandoned_by_name
    from ops_acct.bank_statements s
    join ops_acct.accounts a on a.id = s.account_id
    left join ops_core.users u  on u.id = s.uploaded_by
    left join ops_core.users ab on ab.id = s.abandoned_by
    left join lateral (
      select sum(case when direction = 'IN' then amount else -amount end) as movement,
             count(*) filter (where status = 'unmatched') as unmatched,
             count(*) filter (where status = 'matched')   as matched,
             count(*) filter (where status = 'booked')    as booked,
             count(*) filter (where status = 'ignored')   as ignored,
             count(*) filter (where amount_idr is null and status <> 'ignored')
               as awaiting_rate
        from ops_acct.statement_lines where statement_id = s.id
    ) l on true
    left join lateral ops_acct.statement_neighbours(
      s.account_id, s.currency, s.period_start, s.period_end, s.id) nb on true;

alter view ops_acct.v_bank_statement set (security_invoker = on);
grant select on ops_acct.v_bank_statement to authenticated;

analyze ops_acct.bank_statements;
