"use client";

import { useState } from "react";
import { Landmark, AlertTriangle, Upload, Link2, Plus, EyeOff, Coins, Pencil, Ban } from "lucide-react";
import { Badge, Button, Card, CardHeader, PageHeader } from "@/components/ui/primitives";
import { Loaded, SourceBadge, useLoad } from "@/components/ui/loaded";
import { Paged } from "@/components/ui/pager";
import { MoneyInput } from "@/components/ui/money-input";
import { formatIDR, formatNumber } from "@/lib/format";
import { cn } from "@/lib/cn";
import { accounting } from "@/demo/api";
import type { BankStatementView, StatementLineView } from "@/services/accounting/contracts";
import { ImportStatement } from "./ImportStatement";
import { useSession } from "@/store/session";
import { useToast } from "@/store/toast";
import { useTr } from "@/lib/i18n";

/** Rekening koran — how the leadership accounts reach the ledger at all.
 *
 *  BCA 064 and BCA USD 081 are held by leadership and not shared openly, so
 *  nothing else can produce their rows (D180, Q42). That makes this screen
 *  different from an ordinary reconciliation in one important way: most lines
 *  are **not** waiting to be ticked off against something, they are waiting to
 *  be **booked**.
 *
 *  Three refusals hold it together:
 *
 *  - A ledger row is never created from a foreign line until somebody types the
 *    rate the bank actually gave that day (D181).
 *  - A match is offered, never applied. Two identical transfers in one week
 *    would otherwise reconcile against each other's rows in silence.
 *  - Opening + movements must equal the closing balance the bank printed. When
 *    it does not, the file is partial and the screen says so **before** anybody
 *    books from it (D182).
 */
export default function StatementsPage() {
  const tr = useTr();
  const { can, hasAuthority } = useSession();
  const [statements, reload] = useLoad(() => accounting.listStatements(), []);
  const [open, setOpen] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [showVoided, setShowVoided] = useState(false);
  const mayPost = hasAuthority("post_ledger");
  const mayEdit = can("accounting.update");

  return (
    <div>
      <PageHeader
        breadcrumb={tr("Accounting", "Akuntansi")}
        title={tr("Bank statements", "Rekening koran")}
        description={tr("For BCA 064 and BCA USD 081 this is not reconciliation — it is the only way their movements reach the ledger. A dollar line cannot be booked before its rate is filled in.", "Untuk BCA 064 dan BCA USD 081 ini bukan pencocokan — ini satu-satunya jalan mutasi mereka masuk buku besar. Baris dolar tidak bisa dibukukan sebelum kursnya diisi.")}
        actions={
          <div className="flex items-center gap-2">
            <SourceBadge state={statements} />
            {mayEdit && <Button icon={Upload} onClick={() => setImporting(true)}>{tr("Upload", "Unggah")}</Button>}
          </div>
        }
      />

      <Loaded state={statements} onRetry={reload}>
        {(everything) => {
          /* A voided statement (ABANDONED, 0195) is kept for the audit trail
             but is out of the way: it no longer counts, so it no longer takes a
             place in the list unless somebody asks to see it — the same as a
             voided row on the ledger behind *Include voided*. */
          const voided = everything.filter((s) => s.status === "ABANDONED");
          const all = showVoided ? everything : everything.filter((s) => s.status !== "ABANDONED");
          return (
          <div className="space-y-4">
            {all.map((s) => (
              <StatementCard
                key={s.id}
                statement={s}
                expanded={open === s.statement_no}
                onToggle={() => setOpen(open === s.statement_no ? null : s.statement_no)}
                mayPost={mayPost}
                mayEdit={mayEdit}
                onChanged={reload}
              />
            ))}
            {importing && (
              <ImportStatement
                onClose={() => setImporting(false)}
                onDone={() => { setImporting(false); reload(); }}
              />
            )}
            {all.length === 0 && (
              <Card>
                <p className="px-5 py-8 text-[13px] text-slate-500">
                  {tr("No bank statement has been uploaded yet.", "Belum ada rekening koran yang diunggah.")}
                </p>
              </Card>
            )}
            {voided.length > 0 && (
              <button type="button" onClick={() => setShowVoided(!showVoided)}
                className="text-[12px] font-medium text-slate-500 underline-offset-2 hover:text-slate-700 hover:underline">
                {showVoided
                  ? tr("Hide voided statements", "Sembunyikan rekening koran yang di-void")
                  : tr(`Show voided statements (${voided.length})`, `Tampilkan rekening koran yang di-void (${voided.length})`)}
              </button>
            )}
          </div>
          );
        }}
      </Loaded>
    </div>
  );
}

