-- 0194_acct_statement_continuity.sql — a bank statement continues the one
-- before it, or somebody says in writing why it does not.
--
-- ── What was wrong (F-QA, 2026-09-30) ─────────────────────────────────────
--
-- `import_statement` checked one file against itself: opening + the lines =
-- closing. It never looked at the statement next to it. QA uploaded BCA 064 for
-- 8–21 September with an opening of **Rp 0** while the statement before it
-- closed at **Rp 508.855.500**, and the card said *matches*. Nothing was wrong
-- inside the file; the account had quietly lost half a billion rupiah between
-- two statements.
--
-- For the leadership accounts that is not a cosmetic gap. BCA 064 and
-- BCA USD 081 reach the ledger **only** through statements (D180), so a
-- statement chain with a hole in it is a ledger with a hole in it, and the one
-- place anybody would have noticed — the balance — had just been made to agree
-- with the hole.
--
-- The same reading found a second road to the same place: only the *exact*
-- same period was refused. 25 Aug–7 Sep followed by 1–15 Sep went through, and
-- the six days in both are six days of movements that can be booked twice.
--
-- ── The rule ──────────────────────────────────────────────────────────────
--
-- For one account, in one currency, statements that are not ABANDONED form a
-- chain:
--
--   1. **No overlap.** A period that shares any day with another is refused,
--      always — the same reason the exact duplicate is refused (0025).
--   2. **No hole.** A statement starts the day after the one before it ends.
--   3. **Balances meet.** Its opening equals the previous closing, and — when
--      somebody back-fills an older month — its closing equals the next
--      opening.
--
-- 2 and 3 are refused *unless a reason is given* (`p_continuity_reason`), and
-- the reason is kept on the statement and in the audit trail. That is A6 (warn,
-- do not block: a bank can genuinely start a new account, or a month can be
-- missing because the bank never sent it) combined with A12 (a short or broken
-- chain is a named human decision, never a silent tolerance). What is no longer
-- possible is breaking the chain *without noticing*.
--
-- **Equal means equal, to the cent** (`ops_acct.statement_tolerance()`,
-- 0.005). Not `ops_core.money_tolerance()`: that is the *payment coverage*
-- tolerance, Rp 1.000, and 00-context §B gives statement balancing its own —
-- zero. On a dollar statement Rp 1.000 of tolerance would even read as 1.000
-- dollars. (`balance_ok` on the view below still uses the payment tolerance, as
-- it has since 0020; that is recorded as its own finding rather than changed
-- here, so this migration changes one rule.) A different currency on the same
-- account is a different chain: a dollar statement does not continue a rupiah
-- one.

alter table ops_acct.bank_statements
  -- Why this statement is allowed not to continue the one before (or after)
  -- it. Null on every statement that does continue, which is the ordinary case.
  add column continuity_reason text;

create or replace function ops_acct.statement_tolerance()
returns numeric language sql immutable set search_path = pg_temp as $$ select 0.005::numeric $$;
grant execute on function ops_acct.statement_tolerance() to authenticated;

-- The neighbours of a period, for one account and currency. One definition, so
-- the seam that refuses and the view that shows cannot pick different
-- neighbours. ABANDONED statements are not part of the chain: abandoning one is
-- exactly how somebody takes a bad upload back out of it.
create or replace function ops_acct.statement_neighbours(
  p_account_id uuid, p_currency text, p_period_start date, p_period_end date,
  p_exclude uuid default null)
returns table (prev_id uuid, prev_no text, prev_end date, prev_closing numeric,
               next_id uuid, next_no text, next_start date, next_opening numeric)
language sql stable security invoker set search_path = ops_acct, pg_temp as $$
  select p.id, p.statement_no, p.period_end, p.closing_balance,
         n.id, n.statement_no, n.period_start, n.opening_balance
    from (select 1) one
    left join lateral (
      select s.id, s.statement_no, s.period_end, s.closing_balance
        from ops_acct.bank_statements s
       where s.account_id = p_account_id and s.currency = p_currency
         and s.status <> 'ABANDONED' and s.period_end < p_period_start
         and s.id is distinct from p_exclude
       order by s.period_end desc limit 1) p on true
    left join lateral (
      select s.id, s.statement_no, s.period_start, s.opening_balance
        from ops_acct.bank_statements s
       where s.account_id = p_account_id and s.currency = p_currency
         and s.status <> 'ABANDONED' and s.period_start > p_period_end
         and s.id is distinct from p_exclude
       order by s.period_start asc limit 1) n on true
$$;

grant execute on function ops_acct.statement_neighbours(uuid, text, date, date, uuid) to authenticated;

