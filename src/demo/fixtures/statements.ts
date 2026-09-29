import type { BankStatement, StatementLine } from "@/services/accounting/contracts";

/** Two rekening koran, and every situation a reconciliation actually meets
 *  (D180).
 *
 *  **BCA 064** — the leadership rupiah account. Most of its lines already have
 *  a ledger row, because somebody typed the transfers as they made them; two
 *  do not, and those are the ones the statement exists to catch. One is a bank
 *  charge nobody would ever have entered by hand.
 *
 *  **BCA USD 081** — three lines in dollars and **no rate on any of them**.
 *  Nothing can reach the ledger until a person types what the bank actually
 *  gave them that day (D181). The screen says so rather than converting at a
 *  rate the system invented.
 */
export const BANK_STATEMENTS: BankStatement[] = [
  {
    id: "bst_01", statement_no: "rkk-26-09-08_01", account_id: "acc_bca064",
    period_start: "2026-08-25", period_end: "2026-09-07",
    opening_balance: 486_400_000, closing_balance: 508_855_500,
    currency: "IDR",
    filename: "BCA-064_25Agu-07Sep.csv",
    status: "PENDING", attachment_id: null,
    note: "Diserahkan pimpinan lewat WhatsApp, dua mingguan.",
    uploaded_by: "usr_anggun", uploaded_at: "2026-09-08T09:20:00+07:00",
  },
  {
    id: "bst_02", statement_no: "rkk-26-09-08_02", account_id: "acc_bcausd",
    period_start: "2026-08-01", period_end: "2026-08-31",
    opening_balance: 18_400, closing_balance: 12_150,
    currency: "USD",
    filename: "BCA-USD-081_Agustus.csv",
    status: "PENDING", attachment_id: null,
    note: "Rekening dolar — kurs hari transaksi belum diisi.",
    uploaded_by: "usr_anggun", uploaded_at: "2026-09-08T09:35:00+07:00",
  },
];

type Seed = [
  no: number, date: string, dir: "IN" | "OUT", amount: number,
  idr: number | null, rate: number | null, desc: string,
  balance: number | null, status: StatementLine["status"], trx: string | null, note: string | null,
];

const IDR_LINES: Seed[] = [
  /* Already in the ledger — the reconciliation finds these and ties them. */
  [1, "2026-08-27", "OUT", 60_000_000, 60_000_000, null, "TRSF E-BANKING CR 2708 BNI 325 PAYROLL", 426_400_000, "unmatched", null, null],
  [2, "2026-08-29", "OUT", 12_100_000, 12_100_000, null, "TRSF E-BANKING CR 2908 BCA 271 ROUND", 414_300_000, "unmatched", null, null],
  [3, "2026-09-01", "IN", 185_000_000, 185_000_000, null, "SETORAN TUNAI 0109", 599_300_000, "unmatched", null, null],
  [4, "2026-09-03", "OUT", 70_000_000, 70_000_000, null, "TRSF E-BANKING CR 0309 BNI 325 PAYROLL", 529_300_000, "unmatched", null, null],
  /* Not in the ledger, and nobody would have typed it: the bank's own charge. */
  [5, "2026-09-04", "OUT", 44_500, 44_500, null, "BIAYA ADM", 529_255_500, "unmatched", null, null],
  /* Not in the ledger either — leadership paid a supplier straight from 064,
     which is exactly the movement nobody in the office could see. */
  [6, "2026-09-05", "OUT", 20_400_000, 20_400_000, null, "TRSF E-BANKING CR 0509 CV SUMBER KAYU JATI", 508_855_500, "unmatched", null, null],
];

const USD_LINES: Seed[] = [
  [1, "2026-08-06", "OUT", 4_250, null, null, "OUTGOING TT SHENZHEN HARDWARE CO", 14_150, "unmatched", null, null],
  [2, "2026-08-19", "OUT", 1_800, null, null, "OUTGOING TT GUANGZHOU FITTINGS", 12_350, "unmatched", null, null],
  [3, "2026-08-28", "OUT", 200, null, null, "TT CHARGES", 12_150, "unmatched", null, null],
];

function build(statementId: string, seeds: Seed[], offset: number): StatementLine[] {
  return seeds.map(([line_no, value_date, direction, amount, amount_idr, fx_rate, raw_description, balance_after, status, trx_no, note], i) => ({
    id: `stl_${String(offset + i + 1).padStart(3, "0")}`,
    statement_id: statementId,
    line_no, value_date, direction, amount, amount_idr, fx_rate,
    raw_description, balance_after, status, trx_no, note,
    decided_by: null, decided_at: null,
  }));
}

export const STATEMENT_LINES: StatementLine[] = [
  ...build("bst_01", IDR_LINES, 0),
  ...build("bst_02", USD_LINES, IDR_LINES.length),
];
