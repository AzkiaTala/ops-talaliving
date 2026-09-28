"use client";

import { useState } from "react";
import {
  Send, Circle, Clock, AlertTriangle, ExternalLink, Check, ShieldCheck,
} from "lucide-react";
import Link from "next/link";
import { Button, Card, CardHeader, PageHeader } from "@/components/ui/primitives";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Loaded, SourceBadge, useLoad } from "@/components/ui/loaded";
import { stripRefs } from "@/lib/refs";
import { StatusPill } from "@/components/ui/status-pill";
import { Link2 as LinkIcon } from "lucide-react";
import { MoneyInput } from "@/components/ui/money-input";
import { NumberInput } from "@/components/ui/number-input";
import { formatIDR, formatNumber } from "@/lib/format";
import { cn } from "@/lib/cn";
import { identity, procurement } from "@/demo/api";
import type { PrLineView } from "@/services/procurement/contracts";
import type { Approver } from "@/services/identity/contracts";
import { useToast } from "@/store/toast";
import { useSession } from "@/store/session";
import { LineDrawer } from "../pr/LineDrawer";
import { MoneyPanel } from "./MoneyPanel";
import { QuickAdd } from "./QuickAdd";
import { useTr } from "@/lib/i18n";

/** The leadership meeting, as a screen.
 *
 *  Everything here answers one of four questions, in the order a meeting asks
 *  them (D74):
 *
 *    1. What is waiting for a decision, and what would saying yes cost?
 *    2. What did we already approve that has not been paid?
 *    3. Is the money there — and if not, how much has to move into BCA 271?
 *    4. What else do we need? (added here, on the spot)
 *
 *  It is deliberately NOT the requests board. That board is the working
 *  surface — requesting, editing, attaching, paying — and it stays that way.
 *  This one is read in a room, once a week, by people deciding. Same data,
 *  same services; a different question.
 */