-- ── the seam ──────────────────────────────────────────────────────────────
-- Dropped, not replaced: a new argument under `create or replace` would leave
-- the old signature behind as an overload, which `00_no_overloads` refuses and
-- PostgREST cannot choose between.
drop function ops_acct.import_statement(text, date, date, numeric, numeric, text, text, jsonb, uuid, text, text);

create function ops_acct.import_statement(
  p_account_code text,
  p_period_start date,
  p_period_end date,
  p_opening numeric,
  p_closing numeric,
  p_currency text,
  p_filename text,
  p_rows jsonb,                  -- [{"value_date":…,"direction":"IN","amount":…,"raw_description":…,"balance_after":…}]
  p_attachment_id uuid default null,
  p_note text default null,
  p_key text default null,
  p_continuity_reason text default null)
returns jsonb
language plpgsql security definer set search_path = ops_acct, ops_core, pg_temp as $$
declare v_acc ops_acct.accounts; v_clash text; v_no text; v_id uuid;
        v_cur text; v_n int; v_res jsonb; v_replayed jsonb;
        v_nb record; v_tol numeric := ops_acct.statement_tolerance();
        v_reason text := nullif(btrim(p_continuity_reason), '');
        v_problems jsonb := '[]'::jsonb; v_msgs text[] := '{}';
