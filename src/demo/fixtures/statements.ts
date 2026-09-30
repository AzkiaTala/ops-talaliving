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
    continuity_reason: null,
    abandoned_reason: null, abandoned_at: null, abandoned_by: null,
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
    continuity_reason: null,
    abandoned_reason: null, abandoned_at: null, abandoned_by: null,
  },
  /* **BNI 325** — the operations account, two statements that form a chain
     (0194): September opens at exactly what August closed. August is already
     reconciled against the ledger, so it also shows the other rule — a
     statement with lines in the ledger cannot be deleted (0195). September is
     still undecided, for somebody to match. */
  {
    /* The first half of August: closes at exactly the 45.000.000 the second
       half opens with, so BNI 325 is a chain of three. Undecided, and nothing
       of it is in the ledger yet — the one of the three that can be deleted. */
    id: "bst_05", statement_no: "rkk-26-08-16_01", account_id: "acc_bni325",
    period_start: "2026-08-01", period_end: "2026-08-15",
    opening_balance: 53_711_650, closing_balance: 45_000_000,
    currency: "IDR",
    filename: "BNI-325_01-15Agu.csv",
    status: "PENDING", attachment_id: null,
    note: "Mutasi BNI Direct, paruh pertama Agustus.",
    uploaded_by: "usr_anggun", uploaded_at: "2026-08-16T09:15:00+07:00",
    continuity_reason: null,
    abandoned_reason: null, abandoned_at: null, abandoned_by: null,
  },
  {
    id: "bst_03", statement_no: "rkk-26-09-01_01", account_id: "acc_bni325",
    period_start: "2026-08-16", period_end: "2026-08-31",
    opening_balance: 45_000_000, closing_balance: 70_273_500,
    currency: "IDR",
    filename: "BNI-325_16-31Agu.csv",
    status: "PENDING", attachment_id: null,
    note: "Mutasi BNI Direct, paruh kedua Agustus.",
    uploaded_by: "usr_anggun", uploaded_at: "2026-09-01T10:05:00+07:00",
    continuity_reason: null,
    abandoned_reason: null, abandoned_at: null, abandoned_by: null,
  },
  {
    id: "bst_04", statement_no: "rkk-26-09-16_01", account_id: "acc_bni325",
    period_start: "2026-09-01", period_end: "2026-09-15",
    opening_balance: 70_273_500, closing_balance: 70_839_261,
    currency: "IDR",
    filename: "BNI-325_01-15Sep.csv",
    status: "PENDING", attachment_id: null,
    note: "Mutasi BNI Direct, paruh pertama September.",
    uploaded_by: "usr_anggun", uploaded_at: "2026-09-16T09:40:00+07:00",
    continuity_reason: null,
    abandoned_reason: null, abandoned_at: null, abandoned_by: null,
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

const BNI_EARLY_AUG_LINES: Seed[] = [
  [1, "2026-08-03", "IN", 20_000_000, 20_000_000, null, "TRF DARI BCA 064 TOP UP OPERASIONAL", 73_711_650, "unmatched", null, null],
  [2, "2026-08-07", "OUT", 12_600_000, 12_600_000, null, "PAYROLL MINGGU 32", 61_111_650, "unmatched", null, null],
  [3, "2026-08-10", "OUT", 840_000, 840_000, null, "TELKOM INDIHOME WORKSHOP", 60_271_650, "unmatched", null, null],
  [4, "2026-08-12", "OUT", 2_375_000, 2_375_000, null, "TRF KE UD BAUT JAYA - BAUT DAN ENGSEL", 57_896_650, "unmatched", null, null],
  [5, "2026-08-14", "OUT", 12_900_000, 12_900_000, null, "PAYROLL MINGGU 33", 44_996_650, "unmatched", null, null],
  [6, "2026-08-15", "IN", 9_850, 9_850, null, "JASA GIRO", 45_006_500, "unmatched", null, null],
  [7, "2026-08-15", "OUT", 6_500, 6_500, null, "BIAYA ADM", 45_000_000, "unmatched", null, null],
];

const BNI_AUG_LINES: Seed[] = [
  [1, "2026-08-24", "OUT", 4_180_000, 4_180_000, null, "PLN WORKSHOP AGUSTUS", 40_820_000, "matched", "trx-26-08-24_001", null],
  [2, "2026-08-25", "OUT", 1_250_000, 1_250_000, null, "TRF KE CV MESIN JAYA SERVIS SERUT", 39_570_000, "matched", "trx-26-08-25_001", null],
  [3, "2026-08-27", "IN", 60_000_000, 60_000_000, null, "TRF DARI BCA 064 TOP UP PAYROLL", 99_570_000, "matched", "trx-26-08-27_001", null],
  [4, "2026-08-28", "OUT", 28_400_000, 28_400_000, null, "PAYROLL MINGGU 35", 71_170_000, "matched", "trx-26-08-28_001", null],
  /* The bank's own charge: nobody typed it, so it waits to be booked. */
  [5, "2026-08-30", "OUT", 6_500, 6_500, null, "BIAYA ADM", 71_163_500, "unmatched", null, null],
  [6, "2026-08-31", "OUT", 890_000, 890_000, null, "TRF KE TOKO ATK SEJAHTERA", 70_273_500, "matched", "trx-26-08-31_001", null],
];

const BNI_SEP_LINES: Seed[] = [
  [1, "2026-09-03", "OUT", 1_450_000, 1_450_000, null, "TOKOPEDIA OLI KOMPRESOR", 68_823_500, "unmatched", null, null],
  [2, "2026-09-03", "IN", 70_000_000, 70_000_000, null, "TRF DARI BCA 064 TOP UP PAYROLL", 138_823_500, "unmatched", null, null],
  [3, "2026-09-04", "OUT", 29_800_000, 29_800_000, null, "PAYROLL MINGGU 36", 109_023_500, "unmatched", null, null],
  [4, "2026-09-08", "OUT", 2_150_000, 2_150_000, null, "TAGIHAN KARTU KREDIT MANDIRI AGUSTUS", 106_873_500, "unmatched", null, null],
  [5, "2026-09-09", "OUT", 31_200_000, 31_200_000, null, "PAYROLL MINGGU 37", 75_673_500, "unmatched", null, null],
  [6, "2026-09-10", "OUT", 1_525_000, 1_525_000, null, "BPJS KESEHATAN SEPTEMBER", 74_148_500, "unmatched", null, null],
  [7, "2026-09-10", "OUT", 3_310_689, 3_310_689, null, "BPJS KETENAGAKERJAAN SEPTEMBER", 70_837_811, "unmatched", null, null],
  /* Interest and the admin fee: in no ledger row until somebody books them. */
  [8, "2026-09-15", "IN", 12_450, 12_450, null, "JASA GIRO", 70_850_261, "unmatched", null, null],
  [9, "2026-09-15", "OUT", 11_000, 11_000, null, "BIAYA ADM", 70_839_261, "unmatched", null, null],
];

function build(statementId: string, seeds: Seed[], offset: number): StatementLine[] {
  return seeds.map(([line_no, value_date, direction, amount, amount_idr, fx_rate, raw_description, balance_after, status, trx_no, note], i) => ({
    id: `stl_${String(offset + i + 1).padStart(3, "0")}`,
    statement_id: statementId,
    line_no, value_date, direction, amount, amount_idr, fx_rate,
    raw_description, balance_after, status, trx_no, note,
    /* A decided line says who decided it and when, as the table requires. */
    decided_by: status === "unmatched" ? null : "usr_anggun",
    decided_at: status === "unmatched" ? null : "2026-09-01T10:20:00+07:00",
  }));
}

export const STATEMENT_LINES: StatementLine[] = [
  ...build("bst_01", IDR_LINES, 0),
  ...build("bst_02", USD_LINES, IDR_LINES.length),
  ...build("bst_03", BNI_AUG_LINES, IDR_LINES.length + USD_LINES.length),
  ...build("bst_04", BNI_SEP_LINES, IDR_LINES.length + USD_LINES.length + BNI_AUG_LINES.length),
  ...build("bst_05", BNI_EARLY_AUG_LINES,
    IDR_LINES.length + USD_LINES.length + BNI_AUG_LINES.length + BNI_SEP_LINES.length),
];