export default function MeetingBoardPage() {
  const tr = useTr();
  const { can, hasAuthority } = useSession();
  const { toast } = useToast();
  const [lines, reload] = useLoad(() => procurement.listOpenLines(), []);
  /* Who may be asked. Not a table read: `ops_core.user_authorities` is readable
     only for your own row unless you hold `it.manage_roles`, so until 0159 this
     screen could not name the approver at all — it sent the question and told
     you afterwards who had received it. */
  const [approvers] = useLoad(() => identity.listApprovers(), []);
  const [askTo, setAskTo] = useState<string | null>(null);
  const [selected, setSelected] = useState<PrLineView | null>(null);
  const [qtyDraft, setQtyDraft] = useState<Record<string, number>>({});
  const [amountDraft, setAmountDraft] = useState<Record<string, number>>({});
  const [noteDraft, setNoteDraft] = useState<Record<string, string>>({});
  /* Ticking marks an intention, not a decision. Nothing is written until the
     one confirm at the top — so a meeting can go through the list, change its
     mind twice, and see the total before anything is committed (D77). */
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);

  const mayDecide = hasAuthority("approve_goods");
  const mayAsk = can("procurement.create");

  const goodsApprovers: Approver[] = approvers.status === "ready"
    ? approvers.data.filter((a) => a.authority === "approve_goods")
    : [];
  /* The seam picks the first holder by name when nobody is named, and this
     screen always names somebody instead — an implicit choice presented as a
     fact is the thing the owner objected to. Until the list has loaded there is
     nobody to name, and the send button says so rather than guessing. */
  const askingWho = goodsApprovers.find((a) => a.email === askTo) ?? goodsApprovers[0];

  const qtyOf = (l: PrLineView) => qtyDraft[l.id] ?? l.qty ?? 0;
  const amountOf = (l: PrLineView) => amountDraft[l.id] ?? l.item_total;
  /* What the room says about an item, typed while it is being discussed.
     Held as a draft, written when the decision is (D64) or carried with the
     question to the approver (D127) — never silently lost. */
  const noteOf = (l: PrLineView) => noteDraft[l.id] ?? "";

  /** Quantity and money move together: approving 40 of 60 litres approves
   *  two-thirds of the price, and asking a person to do that arithmetic in
   *  their head is how an approval ends up disagreeing with itself. */
  function setQty(l: PrLineView, v: number) {
    setQtyDraft((d) => ({ ...d, [l.id]: v }));
    if (l.unit_price != null) setAmountDraft((d) => ({ ...d, [l.id]: Math.round(v * l.unit_price!) }));
  }

  function toggle(l: PrLineView) {
    setPicked((p) => ({ ...p, [l.id]: !p[l.id] }));
  }

  /** Approve everything ticked, in one act.
   *
   *  Only for somebody who actually holds the authority. For everybody else
   *  the same selection goes to the approver's chat instead — the meeting
   *  usually runs on a laptop that is not theirs, and recording their yes
   *  under whoever logged in is the mistake the chat route exists to prevent
   *  (D69).
   */
  async function approveSelected(rows: PrLineView[]) {
    setBusy(true);
    let done = 0;
    for (const l of rows) {
      const res = await procurement.approveLine({
        line_no: l.line_no_full,
        approved: true,
        approved_qty: l.qty != null ? qtyOf(l) : null,
        approved_amount: amountOf(l),
        instructions: noteOf(l).trim() || null,
      });
      if (res.error) {
        toast(res.error.status === 403 ? "critical" : "warning", tr(`Not approved · ${l.line_no_full}`, `Tidak disetujui · ${l.line_no_full}`), res.error.message);
        continue;
      }
      done += 1;
    }
    setBusy(false);
    if (done > 0) {
      toast("success", tr(`Approved ${done} item(s)`, `${done} barang disetujui`), formatIDR(rows.reduce((s, l) => s + amountOf(l), 0)));
      setPicked({});
      reload();
    }
  }

  /** Recording an instruction on a line that is already approved. There is no
   *  decision left for it to ride along with, so it is written on its own. */
  async function saveNote(l: PrLineView) {
    setBusy(true);
    const res = await procurement.noteLine({
      line_no: l.line_no_full, instructions: noteOf(l).trim() || null,
    });
    setBusy(false);
    if (res.error) {
      toast(res.error.status === 403 ? "critical" : "warning", tr("Not recorded", "Tidak tercatat"), res.error.message);
      return;
    }
    toast("success", tr(`Instruction on ${l.line_no_full}`, `Instruksi pada ${l.line_no_full}`), noteOf(l).trim());
    setNoteDraft((d) => ({ ...d, [l.id]: "" }));
    reload();
  }

  async function sendSelected(rows: PrLineView[]) {
    const askable = rows.filter((l) => !l.pending_request);
    if (askable.length === 0) {
      toast("warning", tr("Nothing to send", "Tidak ada yang dikirim"), tr("Every item you picked is already waiting for an answer.", "Semua barang yang Anda pilih sudah menunggu jawaban."));
      return;
    }
    if (!askingWho) {
      toast("warning", tr("Nobody to ask", "Tidak ada yang bisa ditanya"),
        tr(
          "No active account holds the authority to approve goods. IT grants it in Settings → People.",
          "Tidak ada akun aktif yang berwenang menyetujui barang. IT memberikannya di Pengaturan → Pengguna.",
        ));
      return;
    }
    setBusy(true);
    const res = await procurement.requestApproval({
      line_nos: askable.map((l) => l.line_no_full),
      to_email: askingWho.email,
      notes: Object.fromEntries(askable.map((l) => [l.line_no_full, noteOf(l).trim() || null])),
    });
    setBusy(false);
    if (res.error) { toast("warning", tr("Not sent", "Tidak terkirim"), res.error.message); return; }
    toast(
      "success",
      tr(
        `Sent ${res.data.items.length} item(s) as ${res.data.batch_no}`,
        `${res.data.items.length} barang terkirim sebagai ${res.data.batch_no}`,
      ),
      tr(
        `${formatIDR(res.data.requested_total)} for ${res.data.sent_to_email} to decide`,
        `${formatIDR(res.data.requested_total)} untuk diputuskan oleh ${res.data.sent_to_email}`,
      ),
    );
    setPicked({});
    setNoteDraft({});
    reload();
  }

  /* Shared by both tables — the meeting reads the same three things about
     every item, whichever pile it is in. */
  const itemColumn: Column<PrLineView> = {
    key: "item",
    header: tr("Item", "Barang"),
    className: "whitespace-normal",
    render: (l) => {
      const meta = [l.line_no_full, l.requested_by_name, l.project_code, l.vendor_name]
        .filter(Boolean).join(" · ");
      return (
        <div className="max-w-[420px] whitespace-normal break-words">
          <p className="font-medium leading-snug text-slate-800">{l.description}</p>
          {l.purpose
            ? <p className="text-[12px] leading-snug text-slate-500">{l.purpose}</p>
            : <p className="text-[12px] leading-snug text-amber-700">{tr("No note on what this is for.", "Tidak ada catatan untuk apa barang ini.")}</p>}
          <p className="truncate font-mono text-[10px] text-slate-400" title={meta}>{meta}</p>
          {/* The refusal exists in the API either way; saying it here means
              nobody meets it mid-meeting (D125). */}
          {!l.has_support && !l.approval?.approved && (
            <p className="mt-1 flex items-center gap-1 text-[12px] text-amber-700">
              <LinkIcon className="h-3 w-3 shrink-0" />
              {tr(
                "Nothing behind it yet — needs the shop link, the invoice or the bill.",
                "Belum ada dokumen pendukung — perlu link toko, invoice, atau tagihan.",
              )}
            </p>
          )}
        </div>
      );
    },
  };

  /** What the room says about an item, in a column rather than behind a click.
   *
   *  It is said out loud while the item is being discussed, and anything that
   *  takes a click to reach is said and then lost (D127).
   *
   *  Two behaviours, because the two lists are at different moments. On a line
   *  still waiting, the text is a draft that rides along with whatever happens
   *  next — the approval records it as leadership's instruction (D64), or the
   *  chat request carries it as the meeting's words. On a line already
   *  approved there is no next decision to ride on, so it is saved on its own,
   *  which only an approver may do.
   */
  function instructionColumn(mode: "draft" | "save"): Column<PrLineView> {
    return {
      key: "instructions",
      header: tr("Instructions", "Instruksi"),
      className: "whitespace-normal",
      render: (l) => {
        const existing = l.note?.instructions;
        const pending = l.pending_request?.meeting_note;
        const editable = mode === "draft" ? (mayDecide || mayAsk) : mayDecide;
        return (
          /* The row opens a drawer; a control inside it must not. Without
             this, the first keystroke in an instruction opened the line
             behind it and took the focus with it (F36). */
          <div
            className="w-[220px] max-w-[220px]"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
            role="presentation"
          >
            {editable ? (
              <>
                <textarea
                  id={`mi-${l.id}`}
                  value={noteOf(l)}
                  onChange={(e) => setNoteDraft((d) => ({ ...d, [l.id]: e.target.value }))}
                  rows={2}
                  placeholder={mode === "draft"
                    ? (mayDecide
                      ? tr("e.g. only if they deliver before the 20th", "mis. hanya jika dikirim sebelum tanggal 20")
                      : tr("what the room said — it goes with the question", "apa kata rapat — ikut terkirim bersama pertanyaan"))
                    : tr("add an instruction to this one", "tambahkan instruksi untuk barang ini")}
                  className="w-full resize-y rounded-lg border border-slate-200 px-2 py-1 text-[12px] leading-snug focus:border-brand-400 focus:outline-none"
                />
                {noteOf(l).trim() && (
                  mode === "draft" ? (
                    <p className="text-[11px] text-amber-700">
                      {mayDecide
                        ? tr("recorded when you approve", "dicatat saat Anda menyetujui")
                        : tr("sent with the question", "dikirim bersama pertanyaan")}
                    </p>
                  ) : (
                    <Button size="sm" variant="outline" disabled={busy} onClick={() => saveNote(l)}>
                      {tr("Record it", "Catat")}
                    </Button>
                  )
                )}
              </>
            ) : (
              !existing && !pending && <span className="text-[11px] text-slate-400">—</span>
            )}
            {pending && !noteOf(l).trim() && (
              <p className="mt-0.5 text-[11px] text-slate-500">
                {tr("sent with the question:", "dikirim bersama pertanyaan:")} <span className="text-slate-700">{pending}</span>
              </p>
            )}
            {existing && (
              <p className="mt-0.5 text-[11px] text-slate-600">
                {existing}{" "}
                <span className="text-slate-400">— {l.note?.recorded_by_email.split("@")[0]}</span>
              </p>
            )}
          </div>
        );
      },
    };
  }

  const waitingColumns: Column<PrLineView>[] = [
    itemColumn,
    instructionColumn("draft"),
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
      key: "asked",
      header: tr("Asked for", "Diminta"),
      align: "right",
      render: (l) => (
        <div className="whitespace-nowrap">
          <p className="tabular-nums font-medium text-slate-800">{formatIDR(l.item_total)}</p>
          {l.coverage.covered > 0 && (
            <p className="text-[11px] font-medium text-rose-600">
              {formatIDR(l.coverage.covered)} {tr("already paid", "sudah dibayar")}
            </p>
          )}
        </div>
      ),
    },
    {
      key: "pick",
      header: tr("Pick", "Pilih"),
      className: "whitespace-normal",
      render: (l) => {
        const on = picked[l.id] ?? false;
        return (
          /* Stops the click from opening the drawer: the row is a link, these
             controls are not. */
          <div className="w-[196px] space-y-1.5" onClick={(e) => e.stopPropagation()}>
            <label className="flex items-center gap-2 text-[13px] font-medium text-slate-700">
              <input
                id={`pick-${l.id}`}
                type="checkbox"
                checked={on}
                onChange={() => toggle(l)}
                className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-400"
              />
              {mayDecide ? tr("Approve this", "Setujui ini") : tr("Include in the ask", "Sertakan dalam permintaan")}
            </label>

            {/* The amounts only matter once it is picked, and showing four
                fields per row on a list nobody has ticked is noise. */}
            {on && (
              <>
                {l.qty != null && (
                  <div className="flex items-center gap-1.5">
                    <NumberInput
                      id={`mq-${l.id}`}
                      size="sm"
                      value={qtyOf(l)}
                      onChange={(v) => setQty(l, v)}
                      min={0}
                      className="w-20 text-right"
                    />
                    <span className="text-[11px] text-slate-400">{tr("of", "dari")} {formatNumber(l.qty)} {l.uom ?? ""}</span>
                  </div>
                )}
                <MoneyInput
                  id={`ma-${l.id}`}
                  size="sm"
                  value={amountOf(l)}
                  onChange={(v) => setAmountDraft((d) => ({ ...d, [l.id]: v }))}
                />
                {amountOf(l) !== l.item_total && (
                  <p className={cn(
                    "text-[11px]",
                    amountOf(l) > l.item_total ? "text-amber-700" : "text-brand-700",
                  )}>
                    {formatIDR(Math.abs(amountOf(l) - l.item_total))}{" "}
                    {amountOf(l) > l.item_total
                      ? tr("more than asked", "lebih dari yang diminta")
                      : tr("less than asked", "kurang dari yang diminta")}
                  </p>
                )}
              </>
            )}

            {!on && <StatusPill kind="line" status={l.status} />}
            {l.pending_request && (
              <p className="text-[11px] text-slate-500">
                {tr("asked", "ditanyakan ke")} {l.pending_request.sent_to_email.split("@")[0]} {tr("on chat", "di chat")} ·{" "}
                {new Date(l.pending_request.sent_at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
              </p>
            )}
          </div>
        );
      },
    },
  ];

  const payColumns: Column<PrLineView>[] = [
    itemColumn,
    instructionColumn("save"),
    {
      key: "approved",
      header: tr("Approved", "Disetujui"),
      align: "right",
      render: (l) => (
        <div className="whitespace-nowrap">
          <p className="tabular-nums text-slate-700">
            {formatIDR(l.approval?.approved_amount ?? l.item_total)}
          </p>
          {l.approval && (
            <p className="text-[11px] text-slate-400">
              {l.approval.recorded_by_email.split("@")[0]} · {l.approval.channel}
            </p>
          )}
        </div>
      ),
    },
    {
      key: "topay",
      header: tr("To pay", "Harus dibayar"),
      align: "right",
      render: (l) => (
        <div className="whitespace-nowrap">
          <p className="tabular-nums font-semibold text-slate-800">{formatIDR(l.coverage.remaining)}</p>
          {l.coverage.covered > 0 && (
            <p className="text-[11px] text-slate-500">{formatIDR(l.coverage.covered)} {tr("paid so far", "sudah dibayar")}</p>
          )}
        </div>
      ),
    },
    {
      key: "status",
      header: tr("Status", "Status"),
      /* One status for approved-and-unpaid, and no mention of which round the
         money came from. Cash is fungible: naming a round here would imply the
         money is being held for this line, and it is not (D126). */
      render: (l) => (
        <div className="whitespace-nowrap">
          <StatusPill kind="line" status={l.status} />
          <p className="mt-0.5 text-[11px] text-slate-500">{tr("not paid yet", "belum dibayar")}</p>
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        breadcrumb={tr("Procurement", "Pengadaan")}
        title={tr("Meeting board", "Papan rapat")}
        description={tr(
          "What is waiting to be decided, what has already been approved and not paid, and whether BCA 271 can cover it. Read in the room; the working detail lives on the requests board.",
          "Apa yang menunggu keputusan, apa yang sudah disetujui tapi belum dibayar, dan apakah BCA 271 cukup menutupinya. Dibaca di ruang rapat; detail kerjanya ada di papan permintaan.",
        )}
        actions={
          <Link href="/procurement/pr">
            <Button variant="outline" icon={ExternalLink}>{tr("Requests board", "Papan permintaan")}</Button>
          </Link>
        }
      />

      <Loaded state={lines} onRetry={reload}>
        {(all) => {
          const waiting = all.filter((l) => !l.approval?.approved && !l.removed_at);
          const toPay = all.filter((l) => l.approval?.approved && !l.coverage.settled && !l.removed_at);
          const paidUnapproved = waiting.filter((l) => l.coverage.covered > 0);
          const waitingTotal = waiting.reduce((s, l) => s + l.item_total, 0);
          const payTotal = toPay.reduce((s, l) => s + l.coverage.remaining, 0);

          const chosen = waiting.filter((l) => picked[l.id]);
          const chosenBare = chosen.filter((l) => !l.has_support);
          /* What is being approved and what still has to be paid are two
             different numbers, and on this board they are only the same when
             none of the picked lines has been paid already. A line bought
             first and approved later commits no new money: approving it is
             recording a decision about money that has gone (D124). */
          const chosenApproved = chosen.reduce((s, l) => s + amountOf(l), 0);
          const chosenTotal = chosen.reduce(
            (s, l) => s + Math.max(amountOf(l) - l.coverage.covered, 0), 0,
          );
          const chosenAlreadyPaid = chosenApproved - chosenTotal;

          return (
            <>
              <MoneyPanel lines={all} />

              {/* **Who decides, stated once and always visible.**
                  `ops_core.approvers()` is the only way a member of staff can
                  read this: `authorities_read` shows them their own row and
                  nothing else, so before 0159 the answer to *ke siapa?* did not
                  exist anywhere in the application. Both authorities are here
                  because both are asked for in this room — goods on this board,
                  funds on the payroll run and the funding round. */}
              {/* Not wrapped in `Loaded`: a five-row skeleton and a full-width
                  failure panel are the wrong weight for one line of context, and
                  the board is still usable without it. Absent while loading,
                  honest when it cannot be read — a board that silently stops
                  saying who decides is how this screen got here. */}
              {approvers.status === "failed" ? (
                <p className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-[12px] text-amber-800">
                  {tr(
                    "Could not read who holds the approval authorities, so this board cannot say who to ask.",
                    "Tidak bisa membaca siapa pemegang wewenang persetujuan, jadi papan ini tidak bisa menyebut siapa yang harus ditanya.",
                  )}{" "}
                  {stripRefs(approvers.error.message)}
                </p>
              ) : approvers.status === "ready" ? (
                (() => {
                  const goods = approvers.data.filter((a) => a.authority === "approve_goods");
                  const funds = approvers.data.filter((a) => a.authority === "approve_funds");
                  return (
                    <div className="mb-4 flex flex-wrap items-start gap-x-6 gap-y-1.5 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-[12px] shadow-card">
                      <span className="flex items-center gap-1.5 font-medium text-slate-700">
                        <ShieldCheck className="h-3.5 w-3.5 text-brand-600" />
                        {tr("Who decides", "Siapa yang memutuskan")}
                      </span>
                      <span className="text-slate-600">
                        <span className="text-slate-400">{tr("goods", "barang")} · </span>
                        {goods.length > 0
                          ? goods.map((a) => a.full_name).join(", ")
                          : <span className="text-amber-700">{tr("nobody — nothing can be approved", "tidak ada — tidak ada yang bisa disetujui")}</span>}
                      </span>
                      <span className="text-slate-600">
                        <span className="text-slate-400">{tr("funds", "dana")} · </span>
                        {funds.length > 0
                          ? funds.map((a) => a.full_name).join(", ")
                          : <span className="text-amber-700">{tr("nobody", "tidak ada")}</span>}
                      </span>
                      {/* An authority is granted in one place and read
                          everywhere; saying where it is granted stops this
                          becoming a list people ask IT to change by hand. */}
                      {can("it.read") && (
                        <Link
                          href="/it/pengguna"
                          className="ml-auto text-brand-700 underline-offset-2 hover:underline"
                        >
                          {tr("Change who holds it", "Ubah pemegangnya")}
                        </Link>
                      )}
                    </div>
                  );
                })()
              ) : null}

              {/* The confirm sits ABOVE the lists, with the total on it: a
                  meeting ticks its way down the page and then looks up to see
                  what it just committed to. Ticking writes nothing (D77). */}
              {chosen.length > 0 && (
                <div className="mb-4 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl border border-brand-300 bg-brand-50 px-4 py-3 shadow-card">
                  <p className="text-[13px] text-brand-900">
                    <span className="text-xl font-bold tabular-nums">{chosen.length}</span>{" "}
                    {chosen.length === 1 ? tr("item picked", "barang dipilih") : tr("items picked", "barang dipilih")}
                  </p>
                  <p className="text-[13px] text-brand-900">
                    <span className="text-xl font-bold tabular-nums">{formatIDR(chosenTotal)}</span>{" "}
                    {tr("to pay if this goes through", "harus dibayar jika ini disetujui")}
                    {chosenAlreadyPaid > 0 && (
                      <span className="block text-[12px] text-brand-800">
                        {formatIDR(chosenApproved)} {tr("approved, of which", "disetujui, dan")}{" "}
                        <strong className="tabular-nums">{formatIDR(chosenAlreadyPaid)}</strong>{" "}
                        {tr(
                          "has already left the account — approving it commits nothing more.",
                          "di antaranya sudah keluar dari rekening — menyetujuinya tidak menambah pengeluaran.",
                        )}
                      </span>
                    )}
                  </p>
                  {chosenBare.length > 0 && (
                    <p className="w-full text-[12px] text-amber-800">
                      {chosenBare.length === 1
                        ? tr(
                          "One of these has no document behind it and will be refused: ",
                          "Salah satunya tidak punya dokumen pendukung dan akan ditolak: ",
                        )
                        : tr(
                          `${chosenBare.length} of these have no document behind them and will be refused: `,
                          `${chosenBare.length} di antaranya tidak punya dokumen pendukung dan akan ditolak: `,
                        )}
                      {chosenBare.map((l) => l.line_no_full).join(", ")}.{" "}
                      {tr(
                        "Attach the link or the invoice on the requests board first.",
                        "Lampirkan link atau invoice di papan permintaan terlebih dulu.",
                      )}
                    </p>
                  )}
                  <div className="ml-auto flex flex-wrap items-center gap-2">
                    <Button variant="ghost" size="sm" onClick={() => setPicked({})} disabled={busy}>
                      {tr("Clear", "Kosongkan")}
                    </Button>
                    {mayDecide ? (
                      <Button size="sm" icon={Check} disabled={busy} onClick={() => approveSelected(chosen)}>
                        {busy
                          ? tr("Recording…", "Mencatat…")
                          : tr(
                            `Approve ${chosen.length} · ${formatIDR(chosenApproved)}`,
                            `Setujui ${chosen.length} · ${formatIDR(chosenApproved)}`,
                          )}
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        icon={Send}
                        disabled={busy || !mayAsk || !askingWho}
                        onClick={() => sendSelected(chosen)}
                      >
                        {busy
                          ? tr("Sending…", "Mengirim…")
                          : askingWho
                            ? tr(
                              `Ask ${askingWho.full_name} on Chat · ${formatIDR(chosenTotal)}`,
                              `Tanya ${askingWho.full_name} di Chat · ${formatIDR(chosenTotal)}`,
                            )
                            : tr("Nobody holds approve_goods", "Tidak ada yang memegang approve_goods")}
                      </Button>
                    )}
                  </div>
                  {!mayDecide && (
                    <div className="w-full space-y-1.5">
                      {/* **Who, before it is sent.** The board used to name the
                          recipient only in the toast afterwards, which is the
                          wrong moment: the question a person has as they reach
                          for the button is *who is this going to*. */}
                      {goodsApprovers.length > 1 ? (
                        <label
                          htmlFor="ask-to"
                          className="flex flex-wrap items-center gap-2 text-[12px] text-brand-900"
                        >
                          {tr("Ask", "Tanya")}
                          <select
                            id="ask-to"
                            value={askingWho?.email ?? ""}
                            onChange={(e) => setAskTo(e.target.value)}
                            className="rounded-lg border border-brand-300 bg-white px-2 py-1 text-[12px] text-slate-800 focus:border-brand-500 focus:outline-none"
                          >
                            {goodsApprovers.map((a) => (
                              <option key={a.email} value={a.email}>
                                {a.full_name} ({a.email})
                              </option>
                            ))}
                          </select>
                          {tr(
                            "— more than one person holds approve_goods, so the board does not pick for you.",
                            "— lebih dari satu orang memegang approve_goods, jadi papan ini tidak memilihkan untuk Anda.",
                          )}
                        </label>
                      ) : askingWho ? (
                        <p className="text-[12px] text-brand-900">
                          {tr("Going to", "Dikirim ke")} <strong>{askingWho.full_name}</strong>{" "}
                          <span className="text-brand-700">({askingWho.email})</span>{" "}
                          {tr(
                            "— the only account holding approve_goods.",
                            "— satu-satunya akun yang memegang approve_goods.",
                          )}
                        </p>
                      ) : (
                        <p className="text-[12px] text-amber-800">
                          {tr(
                            "No active account holds approve_goods, so there is nobody this can be sent to. IT grants it in Settings → People.",
                            "Tidak ada akun aktif yang memegang approve_goods, jadi tidak ada penerima untuk ini. IT memberikannya di Pengaturan → Pengguna.",
                          )}
                        </p>
                      )}
                      <p className="text-[12px] text-brand-800">
                        {tr(
                          "You are not the approver, so this does not record a yes — it puts the list in their chat with the amounts and what BCA 271 can cover, and their answer is recorded as theirs.",
                          "Anda bukan penyetuju, jadi ini tidak mencatat persetujuan — daftar ini dikirim ke chat mereka beserta jumlahnya dan berapa yang bisa ditutup BCA 271, lalu jawabannya dicatat atas nama mereka.",
                        )}
                      </p>
                    </div>
                  )}
                </div>
              )}

              {paidUnapproved.length > 0 && (
                <p className="mb-4 flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[13px] text-rose-800">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
                  <span>
                    {(() => {
                      const n = paidUnapproved.length;
                      const sum = formatIDR(paidUnapproved.reduce((s, l) => s + l.coverage.covered, 0));
                      return (
                        <>
                          <strong>{tr("Money moved before anyone approved it", "Uang keluar sebelum ada yang menyetujui")}</strong>{" "}
                          {tr(
                            `on ${n} item(s), ${sum} in total. They are in the first list, still waiting for a yes — paying something is not deciding it.`,
                            `pada ${n} barang, total ${sum}. Barang-barang itu ada di daftar pertama, masih menunggu persetujuan — membayar sesuatu bukan berarti memutuskannya.`,
                          )}
                        </>
                      );
                    })()}
                  </span>
                </p>
              )}

              <Card className="mb-5">
                <CardHeader
                  title={tr("Waiting for a decision", "Menunggu keputusan")}
                  subtitle={tr(
                    `${waiting.length} item(s) · ${formatIDR(waitingTotal)} asked for. Nothing moves until these are decided.`,
                    `${waiting.length} barang · ${formatIDR(waitingTotal)} diminta. Tidak ada yang bergerak sampai ini diputuskan.`,
                  )}
                  icon={Circle}
                  action={
                    <div className="flex flex-wrap items-center gap-2">
                      <SourceBadge state={lines} />
                      {mayAsk && <QuickAdd onAdded={reload} />}
                    </div>
                  }
                />
                <DataTable
                  dense
                  columns={waitingColumns}
                  rows={waiting}
                  rowKey={(l) => l.id}
                  onRowClick={setSelected}
                  empty={tr("Everything has been decided.", "Semua sudah diputuskan.")}
                />
              </Card>

              <Card>
                <CardHeader
                  title={tr("Approved — not paid yet", "Disetujui — belum dibayar")}
                  subtitle={tr(
                    `${toPay.length} item(s) · ${formatIDR(payTotal)} still to pay. This is the money that has to be in BCA 271.`,
                    `${toPay.length} barang · ${formatIDR(payTotal)} masih harus dibayar. Inilah uang yang harus ada di BCA 271.`,
                  )}
                  icon={Clock}
                />
                {/* The total belongs at the top: it is the answer, and the
                    rows underneath are the working. */}
                {toPay.length > 0 && (
                  <div className="flex flex-wrap items-baseline gap-x-3 border-b border-slate-100 bg-slate-50/70 px-4 py-2.5">
                    <span className="text-[13px] text-slate-600">{tr(`${toPay.length} item(s) to pay`, `${toPay.length} barang harus dibayar`)}</span>
                    <span className="text-lg font-bold tabular-nums tracking-tight text-slate-800">
                      {formatIDR(payTotal)}
                    </span>
                  </div>
                )}
                <DataTable
                  dense
                  columns={payColumns}
                  rows={toPay}
                  rowKey={(l) => l.id}
                  onRowClick={setSelected}
                  empty={tr("Nothing is approved and unpaid.", "Tidak ada yang disetujui dan belum dibayar.")}
                />
              </Card>
            </>
          );
        }}
      </Loaded>

      <LineDrawer
        line={selected}
        others={lines.status === "ready" ? lines.data : undefined}
        onClose={() => setSelected(null)}
        onChanged={(l) => { setSelected(l); reload(); }}
        onRemove={async (l) => {
          const res = await procurement.removeLine({ line_no: l.line_no_full });
          if (res.error) { toast("warning", tr("Not removed", "Tidak dihapus"), res.error.message); return; }
          toast("success", tr("Removed", "Dihapus"), tr(`${l.line_no_full} is no longer needed.`, `${l.line_no_full} tidak diperlukan lagi.`));
          setSelected(null);
          reload();
        }}
      />
    </div>
  );
}
