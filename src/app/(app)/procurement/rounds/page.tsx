"use client";

import { useState } from "react";
import {
  Wallet, RefreshCw, Check, Lock, ArrowRightLeft, AlertTriangle, History, FileText,
} from "lucide-react";
import { Badge, Button, Card, CardHeader, EmptyState, PageHeader } from "@/components/ui/primitives";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Loaded, SourceBadge, useLoad } from "@/components/ui/loaded";
import { StatusPill } from "@/components/ui/status-pill";
import { formatIDR, formatNumber } from "@/lib/format";
import { cn } from "@/lib/cn";
import { documents, procurement } from "@/demo/api";
import type { PrLineView, RoundStatus, RoundTransfer } from "@/services/procurement/contracts";
import { useToast } from "@/store/toast";
import { useSession } from "@/store/session";
import { TransferForm } from "./TransferForm";
import { useTr, type Message } from "@/lib/i18n";

/** The payment round: one queue of what is owed, funded in one transfer.
 *
 *  Four states and each one is a different fact, which is why they are not
 *  collapsed into "in progress":
 *
 *    OPEN         everything approved and still owed rolls in by itself
 *    APPROVED     the numbers freeze — they stop being a calculation and
 *                 become the record of a decision
 *    TRANSFERRED  money reached BCA 271. **No item is paid by this** (A10)
 *    CLOSED       the round is finished; whatever is still owed goes back to
 *                 the queue rather than quietly disappearing
 *
 *  The third one is the point of the screen. In the old system "transferred"
 *  and "paid" were the same tick, so a round that had been funded looked like
 *  a set of settled invoices — and the vendors who had not been paid out of it
 *  were invisible until they called.
 */

const STEPS: { key: RoundStatus; label: Message; note: Message }[] = [
  { key: "OPEN", label: { en: "Open", id: "Terbuka" }, note: { en: "collecting what is owed", id: "mengumpulkan yang terutang" } },
  { key: "APPROVED", label: { en: "Approved", id: "Disetujui" }, note: { en: "numbers frozen", id: "angka dibekukan" } },
  { key: "TRANSFERRED", label: { en: "Transferred", id: "Ditransfer" }, note: { en: "money in BCA 271", id: "uang sudah di BCA 271" } },
  { key: "CLOSED", label: { en: "Closed", id: "Ditutup" }, note: { en: "what is left goes back", id: "sisanya kembali ke antrean" } },
];