function StatementCard({
  statement: s, expanded, onToggle, mayPost, mayEdit, onChanged,
}: {
  statement: BankStatementView;
  expanded: boolean;
  onToggle: () => void;
  mayPost: boolean;
  mayEdit: boolean;
  onChanged: () => void;
}) {
  const tr = useTr();
  const { toast } = useToast();
  const money = (n: number) => s.currency === "IDR" ? formatIDR(n) : `${s.currency} ${formatNumber(n)}`;
  const abandoned = s.status === "ABANDONED";
  /* Lines already in the ledger hold the statement (0195): the button says so
     instead of promising something the seam will refuse. */
  const inLedger = s.booked + s.matched;
  const [abandoning, setAbandoning] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  async function abandon() {
    setBusy(true);
    const res = await accounting.abandonStatement({ statement_no: s.statement_no, reason });
    setBusy(false);
    if (res.error) {
      toast(res.error.status === 403 ? "critical" : "warning", tr("Not voided", "Tidak jadi di-void"), res.error.message);
      return;
    }
    toast("success", tr(`${s.statement_no} voided`, `${s.statement_no} di-void`),
      tr("Its period is free: upload the correct file.", "Periodenya kosong lagi: unggah file yang benar."));
    setAbandoning(false);
    onChanged();
  }

  return (
    <Card className={abandoned ? "opacity-70" : undefined}>
      <CardHeader
        title={`${s.account_code} · ${s.period_start} → ${s.period_end}`}
        subtitle={tr(
          `${s.filename} — uploaded by ${s.uploaded_by_name}, ${s.uploaded_at.slice(0, 10)}${s.note ? ` · ${s.note}` : ""}`,
          `${s.filename} — diunggah ${s.uploaded_by_name}, ${s.uploaded_at.slice(0, 10)}${s.note ? ` · ${s.note}` : ""}`,
        )}
        icon={Landmark}
        action={
          <div className="flex flex-wrap items-center gap-2">
            {abandoned && <Badge tone="slate">{tr("Voided", "Void")}</Badge>}
            {!abandoned && mayEdit && !abandoning && (
              <Button size="sm" variant="ghost" icon={Pencil} onClick={() => setAbandoning(true)}>
                {tr("Edit", "Edit")}
              </Button>
            )}
            {!s.continuity_ok && <Badge tone="red">{tr("Not continuous", "Tidak bersambung")}</Badge>}
            {s.unmatched > 0 && <Badge tone="amber">{tr(`${s.unmatched} undecided`, `${s.unmatched} belum diputuskan`)}</Badge>}
            {s.awaiting_rate > 0 && <Badge tone="red">{tr(`${s.awaiting_rate} awaiting a rate`, `${s.awaiting_rate} menunggu kurs`)}</Badge>}
            {s.booked > 0 && <Badge tone="green">{tr(`${s.booked} in the ledger`, `${s.booked} masuk buku besar`)}</Badge>}
            <Button size="sm" variant="outline" onClick={onToggle}>
              {expanded ? tr("Close", "Tutup") : tr("Open", "Buka")}
            </Button>
          </div>
        }
      />

      {abandoning && (
        <div className="border-t border-slate-100 bg-slate-50 px-5 py-3 text-[12px] text-slate-700">
          {inLedger > 0 ? (
            <p className="flex items-start gap-1.5 text-rose-800">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {tr(`${inLedger} row(s) of this statement are already in the ledger or tied to it, so it cannot be voided. Void the transactions booked from it in the ledger first.`,
                `${inLedger} baris dari rekening koran ini sudah masuk atau ditautkan ke buku besar, jadi tidak bisa di-void. Void dulu transaksi yang dibukukan dari sini di Ledger.`)}
            </p>
          ) : (
            <>
              <p>
                {tr(`Void ${s.statement_no}? It is kept, marked void, and stops counting: it leaves the list and the chain, its rows can no longer be decided, and its period (${s.period_start} → ${s.period_end}) can be uploaded again with the right file. Who voided it, when and why stay on record. Nothing is deleted.`,
                  `Void ${s.statement_no}? Rekening koran ini tetap tersimpan dengan tanda void dan tidak dihitung lagi: keluar dari daftar dan rantai, barisnya tidak bisa diputuskan lagi, dan periodenya (${s.period_start} → ${s.period_end}) bisa diunggah ulang dengan file yang benar. Siapa yang me-void, kapan, dan alasannya tetap tercatat. Tidak ada yang dihapus.`)}
              </p>
              <textarea
                id={`abandon-${s.statement_no}`}
                value={reason} onChange={(e) => setReason(e.target.value)} rows={2}
                placeholder={tr("Reason — e.g. wrong account, wrong opening balance, wrong file", "Alasan — mis. salah rekening, salah saldo awal, salah file")}
                className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm focus:border-brand-400 focus:outline-none"
              />
            </>
          )}
          <div className="mt-2 flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => { setAbandoning(false); setReason(""); }} disabled={busy}>
              {tr("Cancel", "Batal")}
            </Button>
            {inLedger === 0 && (
              <Button size="sm" variant="danger" icon={Ban} onClick={abandon} disabled={busy || reason.trim() === ""}>
                {busy ? tr("Voiding…", "Me-void…") : tr("Void this statement", "Void rekening koran ini")}
              </Button>
            )}
          </div>
        </div>
      )}

      {abandoned && (
        <p className="flex items-start gap-2 border-t border-slate-100 bg-slate-50 px-5 py-2.5 text-[12px] text-slate-700">
          <Ban className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
          <span>
            <strong>{tr("Voided", "Di-void")}</strong>{" "}
            {tr(`by ${s.abandoned_by_name ?? "—"}, ${s.abandoned_at?.slice(0, 10) ?? ""}.`, `oleh ${s.abandoned_by_name ?? "—"}, ${s.abandoned_at?.slice(0, 10) ?? ""}.`)}{" "}
            {tr("Reason:", "Alasan:")} <em>{s.abandoned_reason}</em>
          </span>
        </p>
      )}

      <dl className="grid divide-y divide-slate-100 border-t border-slate-100 sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-4 lg:divide-x">
        {([
          [tr("Opening balance", "Saldo awal"), money(s.opening_balance),
            s.prev_statement_no == null ? tr(`according to ${s.account_code}`, `menurut ${s.account_code}`)
              : s.continuity_ok ? tr(`continues ${s.prev_statement_no}`, `menyambung ${s.prev_statement_no}`)
              : tr(`${s.prev_statement_no} closed at ${money(s.prev_closing_balance ?? 0)}`, `${s.prev_statement_no} ditutup ${money(s.prev_closing_balance ?? 0)}`)],
          [tr("Movements", "Mutasi"), `${s.movement >= 0 ? "+" : "−"}${money(Math.abs(s.movement))}`, tr(`${s.lines.length} row(s)`, `${s.lines.length} baris`)],
          [tr("Closing balance (bank)", "Saldo akhir (bank)"), money(s.closing_balance), tr("as printed on the statement", "tertulis di rekening koran")],
          [tr("Closing balance (computed)", "Saldo akhir (hitung)"), money(s.computed_closing),
            s.balance_ok ? tr("matches", "cocok") : tr(`off by ${money(Math.abs(s.computed_closing - s.closing_balance))}`, `selisih ${money(Math.abs(s.computed_closing - s.closing_balance))}`)],
        ] as [string, string, string][]).map(([k, v, note], i) => (
          <div key={k} className="px-4 py-3">
            <dt className="text-[11px] uppercase tracking-wide text-slate-400">{k}</dt>
            <dd className={cn(
              "mt-0.5 text-[17px] font-bold tabular-nums tracking-tight",
              i === 3 && !s.balance_ok ? "text-rose-700" : "text-slate-800",
            )}>
              {v}
            </dd>
            <p className="text-[11px] text-slate-500">{note}</p>
          </div>
        ))}
      </dl>

      {!s.balance_ok && (
        <p className="flex items-start gap-2 border-t border-slate-100 bg-rose-50/70 px-5 py-2.5 text-[12px] text-rose-900">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            <strong>{tr("The file is incomplete.", "Filenya belum utuh.")}</strong>{" "}
            {tr("The opening balance plus the movements does not equal the closing balance the bank printed. A page is missing, or the export was filtered — booking from half a file means half a ledger.",
              "Saldo awal ditambah mutasi tidak sama dengan saldo akhir yang dicetak bank. Ada halaman yang belum ikut, atau exportnya tersaring — membukukan dari file setengah berarti buku besar ikut setengah.")}
          </span>
        </p>
      )}

      {!s.continuity_ok && (
        <p className="flex items-start gap-2 border-t border-slate-100 bg-rose-50/70 px-5 py-2.5 text-[12px] text-rose-900">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            <strong>{tr("Does not continue the statement before it.", "Tidak menyambung rekening koran sebelumnya.")}</strong>{" "}
            {Math.abs(s.opening_balance - (s.prev_closing_balance ?? 0)) >= 0.005 && tr(
              `Opening ${money(s.opening_balance)}, but ${s.prev_statement_no} closed at ${money(s.prev_closing_balance ?? 0)}.`,
              `Saldo awal ${money(s.opening_balance)}, padahal ${s.prev_statement_no} ditutup ${money(s.prev_closing_balance ?? 0)}.`)}{" "}
            {(s.gap_days ?? 0) > 0 && tr(`${s.gap_days} day(s) between them are in no statement.`, `${s.gap_days} hari di antaranya tidak ada di rekening koran mana pun.`)}{" "}
            {s.continuity_reason
              ? <>{tr("Reason given:", "Alasan:")} <em>{s.continuity_reason}</em></>
              : tr("Uploaded before this was checked — no reason on record.", "Diunggah sebelum hal ini diperiksa — tidak ada alasan tercatat.")}
          </span>
        </p>
      )}

      {s.awaiting_rate > 0 && (
        <p className="flex items-start gap-2 border-t border-slate-100 bg-amber-50/70 px-5 py-2.5 text-[12px] text-amber-900">
          <Coins className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            {tr(
              `${s.awaiting_rate} row(s) in ${s.currency} have no rate yet. The system does not guess a rate: the right one is the rate the bank gave that day, and it is on the transaction slip.`,
              `${s.awaiting_rate} baris dalam ${s.currency} belum punya kurs. Sistem tidak menebak kurs: yang benar adalah kurs yang bank berikan hari itu, dan itu ada di nota transaksinya.`,
            )}
          </span>
        </p>
      )}

      {expanded && (
        <Paged rows={s.lines} pageSize={15} unit={tr("rows", "baris")}>
          {(page) => (
            <ul className="divide-y divide-slate-100 border-t border-slate-100">
              {page.map((l) => (
                <LineRow
                  key={l.id} line={l} statement={s}
                  mayPost={mayPost && !abandoned} mayEdit={mayEdit && !abandoned} onChanged={onChanged}
                />
              ))}
            </ul>
          )}
        </Paged>
      )}
    </Card>
  );
}

