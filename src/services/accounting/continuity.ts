/** Whether a bank statement continues the one before it (0194).
 *
 *  Stated once for the two places that ask in TypeScript — the demo seam that
 *  refuses, and the upload form that warns before anybody presses the button —
 *  so they cannot disagree. The database states the same rule in
 *  `ops_acct.import_statement` and `v_bank_statement`; the smoke file
 *  `194_acct_statement_continuity.sql` is the battery both halves answer to.
 *
 *  For one account, in one currency, statements that are not ABANDONED form a
 *  chain: no day in two statements, no day in none, and each opening equals the
 *  closing before it. Overlap is always refused. A hole or a balance that does
 *  not meet is refused unless somebody writes down why (A6 + A12).
 */

/** Equal to the cent. Not the Rp 1.000 payment tolerance: statement balancing
 *  has its own, zero (00-context §B), and on a dollar statement Rp 1.000 would
 *  read as a thousand dollars. */
export const STATEMENT_TOLERANCE = 0.005;

export interface ChainStatement {
  id: string;
  statement_no: string;
  account_id: string;
  currency: string;
  status: string;
  period_start: string;
  period_end: string;
  opening_balance: number;
  closing_balance: number;
}

export type ContinuityProblem =
  | { kind: "opening_differs" | "closing_differs"; statement_no: string; expected: number; given: number; difference: number }
  | { kind: "gap_before" | "gap_after"; statement_no: string; from: string; to: string };

/** `YYYY-MM-DD` plus whole days, in UTC so no timezone moves the date. */
export function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

function chainOf(list: readonly ChainStatement[], account_id: string, currency: string, exclude?: string) {
  return list.filter((s) => s.account_id === account_id && s.currency === currency
    && s.status !== "ABANDONED" && s.id !== exclude);
}

/** The statement just before a period and the one just after it. */
export function neighbours(
  list: readonly ChainStatement[],
  p: { account_id: string; currency: string; period_start: string; period_end: string; exclude?: string },
): { prev: ChainStatement | null; next: ChainStatement | null } {
  const chain = chainOf(list, p.account_id, p.currency, p.exclude);
  const prev = chain.filter((s) => s.period_end < p.period_start)
    .sort((a, b) => b.period_end.localeCompare(a.period_end))[0] ?? null;
  const next = chain.filter((s) => s.period_start > p.period_end)
    .sort((a, b) => a.period_start.localeCompare(b.period_start))[0] ?? null;
  return { prev, next };
}

/** A statement sharing any day with the period — refused whatever the reason. */
export function overlapping(
  list: readonly ChainStatement[],
  p: { account_id: string; currency: string; period_start: string; period_end: string },
): ChainStatement | null {
  return chainOf(list, p.account_id, p.currency)
    .filter((s) => s.period_start <= p.period_end && s.period_end >= p.period_start)
    .sort((a, b) => a.period_start.localeCompare(b.period_start))[0] ?? null;
}

/** Every way the period fails to continue its neighbours. Empty = it continues. */
export function continuityProblems(
  list: readonly ChainStatement[],
  p: { account_id: string; currency: string; period_start: string; period_end: string; opening: number; closing: number },
): ContinuityProblem[] {
  const { prev, next } = neighbours(list, p);
  const out: ContinuityProblem[] = [];
  if (prev) {
    if (Math.abs(p.opening - prev.closing_balance) > STATEMENT_TOLERANCE) {
      out.push({ kind: "opening_differs", statement_no: prev.statement_no, expected: prev.closing_balance, given: p.opening, difference: p.opening - prev.closing_balance });
    }
    if (addDays(prev.period_end, 1) < p.period_start) {
      out.push({ kind: "gap_before", statement_no: prev.statement_no, from: addDays(prev.period_end, 1), to: addDays(p.period_start, -1) });
    }
  }
  if (next) {
    if (Math.abs(p.closing - next.opening_balance) > STATEMENT_TOLERANCE) {
      out.push({ kind: "closing_differs", statement_no: next.statement_no, expected: next.opening_balance, given: p.closing, difference: p.closing - next.opening_balance });
    }
    if (addDays(p.period_end, 1) < next.period_start) {
      out.push({ kind: "gap_after", statement_no: next.statement_no, from: addDays(p.period_end, 1), to: addDays(next.period_start, -1) });
    }
  }
  return out;
}

/** One problem, as the person reads it. Indonesian, like the seam's message. */
export function describeProblem(p: ContinuityProblem, fmt: (n: number) => string): string {
  switch (p.kind) {
    case "opening_differs":
      return `saldo awal ${fmt(p.given)} tidak sama dengan saldo akhir ${p.statement_no} (${fmt(p.expected)})`;
    case "closing_differs":
      return `saldo akhir ${fmt(p.given)} tidak sama dengan saldo awal ${p.statement_no} (${fmt(p.expected)})`;
    case "gap_before":
    case "gap_after":
      return `tanggal ${p.from} → ${p.to} tidak ada di rekening koran mana pun`;
  }
}