export default function RoundsPage() {
  const tr = useTr();
  const { hasAuthority } = useSession();
  const { toast } = useToast();
  const [rounds, reload] = useLoad(() => procurement.listRounds(), []);
  const [busy, setBusy] = useState(false);
  const [released, setReleased] = useState<{ round_no: string; lines: PrLineView[] } | null>(null);

  const mayDecideFunds = hasAuthority("approve_funds");
  const mayPost = hasAuthority("post_ledger");

  async function sync() {
    setBusy(true);
    const res = await procurement.syncRound();
    setBusy(false);
    if (res.error) { toast("warning", tr("Not synced", "Tidak tersinkron"), res.error.message); return; }
    toast(
      res.meta.outcome === "noop" ? "info" : "success",
      res.meta.outcome === "noop"
        ? tr("Nothing to roll in", "Tidak ada yang dimasukkan")
        : tr(`Round ${res.data.round_no} updated`, `Putaran ${res.data.round_no} diperbarui`),
      res.meta.outcome === "noop"
        ? tr(
          "Every approved item that is still owed is already in the round.",
          "Semua barang yang disetujui dan masih terutang sudah ada di putaran ini.",
        )
        : tr(
          `${res.data.line_count} item(s) · ${formatIDR(res.data.requested_total)}`,
          `${res.data.line_count} barang · ${formatIDR(res.data.requested_total)}`,
        ),
    );
    reload();
  }

  async function approve(roundNo: string) {
    setBusy(true);
    const res = await procurement.approveRound(roundNo);
    setBusy(false);
    if (res.error) {
      toast(res.error.status === 403 ? "critical" : "warning", tr("Not approved", "Tidak disetujui"), res.error.message);
      return;
    }
    toast(
      "success",
      tr(`Round ${roundNo} approved`, `Putaran ${roundNo} disetujui`),
      tr(`${formatIDR(res.data.requested_total)} frozen`, `${formatIDR(res.data.requested_total)} dibekukan`),
    );
    reload();
  }

  async function close(roundNo: string) {
    setBusy(true);
    const res = await procurement.closeRound(roundNo);
    setBusy(false);
    if (res.error) {
      toast(res.error.status === 403 ? "critical" : "warning", tr("Not closed", "Tidak ditutup"), res.error.message);
      return;
    }
    /* The step everyone forgets, so closing says exactly what it let go of. */
    setReleased({ round_no: roundNo, lines: res.data.still_owed });
    toast(
      res.data.still_owed.length > 0 ? "warning" : "success",
      tr(`Round ${roundNo} closed`, `Putaran ${roundNo} ditutup`),
      res.data.still_owed.length > 0
        ? tr(
          `${res.data.still_owed.length} item(s) still owed — back in the queue`,
          `${res.data.still_owed.length} barang masih terutang — kembali ke antrean`,
        )
        : tr("Everything in it was settled.", "Semua isinya sudah lunas."),
    );
    reload();
  }

  const lineColumns: Column<PrLineView>[] = [
    {
      key: "item",
      header: tr("Item", "Barang"),
      className: "whitespace-normal",
      render: (l) => {
        const meta = [l.line_no_full, l.requested_by_name, l.vendor_name].filter(Boolean).join(" · ");
        return (
          <div className="max-w-[420px] whitespace-normal break-words">
            <p className="font-medium leading-snug text-slate-800">{l.description}</p>
            {l.purpose && <p className="text-[12px] leading-snug text-slate-500">{l.purpose}</p>}
            <p className="truncate font-mono text-[10px] text-slate-400" title={meta}>{meta}</p>
          </div>
        );
      },
    },
    {
      key: "qty",
      header: tr("Qty", "Jml"),
      align: "right",
      render: (l) => (
        <span className="whitespace-nowrap text-[12px] text-slate-600">
          {l.qty != null ? `${formatNumber(l.qty)} ${l.uom ?? ""}` : "—"}
        </span>
      ),
    },
    {
      key: "owed",
      header: tr("In this round", "Di putaran ini"),
      align: "right",
      render: (l) => (
        <div className="whitespace-nowrap">
          <p className="tabular-nums font-medium text-slate-800">{formatIDR(l.coverage.remaining)}</p>
          {l.coverage.covered > 0 && (
            <p className="text-[11px] text-slate-500">{formatIDR(l.coverage.covered)} {tr("paid so far", "sudah dibayar")}</p>
          )}
        </div>
      ),
    },
    {
      key: "status",
      header: tr("Item status", "Status barang"),
      render: (l) => <StatusPill kind="line" status={l.status} />,
    },
  ];

  return (
    <div>
      <PageHeader
        breadcrumb={tr("Procurement", "Pengadaan")}
        title={tr("Payment rounds", "Putaran pembayaran")}
        description={tr(
          "Everything approved and still owed, collected into one queue and funded in one transfer. Funding the round is not paying anyone — that happens item by item, against a document.",
          "Semua yang disetujui dan masih terutang, dikumpulkan dalam satu antrean dan didanai dengan satu transfer. Mendanai putaran bukan berarti membayar siapa pun — pembayaran dilakukan per barang, dengan dokumen.",
        )}
      />

      <Loaded state={rounds} onRetry={reload}>
        {(all) => {
          /* Usually one, sometimes two: a round being funded and the next one
             already collecting behind it. Showing only the first would hide a
             round somebody is waiting on. */
          const liveRounds = all
            .filter((r) => r.status !== "CLOSED")
            .sort((a, b) => a.round_no.localeCompare(b.round_no));
          const past = all.filter((r) => r.status === "CLOSED");

          return (
            <>
              {liveRounds.length > 0 ? liveRounds.map((live) => (
                <Card key={live.round_id} className="mb-5">
                  <CardHeader
                    title={live.round_no}
                    subtitle={tr(
                      `${live.line_count} item(s) · ${formatIDR(live.requested_total)} requested`,
                      `${live.line_count} barang · ${formatIDR(live.requested_total)} diminta`,
                    )}
                    icon={Wallet}
                    action={
                      <div className="flex flex-wrap items-center gap-2">
                        <SourceBadge state={rounds} />
                        <StatusPill kind="round" status={live.status} />
                      </div>
                    }
                  />

                  {/* Where the round is, and what each state actually means —
                      the vocabulary is the whole point of the screen. */}
                  <ol className="grid gap-px border-b border-slate-100 bg-slate-100 sm:grid-cols-4">
                    {STEPS.map((step) => {
                      const idx = STEPS.findIndex((x) => x.key === live.status);
                      const here = STEPS.findIndex((x) => x.key === step.key);
                      const done = here < idx;
                      const now = here === idx;
                      return (
                        <li
                          key={step.key}
                          className={cn(
                            "bg-white px-4 py-2.5",
                            now && "bg-brand-50",
                            done && "bg-slate-50",
                          )}
                        >
                          <p className={cn(
                            "text-[13px] font-semibold",
                            now ? "text-brand-800" : done ? "text-slate-500" : "text-slate-400",
                          )}>
                            {tr(step.label.en, step.label.id)}
                          </p>
                          <p className="text-[11px] text-slate-500">{tr(step.note.en, step.note.id)}</p>
                        </li>
                      );
                    })}
                  </ol>

                  <dl className="grid gap-x-6 gap-y-3 border-b border-slate-100 px-4 py-3.5 sm:grid-cols-4">
                    {([
                      [tr("Requested", "Diminta"), formatIDR(live.requested_total), live.status === "OPEN"
                        ? tr("recalculated as things change", "dihitung ulang saat ada perubahan")
                        : tr("frozen at approval", "dibekukan saat disetujui")],
                      ["BCA 271", formatIDR(live.paying_balance), tr("the account that pays suppliers", "rekening untuk membayar pemasok")],
                      [tr("To transfer", "Perlu ditransfer"), live.to_transfer > 0 ? formatIDR(live.to_transfer) : tr("nothing needed", "tidak perlu"), tr("before this round can be paid", "sebelum putaran ini bisa dibayar")],
                      [tr("After paying it all", "Setelah semua dibayar"), formatIDR(live.remaining_after_payment), live.remaining_after_payment < 0
                        ? tr("short by this much", "kurang sebesar ini")
                        : tr("left in the account", "sisa di rekening")],
                    ] as [string, string, string][]).map(([k, v, note]) => (
                      <div key={k}>
                        <dt className="text-[11px] uppercase tracking-wide text-slate-400">{k}</dt>
                        <dd className={cn(
                          "mt-0.5 text-lg font-bold tabular-nums tracking-tight",
                          k === tr("After paying it all", "Setelah semua dibayar") && live.remaining_after_payment < 0
                            ? "text-amber-700" : "text-slate-800",
                        )}>
                          {v}
                        </dd>
                        <p className="text-[11px] text-slate-500">{note}</p>
                      </div>
                    ))}
                  </dl>

                  {live.status === "TRANSFERRED" && (
                    <p className="flex items-start gap-2 border-b border-slate-100 bg-violet-50 px-4 py-2.5 text-[13px] text-violet-900">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                      <span>
                        <strong>{tr("The money is in BCA 271, and nothing is paid yet.", "Uangnya sudah di BCA 271, dan belum ada yang dibayar.")}</strong>{" "}
                        {tr(
                          "Every item below is still owed to a supplier — a line becomes paid when a payment is recorded against it, with a document, not when a round is funded.",
                          "Setiap barang di bawah masih terutang ke pemasok — sebuah baris menjadi lunas saat pembayaran dicatat untuknya, dengan dokumen, bukan saat putaran didanai.",
                        )}
                      </span>
                    </p>
                  )}

                  <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-3">
                    {live.status === "OPEN" && (
                      <Button variant="outline" size="sm" icon={RefreshCw} disabled={busy} onClick={sync}>
                        {tr("Roll in what is owed", "Masukkan yang terutang")}
                      </Button>
                    )}
                    {live.status === "OPEN" && mayDecideFunds && (
                      <Button size="sm" icon={Check} disabled={busy || live.line_count === 0} onClick={() => approve(live.round_no)}>
                        {tr("Approve the round", "Setujui putaran")}
                      </Button>
                    )}
                    {live.status !== "OPEN" && mayDecideFunds && (
                      <Button variant="outline" size="sm" icon={Lock} disabled={busy} onClick={() => close(live.round_no)}>
                        {tr("Close the round", "Tutup putaran")}
                      </Button>
                    )}
                    {!mayDecideFunds && (
                      <p className="text-[12px] text-slate-500">
                        {tr(
                          "Approving and closing a round belong to whoever holds",
                          "Menyetujui dan menutup putaran adalah hak pemegang",
                        )}{" "}
                        <span className="font-mono text-[11px]">approve_funds</span>{" "}
                        {tr("— you can read it either way.", "— Anda tetap bisa membacanya.")}
                      </p>
                    )}
                  </div>

                  {(live.status === "APPROVED"
                    || (live.status === "TRANSFERRED" && live.transfer_shortfall > 0)) && (
                    <div className="px-4 py-3">
                      {mayPost ? (
                        <TransferForm round={live} onDone={reload} />
                      ) : (
                        <p className="text-[13px] text-slate-500">
                          {tr(
                            "Approved and waiting for the transfer, which is recorded by whoever writes the ledger.",
                            "Disetujui dan menunggu transfer, yang dicatat oleh penulis buku besar.",
                          )}
                        </p>
                      )}
                    </div>
                  )}

                  {live.transfers.length > 0 && (
                    <TransfersPanel
                      transfers={live.transfers}
                      total={live.transferred_total}
                      shortfall={live.transfer_shortfall}
                    />
                  )}

                  <DataTable
                    dense
                    columns={lineColumns}
                    rows={live.lines}
                    rowKey={(l) => l.id}
                    empty={tr("Nothing in this round yet — roll in what is owed.", "Putaran ini masih kosong — masukkan yang terutang.")}
                  />
                </Card>
              )) : (
                <Card className="mb-5">
                  <div className="p-5">
                    <EmptyState
                      icon={Wallet}
                      title={tr("No round is open", "Tidak ada putaran terbuka")}
                      description={tr(
                        "Rolling in what is owed opens one and fills it with every approved item that has not been paid.",
                        "Memasukkan yang terutang akan membuka putaran dan mengisinya dengan semua barang disetujui yang belum dibayar.",
                      )}
                      action={<Button icon={RefreshCw} disabled={busy} onClick={sync}>{tr("Roll in what is owed", "Masukkan yang terutang")}</Button>}
                    />
                  </div>
                </Card>
              )}

              {released && (
                <Card className="mb-5">
                  <CardHeader
                    title={tr(`${released.round_no} closed`, `${released.round_no} ditutup`)}
                    subtitle={released.lines.length > 0
                      ? tr(
                        "These were in the round and are still owed. They are back in the queue — closing a round never settles anything.",
                        "Barang-barang ini ada di putaran dan masih terutang. Semuanya kembali ke antrean — menutup putaran tidak pernah melunasi apa pun.",
                      )
                      : tr("Everything in it was settled.", "Semua isinya sudah lunas.")}
                    icon={Lock}
                    action={<Button variant="ghost" size="sm" onClick={() => setReleased(null)}>{tr("Dismiss", "Tutup")}</Button>}
                  />
                  {released.lines.length > 0 && (
                    <DataTable
                      dense
                      columns={lineColumns}
                      rows={released.lines}
                      empty={tr("This round released nothing — it closed with no lines on it.", "Putaran ini tidak melepas apa pun — ditutup tanpa baris.")}
                      rowKey={(l) => l.id}
                    />
                  )}
                </Card>
              )}

              <Card>
                <CardHeader
                  title={tr("Past rounds", "Putaran sebelumnya")}
                  subtitle={tr("Closed, with what was actually transferred.", "Sudah ditutup, dengan jumlah yang benar-benar ditransfer.")}
                  icon={History}
                />
                <DataTable
                  dense
                  columns={[
                    { key: "no", header: tr("Round", "Putaran"), render: (r) => <span className="font-mono text-[12px] text-slate-700">{r.round_no}</span> },
                    { key: "lines", header: tr("Items", "Barang"), align: "right", render: (r) => <span className="tabular-nums text-[12px] text-slate-600">{r.line_count}</span> },
                    { key: "req", header: tr("Requested", "Diminta"), align: "right", render: (r) => <span className="tabular-nums text-slate-700">{formatIDR(r.requested_total)}</span> },
                    {
                      key: "trf",
                      header: tr("Transferred", "Ditransfer"),
                      align: "right",
                      render: (r) => r.transfers.length > 0
                        ? (
                          <div className="whitespace-nowrap">
                            <p className="tabular-nums text-slate-700">{formatIDR(r.transferred_total)}</p>
                            {/* Funded in parts more often than not, and every
                                part carried its own proof (D80, D82). */}
                            <p className="text-[10px] text-slate-400">
                              {r.transfers.length > 1
                                ? tr(`${r.transfers.length} transfers · proof on file`, `${r.transfers.length} transfer · bukti tersimpan`)
                                : tr(`${r.transfers.length} transfer · proof on file`, `${r.transfers.length} transfer · bukti tersimpan`)}
                            </p>
                          </div>
                        )
                        : <span className="text-slate-300">{tr("never funded", "tidak pernah didanai")}</span>,
                    },
                    { key: "status", header: tr("Status", "Status"), render: (r) => <StatusPill kind="round" status={r.status} /> },
                  ]}
                  rows={past}
                  rowKey={(r) => r.round_id}
                  empty={tr("No closed rounds yet.", "Belum ada putaran yang ditutup.")}
                />
              </Card>
            </>
          );
        }}
      </Loaded>
    </div>
  );
}

