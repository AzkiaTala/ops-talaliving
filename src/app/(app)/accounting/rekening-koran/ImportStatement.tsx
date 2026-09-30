"use client";

import { useEffect, useMemo, useState } from "react";
import { Upload, FileSpreadsheet, AlertTriangle, Link2 } from "lucide-react";
import { Modal } from "@/components/ui/drawer";
import { Button } from "@/components/ui/primitives";
import { MoneyInput } from "@/components/ui/money-input";
import { Loaded, useLoad } from "@/components/ui/loaded";
import { formatNumber } from "@/lib/format";
import { accounting } from "@/demo/api";
import { parseCsv } from "@/lib/csv";
import type { Direction } from "@/services/accounting/contracts";
import { continuityProblems, describeProblem, overlapping, type ChainStatement } from "@/services/accounting/continuity";
import { useToast } from "@/store/toast";
import { useTr } from "@/lib/i18n";

/** Reading a bank's own export.
 *
 *  BCA writes *Tanggal · Keterangan · Cabang · Jumlah · Saldo*, with the
 *  direction hidden in the amount as a trailing `DB` or `CR`. Other banks write
 *  separate debit and credit columns. Both are read here, and anything that is
 *  neither is reported as unreadable rather than guessed at (D180).
 *
 *  The two balances are **typed, not parsed**: they are printed on the
 *  statement header, and asking for them is what lets the system check its own
 *  reading of the file afterwards (D182). A file whose lines do not add up to
 *  the balance the bank printed is a file with pages missing, and that has to
 *  be known before anything is booked from it.
 */
type Row = { value_date: string; direction: Direction; amount: number; raw_description: string; balance_after: number | null };

/** `08/09/2026`, `2026-09-08`, `08-09-26` — all of them, into an office date. */
function parseDate(raw: string): string | null {
  const s = raw.trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (m) {
    const y = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${y}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  }
  return null;
}

/** `60,000,000.00 DB`, `1.234.567`, `(4.250)` — numbers as banks print them. */
function parseAmount(raw: string): { amount: number; direction: Direction | null } {
  const s = (raw ?? "").trim().toUpperCase();
  if (!s) return { amount: 0, direction: null };
  const direction: Direction | null = /\bDB\b|\bD\b|\(.*\)/.test(s) ? "OUT" : /\bCR\b|\bK\b/.test(s) ? "IN" : null;
  /* Strip everything that is not a digit or separator, then work out which
     separator is the decimal one: Indonesian statements use `.` for thousands,
     exports from a spreadsheet often use `,`. */
  const cleaned = s.replace(/[^\d.,]/g, "");
  if (!cleaned) return { amount: 0, direction };
  const lastDot = cleaned.lastIndexOf(".");
  const lastComma = cleaned.lastIndexOf(",");
  let normalised = cleaned;
  if (lastDot > lastComma) normalised = cleaned.replace(/,/g, "");
  else if (lastComma > lastDot) normalised = cleaned.replace(/\./g, "").replace(",", ".");
  return { amount: Number(normalised) || 0, direction };
}

function parseStatement(text: string): { rows: Row[]; skipped: number } {
  const lines = parseCsv(text);
  if (lines.length === 0) return { rows: [], skipped: 0 };

  const headerAt = lines.findIndex((c) => c.some((x) => /tanggal|date/i.test(x)));
  if (headerAt === -1) return { rows: [], skipped: lines.length };
  const header = lines[headerAt].map((h) => h.trim().toLowerCase());
  const col = (...names: RegExp[]) => header.findIndex((h) => names.some((r) => r.test(h)));

  const iDate = col(/tanggal/, /date/);
  const iDesc = col(/keterangan/, /descript/, /uraian/);
  const iAmount = col(/jumlah/, /mutasi/, /amount/);
  const iDebit = col(/debit/, /keluar/);
  const iCredit = col(/kredit/, /credit/, /masuk/);
  const iBalance = col(/saldo/, /balance/);

  const rows: Row[] = [];
  let skipped = 0;
  for (const c of lines.slice(headerAt + 1)) {
    const date = iDate >= 0 ? parseDate(c[iDate] ?? "") : null;
    if (!date) { skipped += 1; continue; }

    let amount = 0;
    let direction: Direction | null = null;
    if (iAmount >= 0) {
      const parsed = parseAmount(c[iAmount] ?? "");
      amount = parsed.amount;
      direction = parsed.direction;
    }
    if (!amount && iDebit >= 0) {
      const d = parseAmount(c[iDebit] ?? "");
      if (d.amount) { amount = d.amount; direction = "OUT"; }
    }
    if (!amount && iCredit >= 0) {
      const k = parseAmount(c[iCredit] ?? "");
      if (k.amount) { amount = k.amount; direction = "IN"; }
    }
    /* A row with a date and no readable amount is not a movement — it is a
       heading, a carried-forward line, or a footer. Counted, never invented. */
    if (!amount || !direction) { skipped += 1; continue; }

    rows.push({
      value_date: date,
      direction,
      amount,
      raw_description: (iDesc >= 0 ? c[iDesc] : "")?.trim() || "—",
      balance_after: iBalance >= 0 ? (parseAmount(c[iBalance] ?? "").amount || null) : null,
    });
  }
  return { rows, skipped };
}