begin
  v_replayed := ops_core.idem_replay('accounting','import_statement', p_key);
  if v_replayed is not null then return v_replayed; end if;

  if not ops_core.has_permission('accounting.create') then
    return ops_core.refused('accounting','bank_statement', null,'import',
      'permission_required','Importing a statement belongs to Accounting.');
  end if;

  select * into v_acc from ops_acct.accounts where code = p_account_code;
  if not found then
    return ops_core.not_found('accounting','bank_statement', p_account_code,'import',
      format('There is no account %s.', p_account_code));
  end if;

  v_n := coalesce(jsonb_array_length(p_rows), 0);
  if v_n = 0 then
    return ops_core.invalid('accounting','bank_statement', null,'import',
      'no_rows','Tidak ada baris yang terbaca di file itu.',
      jsonb_build_object('field','rows'));
  end if;
  if p_period_end < p_period_start then
    return ops_core.invalid('accounting','bank_statement', null,'import',
      'period_backwards','A statement does not end before it begins.',
      jsonb_build_object('field','period_end'));
  end if;

  v_cur := coalesce(nullif(btrim(p_currency), ''), v_acc.currency);

  select s.statement_no into v_clash
    from ops_acct.bank_statements s
   where s.account_id = v_acc.id
     and s.period_start = p_period_start and s.period_end = p_period_end
     -- An abandoned upload (0195) no longer holds its period: the corrected
     -- file has to be able to take its place.
     and s.status <> 'ABANDONED';
  if v_clash is not null then
    return ops_core.conflict('accounting','bank_statement', v_clash,'import',
      'period_already_uploaded',
      format('%s sudah memuat %s → %s untuk %s.', v_clash, p_period_start, p_period_end, v_acc.code));
  end if;

  -- 1. Overlap. Refused whatever the reason: a day inside two statements is a
  --    day whose movements can be booked twice.
  select s.statement_no into v_clash
    from ops_acct.bank_statements s
   where s.account_id = v_acc.id and s.currency = v_cur and s.status <> 'ABANDONED'
     and s.period_start <= p_period_end and s.period_end >= p_period_start
   order by s.period_start limit 1;
  if v_clash is not null then
    return ops_core.conflict('accounting','bank_statement', v_clash,'import',
      'period_overlaps',
      format('Periode %s → %s bertumpuk dengan %s untuk %s. Satu hari di dua rekening koran bisa terbukukan dua kali.',
             p_period_start, p_period_end, v_clash, v_acc.code),
      jsonb_build_object('field','period_start','statement_no', v_clash));
  end if;

  -- 2 and 3. The chain, on both sides.
  select * into v_nb from ops_acct.statement_neighbours(v_acc.id, v_cur, p_period_start, p_period_end);

  if v_nb.prev_no is not null then
    if abs(p_opening - v_nb.prev_closing) > v_tol then
      v_problems := v_problems || jsonb_build_object('kind','opening_differs',
        'statement_no', v_nb.prev_no, 'expected', v_nb.prev_closing, 'given', p_opening,
        'difference', p_opening - v_nb.prev_closing);
      v_msgs := v_msgs || format('saldo awal %s tidak sama dengan saldo akhir %s (%s)',
        p_opening, v_nb.prev_no, v_nb.prev_closing);
    end if;
    if v_nb.prev_end + 1 < p_period_start then
      v_problems := v_problems || jsonb_build_object('kind','gap_before',
        'statement_no', v_nb.prev_no, 'from', v_nb.prev_end + 1, 'to', p_period_start - 1);
      v_msgs := v_msgs || format('tanggal %s → %s tidak ada di rekening koran mana pun',
        v_nb.prev_end + 1, p_period_start - 1);
    end if;
  end if;

  if v_nb.next_no is not null then
    if abs(p_closing - v_nb.next_opening) > v_tol then
      v_problems := v_problems || jsonb_build_object('kind','closing_differs',
        'statement_no', v_nb.next_no, 'expected', v_nb.next_opening, 'given', p_closing,
        'difference', p_closing - v_nb.next_opening);
      v_msgs := v_msgs || format('saldo akhir %s tidak sama dengan saldo awal %s (%s)',
        p_closing, v_nb.next_no, v_nb.next_opening);
    end if;
    if p_period_end + 1 < v_nb.next_start then
      v_problems := v_problems || jsonb_build_object('kind','gap_after',
        'statement_no', v_nb.next_no, 'from', p_period_end + 1, 'to', v_nb.next_start - 1);
      v_msgs := v_msgs || format('tanggal %s → %s tidak ada di rekening koran mana pun',
        p_period_end + 1, v_nb.next_start - 1);
    end if;
  end if;

  if jsonb_array_length(v_problems) > 0 and v_reason is null then
    return ops_core.invalid('accounting','bank_statement', null,'import',
      'continuity_broken',
      format('Rekening koran %s ini tidak bersambung: %s. Periksa saldo dan periodenya, atau tulis alasannya bila memang begitu.',
             v_acc.code, array_to_string(v_msgs, '; ')),
      jsonb_build_object('field','opening_balance','problems', v_problems));
  end if;

  v_no := ops_core.next_doc_number('rkk');

  insert into ops_acct.bank_statements
    (statement_no, account_id, period_start, period_end, opening_balance, closing_balance,
     currency, filename, status, attachment_id, note, uploaded_by, continuity_reason)
  values (v_no, v_acc.id, p_period_start, p_period_end, p_opening, p_closing,
          v_cur, btrim(p_filename), 'PENDING', p_attachment_id,
          nullif(btrim(p_note), ''), auth.uid(),
          -- Only kept when it was needed: a reason typed against a chain that
          -- was intact would read later as an exception that never happened.
          case when jsonb_array_length(v_problems) > 0 then v_reason end)
  returning id into v_id;

  insert into ops_acct.statement_lines
    (statement_id, line_no, value_date, direction, amount, amount_idr,
     raw_description, balance_after)
  select v_id, ord,
         (r ->> 'value_date')::date,
         (r ->> 'direction')::ops_acct.direction_t,
         (r ->> 'amount')::numeric,
         case when v_cur = 'IDR' then (r ->> 'amount')::numeric else null end,
         r ->> 'raw_description',
         nullif(r ->> 'balance_after','')::numeric
    from jsonb_array_elements(p_rows) with ordinality as t(r, ord);

  perform ops_core.emit('accounting','accounting.statement.imported', v_no,
    jsonb_build_object('statement_no', v_no, 'account', v_acc.code,
                       'rows', v_n, 'period_start', p_period_start, 'period_end', p_period_end,
                       'continuity_override', jsonb_array_length(v_problems) > 0));

  v_res := ops_core.ok('accounting','bank_statement', v_no,'import',
    jsonb_build_object('statement_no', v_no, 'rows', v_n,
                       -- The override is part of the answer, so the audit row
                       -- the envelope writes carries what was overridden and why.
                       'continuity_problems', v_problems,
                       'continuity_reason', case when jsonb_array_length(v_problems) > 0 then v_reason end));
  return ops_core.idem_remember('accounting','import_statement', p_key, v_res);
end $$;

grant execute on function
  ops_acct.import_statement(text, date, date, numeric, numeric, text, text, jsonb, uuid, text, text, text)
  to authenticated;

-- ── the view says it too ──────────────────────────────────────────────────
-- Statements already uploaded before this migration are not re-checked by the
-- seam, so the card has to say it. Columns appended at the end, which is what
-- `create or replace view` allows; the body above them is 0025's, unchanged.
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
         -- The chain. Null when there is no earlier statement to continue.
         nb.prev_no      as prev_statement_no,
         nb.prev_closing as prev_closing_balance,
         case when nb.prev_no is null then null
              else (s.period_start - nb.prev_end) - 1 end as gap_days,
         -- True when the statement continues the one before it (or there is
         -- none). An ABANDONED statement is outside the chain and never flagged.
         s.status = 'ABANDONED' or nb.prev_no is null
           or (abs(s.opening_balance - nb.prev_closing) <= ops_acct.statement_tolerance()
               and nb.prev_end + 1 = s.period_start) as continuity_ok,
         s.continuity_reason
    from ops_acct.bank_statements s
    join ops_acct.accounts a on a.id = s.account_id
    left join ops_core.users u on u.id = s.uploaded_by
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