/** Every instalment that funded this round, and what is still to come.
 *
 *  Leadership sends half on Monday and the rest when a client pays: that is
 *  the ordinary case, not the exception (D82). Each row carries its own proof
 *  because each is its own claim about the bank — and the filenames are asked
 *  of the documents service rather than copied onto the round (ADR-004).
 */
function TransfersPanel({
  transfers, total, shortfall,
}: {
  transfers: RoundTransfer[];
  total: number;
  shortfall: number;
}) {
  const tr = useTr();
  const [attachments] = useLoad(() => documents.listAttachments(), []);
  const nameOf = (id: string) => attachments.status === "ready"
    ? attachments.data.find((a) => a.id === id)?.filename ?? null
    : null;

  return (
    <div className="border-b border-slate-100 px-4 py-3">
      <div className="flex flex-wrap items-baseline gap-x-3">
        <p className="text-[12px] font-semibold uppercase tracking-wide text-slate-500">
          {tr("Funded so far", "Sudah didanai")}
        </p>
        <p className="text-lg font-bold tabular-nums tracking-tight text-slate-800">
          {formatIDR(total)}
        </p>
        {shortfall > 0
          ? <p className="text-[13px] text-amber-700">{formatIDR(shortfall)} {tr("still to come in", "masih akan masuk")}</p>
          : <p className="text-[13px] text-emerald-700">{tr("fully funded", "didanai penuh")}</p>}
      </div>

      <ul className="mt-2 divide-y divide-slate-100 rounded-lg border border-slate-200">
        {transfers.map((t) => (
          <li key={t.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-[13px]">
            <ArrowRightLeft className="h-3.5 w-3.5 shrink-0 text-slate-400" />
            <span className="tabular-nums font-medium text-slate-800">{formatIDR(t.amount)}</span>
            <span className="font-mono text-[11px] text-slate-500">{t.trx_no}</span>
            <span className="text-[11px] text-slate-400">
              {new Date(t.recorded_at).toLocaleString()} · {t.recorded_by_email.split("@")[0]}
            </span>
            <span className="ml-auto flex items-center gap-1.5 rounded bg-violet-50 px-2 py-0.5 text-[12px] text-violet-800">
              <FileText className="h-3.5 w-3.5" />
              {nameOf(t.proof_attachment_id) ?? tr("proof on file", "bukti tersimpan")}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
