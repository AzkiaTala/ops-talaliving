"use client";

import { useState } from "react";
import { Stamp, Undo2, MessageSquareQuote, ChevronDown, Send } from "lucide-react";
import { Button } from "@/components/ui/primitives";
import { MoneyInput } from "@/components/ui/money-input";
import { NumberInput } from "@/components/ui/number-input";
import { formatIDR, formatNumber } from "@/lib/format";
import { cn } from "@/lib/cn";
import { useTr } from "@/lib/i18n";
import { procurement } from "@/demo/api";
import type { PrLineView } from "@/services/procurement/contracts";
import { useToast } from "@/store/toast";
import { useSession } from "@/store/session";
import { ApprovalTrail } from "./ApprovalTrail";

/** The decision on one item: how much of it, for how much, and what
 *  leadership wants said about it.
 *
 *  The two note fields are not the same thing. **Instructions** is something
 *  the requester is expected to DO — "negotiate first", "use the Denpasar
 *  supplier" — and it is worth writing on a line nobody has decided yet,
 *  which is why it is not a column on the approval row (D64). **Remark** is
 *  for the record: why the amount was cut, what to watch next time.
 *
 *  Un-approving lives here because it has to live somewhere. A decision that
 *  can be made and not unmade is a trap, and the only remaining fix would be
 *  database access (D61).
 */