function LineRow({
  line: l, statement: s, mayPost, mayEdit, onChanged,
}: {
  line: StatementLineView;
  statement: BankStatementView;
  mayPost: boolean;
  mayEdit: boolean;
  onChanged: () => void;
}) {
  const tr = useTr();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [rate, setRate] = useState(0);
  const [booking, setBooking] = useState(false);
  const [form, setForm] = useState({ type_code: "CASHFLOW", description: "" });

  async function act(p: Promise<{ error?: { status: number; message: string } | null }>, done: string) {
    setBusy(true);
    const res = await p;
    setBusy(false);
    if (res.error) {
      toast(res.error.status === 403 ? "critical" : "warning", tr("Not done", "Tidak jadi"), res.error.message);
      return;
    }
    toast("success", done, "");
    setBooking(false);
    onChanged();
  }

  const amount = s.currency === "IDR"
    ? formatIDR(l.amount)
    : `${s.currency} ${formatNumber(l.amount)}`;

  return (
    <li className="px-5 py-2.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="w-[80px] shrink-0 font-mono text-[11px] text-slate-500">{l.value_date.slice(5)}</span>
        <span className="min-w-[220px] flex-1 text-[13px] text-slate-800">
          {l.raw_description}
          {l.note && <span className="block text-[11px] text-slate-500">{l.note}</span>}
        </span>
        <span className={cn(
          "w-[150px] text-right font-semibold tabular-nums",
          l.direction === "IN" ? "text-emerald-700" : "text-slate-800",
        )}>
          {l.direction === "IN" ? "+" : "−"}{amount}
        </span>
        {l.amount_idr != null && s.currency !== "IDR" && (
          <span className="w-[130px] text-right text-[11px] text-slate-500">
            {formatIDR(l.amount_idr)} @ {formatNumber(l.fx_rate ?? 0)}
          </span>
        )}
        <Badge tone={
          l.status === "booked" ? "green"
            : l.status === "matched" ? "brand"
              : l.status === "ignored" ? "slate" : "amber"
        }>
          {l.status === "booked" ? tr(`in the ledger ${l.trx_no}`, `masuk buku besar ${l.trx_no}`)
            : l.status === "matched" ? tr(`matched ${l.trx_no}`, `cocok ${l.trx_no}`)
              : l.status === "ignored" ? tr("skipped", "dilewati") : tr("undecided", "belum diputuskan")}
        </Badge>
      </div>

      {l.status === "unmatched" && (
        <div className="mt-1.5 space-y-1.5">
          {/* A foreign line cannot go anywhere until the rate is typed. */}
          {l.amount_idr == null && mayEdit && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[12px] text-slate-600">{tr("Rate that day:", "Kurs hari itu:")}</span>
              <div className="w-[150px]">
                <MoneyInput value={rate} onChange={setRate} />
              </div>
              <Button
                size="sm" variant="outline" disabled={busy || rate <= 0}
                onClick={() => act(
                  accounting.setStatementRate({ statement_no: s.statement_no, line_id: l.id, fx_rate: rate }),
                  tr("Rate saved", "Kurs tersimpan"),
                )}
              >
                {tr("Save rate", "Simpan kurs")}
              </Button>
              <span className="text-[11px] text-slate-500">
                {rate > 0 && `= ${formatIDR(Math.round(l.amount * rate))}`}
              </span>
            </div>
          )}

          {l.suggestions.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 px-3 py-1.5">
              <Link2 className="h-3.5 w-3.5 text-slate-400" />
              <span className="text-[12px] text-slate-600">{tr("Similar to:", "Mirip dengan:")}</span>
              {l.suggestions.map((m) => (
                <Button
                  key={m.trx_no} size="sm" variant="outline" disabled={busy || !mayEdit}
                  onClick={() => act(
                    accounting.matchStatementLine({ statement_no: s.statement_no, line_id: l.id, trx_no: m.trx_no }),
                    tr(`Linked to ${m.trx_no}`, `Ditautkan ke ${m.trx_no}`),
                  )}
                >
                  {m.trx_no} · {m.description.slice(0, 32)}
                  {m.days_apart !== 0 && tr(` · ${Math.abs(m.days_apart)} day(s)`, ` · ${Math.abs(m.days_apart)} hari`)}
                </Button>
              ))}
            </div>
          )}

          {mayEdit && (
            <div className="flex flex-wrap items-center gap-2">
              {!booking ? (
                <>
                  <Button
                    size="sm" icon={Plus} disabled={busy || !mayPost || l.amount_idr == null}
                    onClick={() => setBooking(true)}
                  >
                    {tr("Book", "Bukukan")}
                  </Button>
                  <Button
                    size="sm" variant="ghost" icon={EyeOff} disabled={busy}
                    onClick={() => {
                      const note = window.prompt(tr("Why it is skipped — read when this row is asked about:", "Alasan dilewati — dibaca saat baris ini ditanyakan:"));
                      if (note?.trim()) {
                        void act(
                          accounting.ignoreStatementLine({ statement_no: s.statement_no, line_id: l.id, note }),
                          tr("Skipped, with a reason", "Dilewati, dengan alasan"),
                        );
                      }
                    }}
                  >
                    {tr("Skip", "Lewati")}
                  </Button>
                  {!mayPost && (
                    <span className="text-[11px] text-slate-500">
                      {tr("Booking to the ledger needs the authority", "Membukukan ke buku besar butuh wewenang")} <span className="font-mono">post_ledger</span>.
                    </span>
                  )}
                </>
              ) : (
                <div className="grid w-full gap-2 sm:grid-cols-[150px_1fr_auto_auto]">
                  <select
                    value={form.type_code}
                    onChange={(e) => setForm({ ...form, type_code: e.target.value })}
                    aria-label={tr("Transaction type", "Jenis transaksi")}
                    className="h-9 rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none"
                  >
                    {["CASHFLOW", "SUPPLIERS", "BANK CHARGES", "OTHERS", "CHINA", "PREPAID VENDOR"].map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                  <input
                    value={form.description}
                    onChange={(e) => setForm({ ...form, description: e.target.value })}
                    placeholder={tr("Description — the bank line as it stands is not an explanation", "Keterangan — baris bank apa adanya bukan penjelasan")}
                    className="h-9 rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none"
                  />
                  <Button
                    size="sm" disabled={busy || !form.description.trim()}
                    onClick={() => act(
                      accounting.bookStatementLine({
                        statement_no: s.statement_no, line_id: l.id,
                        type_code: form.type_code as never, description: form.description,
                      }),
                      tr("In the ledger", "Masuk buku besar"),
                    )}
                  >
                    {tr("Save", "Simpan")}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setBooking(false)}>{tr("Cancel", "Batal")}</Button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </li>
  );
}