export function ImportStatement({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const tr = useTr();
  const { toast } = useToast();
  const [accounts] = useLoad(() => accounting.listAccounts(), []);
  const [file, setFile] = useState<{ name: string; rows: Row[]; skipped: number } | null>(null);
  const [statements] = useLoad(() => accounting.listStatements(), []);
  const [form, setForm] = useState({ account_code: "BCA 064", opening: 0, closing: 0, note: "", reason: "" });
  const [busy, setBusy] = useState(false);

  /* The chain this upload has to continue (0194). Statements are matched by
     account code on both sides, so `account_id` here is the code. */
  const currency = (accounts.status === "ready"
    ? accounts.data.find((a) => a.code === form.account_code)?.currency : undefined) ?? "IDR";
  const chain: ChainStatement[] = useMemo(() => statements.status === "ready"
    ? statements.data.map((s) => ({ ...s, account_id: s.account_code }))
    : [], [statements]);
  const latest = chain
    .filter((s) => s.account_id === form.account_code && s.currency === currency && s.status !== "ABANDONED")
    .sort((a, b) => b.period_end.localeCompare(a.period_end))[0] ?? null;

  /* An account starts from where its last statement closed. The number follows
     the account while it is still the one the form put there; once somebody
     types their own, it is theirs and is never overwritten. QA 2026-09-30: the
     form opened on BCA 064, filled in 064's closing, and kept it after the
     account was switched to BNI 325 — another account's balance, presented as
     this one's opening. */
  const [openingAuto, setOpeningAuto] = useState(true);
  const latestNo = latest?.statement_no ?? null;
  useEffect(() => {
    if (openingAuto || form.opening === 0) {
      setForm((f) => ({ ...f, opening: latest?.closing_balance ?? 0 }));
      setOpeningAuto(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latestNo, form.account_code]);

  async function read(f: File) {
    const { rows, skipped } = parseStatement(await f.text());
    setFile({ name: f.name, rows, skipped });
    if (rows.length === 0) {
      toast("warning", tr("Not readable", "Tidak terbaca"), tr("There is no dated row with an amount in that file.", "Tidak ada baris bertanggal dengan jumlah di file itu."));
    }
  }

  const movement = file?.rows.reduce((s, r) => s + (r.direction === "IN" ? r.amount : -r.amount), 0) ?? 0;
  const computed = form.opening + movement;
  const balanced = file != null && Math.abs(computed - form.closing) < 0.01;

  const dates = file?.rows.map((r) => r.value_date).sort() ?? [];
  const period = dates.length > 0
    ? { account_id: form.account_code, currency, period_start: dates[0], period_end: dates[dates.length - 1] }
    : null;
  const overlap = period ? overlapping(chain, period) : null;
  const problems = period ? continuityProblems(chain, { ...period, opening: form.opening, closing: form.closing }) : [];
  const needsReason = problems.length > 0 && form.reason.trim() === "";

  async function run() {
    if (!file || file.rows.length === 0) return;
    const account = accounts.status === "ready"
      ? accounts.data.find((a) => a.code === form.account_code)
      : undefined;

    setBusy(true);
    const res = await accounting.importStatement({
      account_code: form.account_code,
      period_start: dates[0], period_end: dates[dates.length - 1],
      opening_balance: form.opening, closing_balance: form.closing,
      currency: account?.currency ?? "IDR",
      filename: file.name,
      note: form.note || null,
      continuity_reason: problems.length > 0 ? form.reason.trim() : null,
      rows: file.rows,
    });
    setBusy(false);
    if (res.error) {
      toast(res.error.status === 409 ? "warning" : "critical", tr("Not imported", "Tidak masuk"), res.error.message);
      return;
    }
    toast(
      res.data.balance_ok ? "success" : "warning",
      tr(`${res.data.statement_no} imported`, `${res.data.statement_no} masuk`),
      res.data.balance_ok
        ? tr(`${res.data.lines.length} row(s), the balance matches.`, `${res.data.lines.length} baris, saldo cocok.`)
        : tr(`${res.data.lines.length} row(s) — but the balance does not match; the file is incomplete.`, `${res.data.lines.length} baris — tapi saldo tidak cocok, filenya belum utuh.`),
    );
    onDone();
  }

  return (
    <Modal
      open onClose={onClose} width="max-w-xl"
      title={tr("Upload a bank statement", "Upload rekening koran")}
      footer={
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] text-slate-500">{tr("A statement continues the one before it: no overlap, no missing days.", "Rekening koran menyambung yang sebelumnya: tidak bertumpuk, tidak ada hari yang hilang.")}</p>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose} disabled={busy}>{tr("Cancel", "Batal")}</Button>
            <Button icon={Upload} onClick={run} disabled={busy || !file || file.rows.length === 0 || form.closing === 0 || overlap != null || needsReason}>
              {busy ? tr("Reading…", "Membaca…") : file ? tr(`Import ${file.rows.length} row(s)`, `Masukkan ${file.rows.length} baris`) : tr("Import", "Masukkan")}
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        <Loaded state={accounts} skeletonRows={1}>
          {(accs) => (
            <label className="block">
              <span className="block text-xs text-slate-500">{tr("Account", "Rekening")}</span>
              <select
                value={form.account_code}
                onChange={(e) => setForm({ ...form, account_code: e.target.value })}
                className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none"
              >
                {accs.filter((a) => a.is_active !== false || a.code === form.account_code).map((a) => (
                  <option key={a.code} value={a.code}>
                    {a.code} — {a.name}{a.currency !== "IDR" ? ` (${a.currency})` : ""}
                  </option>
                ))}
              </select>
            </label>
          )}
        </Loaded>

        <div>
          <label htmlFor="rk-file" className="block text-xs text-slate-500">
            {tr("Export from the bank —", "Export dari bank —")} <code className="text-[11px]">Tanggal, Keterangan, Jumlah (DB/CR), Saldo</code>,
            {" "}{tr("or separate Debit/Kredit columns", "atau kolom Debit/Kredit terpisah")}
          </label>
          <input
            id="rk-file" type="file" accept=".csv,text/csv,text/plain"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void read(f); }}
            className="mt-1 block w-full rounded-lg border border-dashed border-slate-300 px-3 py-4 text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-brand-50 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-brand-700 hover:border-brand-300"
          />
        </div>

        {latest ? (
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg bg-slate-50 px-3 py-2 text-[12px] text-slate-600">
            <Link2 className="h-3.5 w-3.5 text-slate-400" />
            {tr("Continues", "Menyambung")} <span className="font-medium text-slate-800">{latest.statement_no}</span>
            · {tr("ended", "berakhir")} {latest.period_end} · {tr("closing", "saldo akhir")}
            <span className="font-semibold tabular-nums text-slate-800">{formatNumber(latest.closing_balance)}</span>
            {form.opening !== latest.closing_balance && (
              <button type="button" onClick={() => { setForm({ ...form, opening: latest.closing_balance }); setOpeningAuto(true); }}
                className="rounded-md border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-medium text-brand-700 hover:border-brand-300">
                {tr("Use as opening", "Pakai sebagai saldo awal")}
              </button>
            )}
          </p>
        ) : statements.status === "ready" && (
          <p className="rounded-lg bg-slate-50 px-3 py-2 text-[12px] text-slate-500">
            {tr(`The first statement for ${form.account_code} — nothing to continue.`, `Rekening koran pertama untuk ${form.account_code} — belum ada yang disambung.`)}
          </p>
        )}

        <div className="grid gap-2 sm:grid-cols-2">
          <label className="block">
            <span className="block text-xs text-slate-500">{tr("Opening balance (from the statement)", "Saldo awal (dari rekening koran)")}</span>
            <div className="mt-1"><MoneyInput value={form.opening} onChange={(v) => { setForm({ ...form, opening: v }); setOpeningAuto(false); }} /></div>
          </label>
          <label className="block">
            <span className="block text-xs text-slate-500">{tr("Closing balance (from the statement)", "Saldo akhir (dari rekening koran)")}</span>
            <div className="mt-1"><MoneyInput value={form.closing} onChange={(v) => setForm({ ...form, closing: v })} /></div>
          </label>
        </div>

        {file && (
          <div className="rounded-xl border border-slate-200 bg-slate-50/60 px-4 py-3">
            <p className="flex items-center gap-2 text-[13px] font-medium text-slate-800">
              <FileSpreadsheet className="h-4 w-4 text-slate-400" /> {file.name}
            </p>
            <dl className="mt-2 grid grid-cols-3 gap-2 text-[12px]">
              <div>
                <dt className="text-slate-500">{tr("Rows read", "Baris terbaca")}</dt>
                <dd className="font-semibold tabular-nums text-slate-800">{file.rows.length}</dd>
              </div>
              <div>
                <dt className="text-slate-500">{tr("Net movement", "Mutasi bersih")}</dt>
                <dd className="font-semibold tabular-nums text-slate-800">
                  {movement >= 0 ? "+" : "−"}{formatNumber(Math.abs(movement))}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">{tr("Closing balance (computed)", "Saldo akhir (hitung)")}</dt>
                <dd className={`font-semibold tabular-nums ${balanced ? "text-emerald-700" : "text-rose-700"}`}>
                  {formatNumber(computed)}
                </dd>
              </div>
            </dl>
            {file.skipped > 0 && (
              <p className="mt-2 text-[11px] text-amber-700">
                {tr(`${file.skipped} row(s) with no readable date or amount — left out, and not guessed at.`, `${file.skipped} baris tanpa tanggal atau tanpa jumlah yang terbaca — tidak ikut, dan tidak ditebak.`)}
              </p>
            )}
            {form.closing > 0 && !balanced && (
              <p className="mt-2 flex items-start gap-1.5 text-[11px] text-rose-700">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                {tr("The computed balance does not equal the closing balance you entered. It can still be uploaded — but the mismatch will be shown on the screen, not hidden.",
                  "Saldo hitung tidak sama dengan saldo akhir yang Anda masukkan. Tetap bisa diunggah — tapi ketidakcocokannya akan tercatat di layar, bukan disembunyikan.")}
              </p>
            )}
            <ul className="mt-2 space-y-0.5 text-[11px] text-slate-600">
              {file.rows.slice(0, 5).map((r, i) => (
                <li key={i}>
                  {r.value_date} · {r.direction === "IN" ? "+" : "−"}{formatNumber(r.amount)} · {r.raw_description}
                </li>
              ))}
              {file.rows.length > 5 && <li className="text-slate-400">{tr(`+${file.rows.length - 5} more row(s)`, `+${file.rows.length - 5} baris lagi`)}</li>}
            </ul>
          </div>
        )}

        {overlap && (
          <p className="flex items-start gap-1.5 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] text-rose-800">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {tr(`The file's dates overlap ${overlap.statement_no} (${overlap.period_start} → ${overlap.period_end}). A day in two statements can be booked twice, so this cannot be uploaded.`,
              `Tanggal di file ini bertumpuk dengan ${overlap.statement_no} (${overlap.period_start} → ${overlap.period_end}). Satu hari di dua rekening koran bisa terbukukan dua kali, jadi file ini tidak bisa diunggah.`)}
          </p>
        )}

        {!overlap && problems.length > 0 && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-900">
            <p className="flex items-center gap-1.5 font-medium">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              {tr("This statement does not continue the chain", "Rekening koran ini tidak bersambung")}
            </p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5">
              {problems.map((p, i) => <li key={i}>{describeProblem(p, formatNumber)}</li>)}
            </ul>
            <p className="mt-1.5 text-[11px] text-amber-800">
              {tr("Check the balances and the period first. If it really is so — a new account, a month the bank never sent — write down why. The reason stays on the statement.",
                "Periksa dulu saldo dan periodenya. Bila memang begitu — rekening baru, bulan yang tidak dikirim bank — tulis alasannya. Alasan ini tersimpan di rekening koran.")}
            </p>
            <textarea
              id="rk-continuity-reason"
              value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} rows={2}
              placeholder={tr("Reason (required to upload)", "Alasan (wajib untuk mengunggah)")}
              className="mt-1.5 w-full rounded-lg border border-amber-300 bg-white px-2 py-1.5 text-sm text-slate-800 focus:border-amber-500 focus:outline-none"
            />
          </div>
        )}

        <input
          value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })}
          placeholder={tr("Note — e.g. handed over by leadership on WhatsApp", "Catatan — mis. diserahkan pimpinan lewat WhatsApp")}
          className="h-9 w-full rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none"
        />
      </div>
    </Modal>
  );
}