export function DecisionPanel({
  line, onChanged,
}: {
  line: PrLineView;
  onChanged: (l: PrLineView) => void;
}) {
  const tr = useTr();
  const { can, hasAuthority } = useSession();
  const { toast } = useToast();
  const mayDecide = hasAuthority("approve_goods");
  const approved = !!line.approval?.approved;

  const [qty, setQty] = useState<number>(line.qty ?? 0);
  const [amount, setAmount] = useState<number>(line.item_total);
  const [instructions, setInstructions] = useState("");
  const [remark, setRemark] = useState("");
  const [busy, setBusy] = useState(false);
  const [trail, setTrail] = useState(false);
  const maySend = can("procurement.create");

  async function decide(next: boolean) {
    setBusy(true);
    const res = await procurement.approveLine({
      line_no: line.line_no_full,
      approved: next,
      approved_qty: next && line.qty != null ? qty : null,
      approved_amount: next ? amount : null,
      instructions: next ? instructions : null,
      remark: next ? remark : null,
    });
    setBusy(false);
    if (res.error) {
      toast(res.error.status === 403 ? "critical" : "warning", tr("Not recorded", "Tidak dicatat"), res.error.message);
      return;
    }
    toast("success", next ? tr(`Approved ${formatIDR(amount)}`, `Disetujui ${formatIDR(amount)}`) : tr("Un-approved", "Persetujuan dicabut"), line.description);
    setInstructions("");
    setRemark("");
    onChanged(res.data);
  }

  async function saveNote() {
    setBusy(true);
    const res = await procurement.noteLine({
      line_no: line.line_no_full,
      instructions: instructions || null,
      remark: remark || null,
    });
    setBusy(false);
    if (res.error) { toast("warning", tr("Not recorded", "Tidak dicatat"), res.error.message); return; }
    toast("success", tr("Note recorded", "Catatan dicatat"), line.line_no_full);
    setInstructions("");
    setRemark("");
    onChanged(res.data);
  }

  return (
    <section className="rounded-xl border border-slate-200 px-4 py-3.5">
      <div className="flex items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
          <Stamp className="h-3.5 w-3.5" /> {tr("Decision", "Keputusan")}
        </p>
        <button
          onClick={() => setTrail((t) => !t)}
          className="flex items-center gap-1 text-[12px] text-slate-500 hover:text-slate-700"
        >
          {tr("Trail", "Riwayat")} <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", trail && "rotate-180")} />
        </button>
      </div>

      {/* Asked, and waiting on a person — which the board cannot tell from
          "nobody has looked at it" unless it says so. */}
      {line.pending_request && !approved && (
        <p className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-[12px] text-slate-600">
          {tr("Asked", "Ditanyakan ke")} <span className="font-medium">{line.pending_request.sent_to_email}</span> {tr("on chat,", "lewat chat,")}{" "}
          {new Date(line.pending_request.sent_at).toLocaleString()} · {tr("sent by", "dikirim oleh")} {line.pending_request.sent_by_email}.
          {" "}{tr(
            "Their answer is recorded as theirs, whoever is signed in here.",
            "Jawabannya dicatat atas nama mereka, siapa pun yang sedang masuk di sini.",
          )}
        </p>
      )}

      {line.approval ? (
        <p className="mt-2 text-[13px] text-slate-700">
          {approved
            ? tr(
              `Approved ${formatIDR(line.approval.approved_amount ?? line.item_total)}`,
              `Disetujui ${formatIDR(line.approval.approved_amount ?? line.item_total)}`,
            )
            : tr("Un-approved", "Persetujuan dicabut")}
          {approved && line.approval.approved_qty != null && line.qty != null
            && line.approval.approved_qty !== line.qty
            && tr(
              ` · ${formatNumber(line.approval.approved_qty)} of ${formatNumber(line.qty)} ${line.uom ?? ""}`,
              ` · ${formatNumber(line.approval.approved_qty)} dari ${formatNumber(line.qty)} ${line.uom ?? ""}`,
            )}
          <span className="block text-[11px] text-slate-400">
            {line.approval.recorded_by_email} · {new Date(line.approval.recorded_at).toLocaleString()} · {tr("via", "lewat")} {line.approval.channel}
          </span>
        </p>
      ) : (
        <p className="mt-2 text-[13px] text-slate-500">{tr("Nobody has decided this yet.", "Belum ada yang memutuskan ini.")}</p>
      )}

      {trail && (
        <div className="mt-3 rounded-lg bg-slate-50 px-3 py-2.5">
          <ApprovalTrail lineNo={line.line_no_full} />
        </div>
      )}

      {/* The latest word from leadership, whether or not it came with a yes. */}
      {line.note && (
        <div className="mt-3 space-y-1 rounded-lg bg-brand-50/70 px-3 py-2.5 text-[13px] text-brand-900">
          {line.note.instructions && (
            <p className="flex gap-2">
              <MessageSquareQuote className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {line.note.instructions}
            </p>
          )}
          {line.note.remark && <p className="italic text-brand-800">{line.note.remark}</p>}
          <p className="text-[11px] text-brand-700/70">
            {line.note.recorded_by_email} · {new Date(line.note.recorded_at).toLocaleString()}
          </p>
        </div>
      )}

      {/* Anyone in procurement may ASK; only the addressee may answer. That
          split is the whole point: sending is chasing, answering is deciding
          (D69). */}
      {maySend && !approved && !line.removed_at && !line.pending_request && (
        <div className="mt-3 border-t border-slate-100 pt-3">
          <Button
            variant="outline"
            size="sm"
            icon={Send}
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              const res = await procurement.requestApproval({ line_nos: [line.line_no_full] });
              setBusy(false);
              if (res.error) { toast("warning", tr("Not sent", "Tidak terkirim"), res.error.message); return; }
              toast("success", tr(`Sent as ${res.data.batch_no}`, `Terkirim sebagai ${res.data.batch_no}`), tr(`Waiting on ${res.data.sent_to_email}`, `Menunggu ${res.data.sent_to_email}`));
              const again = await procurement.listOpenLines();
              const updated = again.data?.find((l) => l.id === line.id);
              if (updated) onChanged(updated);
            }}
          >
            {tr("Ask for approval on Chat", "Minta persetujuan lewat Chat")}
          </Button>
          <p className="mt-1.5 text-[11px] text-slate-500">
            {tr(
              "The meeting runs on one laptop; the approver is rarely holding it. Answering in chat records the decision against the person who actually took it.",
              "Rapat berjalan di satu laptop; penyetuju jarang memegangnya. Menjawab lewat chat mencatat keputusan atas nama orang yang benar-benar mengambilnya.",
            )}
          </p>
        </div>
      )}

      {mayDecide && !line.removed_at && (
        <div className="mt-3 space-y-3 border-t border-slate-100 pt-3">
          {!approved && (
            <div className="grid grid-cols-2 gap-3">
              {line.qty != null && (
                <div>
                  <label htmlFor="dp-qty" className="block text-xs text-slate-500">
                    {tr("Approve how many", "Setujui berapa")} <span className="text-slate-400">{tr("of", "dari")} {formatNumber(line.qty)} {line.uom ?? ""}</span>
                  </label>
                  <NumberInput
                    id="dp-qty"
                    value={qty}
                    min={0}
                    max={line.qty ?? undefined}
                    onChange={(v) => {
                      setQty(v);
                      if (line.unit_price != null) setAmount(Math.round(v * line.unit_price));
                    }}
                    className="mt-1"
                  />
                </div>
              )}
              <div>
                <label htmlFor="dp-amount" className="block text-xs text-slate-500">{tr("For how much", "Sebesar berapa")}</label>
                <MoneyInput id="dp-amount" value={amount} onChange={setAmount} className="mt-1" />
                {amount !== line.item_total && (
                  <p className={cn("mt-1 text-[11px]", amount > line.item_total ? "text-amber-700" : "text-brand-700")}>
                    {formatIDR(Math.abs(amount - line.item_total))}{" "}
                    {amount > line.item_total ? tr("more than asked", "lebih dari yang diminta") : tr("less than asked", "kurang dari yang diminta")}
                  </p>
                )}
              </div>
            </div>
          )}

          <div>
            <label htmlFor="dp-instructions" className="block text-xs text-slate-500">
              {tr("Instructions", "Instruksi")} <span className="text-slate-400">{tr("— optional, something to do", "— opsional, sesuatu untuk dikerjakan")}</span>
            </label>
            <input
              id="dp-instructions"
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder={tr("e.g. Negotiate the price first, then order", "mis. Negosiasikan harga dulu, lalu pesan")}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none"
            />
          </div>
          <div>
            <label htmlFor="dp-remark" className="block text-xs text-slate-500">
              {tr("Remark", "Keterangan")} <span className="text-slate-400">{tr("— optional, for the record", "— opsional, untuk catatan")}</span>
            </label>
            <input
              id="dp-remark"
              value={remark}
              onChange={(e) => setRemark(e.target.value)}
              placeholder={tr("e.g. Cut to 60 litres, stage 1 only needs that much", "mis. Dipotong jadi 60 liter, tahap 1 hanya butuh sebanyak itu")}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none"
            />
          </div>

          <div className="flex flex-wrap justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={busy || (!instructions.trim() && !remark.trim())}
              onClick={saveNote}
            >
              {tr("Note only", "Catatan saja")}
            </Button>
            {approved ? (
              <Button variant="outline" size="sm" icon={Undo2} disabled={busy} onClick={() => decide(false)}>
                {tr("Un-approve", "Cabut persetujuan")}
              </Button>
            ) : (
              <Button size="sm" icon={Stamp} disabled={busy} onClick={() => decide(true)}>
                {busy ? tr("Recording…", "Mencatat…") : tr(`Approve ${formatIDR(amount)}`, `Setujui ${formatIDR(amount)}`)}
              </Button>
            )}
          </div>

          {approved && line.coverage.covered > 0 && (
            <p className="text-[11px] text-amber-700">
              {tr(
                `${formatIDR(line.coverage.covered)} has already been paid against this item. Un-approving does not pull the money back — it moves the line to`,
                `${formatIDR(line.coverage.covered)} sudah dibayar untuk barang ini. Mencabut persetujuan tidak menarik uangnya kembali — baris ini pindah ke`,
              )}
              <em> {tr("paid, not approved", "dibayar, tidak disetujui")}</em>.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
