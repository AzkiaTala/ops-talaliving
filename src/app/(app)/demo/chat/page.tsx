"use client";

import { useRef, useState } from "react";
import { MessagesSquare, Check, X, Bot, CheckCheck, Landmark, Upload, FileSignature } from "lucide-react";
import { Badge, Button, Card, CardHeader, EmptyState, PageHeader } from "@/components/ui/primitives";
import { Loaded, SourceBadge, useLoad } from "@/components/ui/loaded";
import { MoneyInput } from "@/components/ui/money-input";
import { NumberInput } from "@/components/ui/number-input";
import { formatIDR, formatNumber } from "@/lib/format";
import { cn } from "@/lib/cn";
import { procurement, accounting, documents } from "@/demo/api";
import type { ApprovalBatchView, ApprovalRequestView } from "@/services/procurement/contracts";
import { useDemo } from "@/demo/provider";
import { useToast } from "@/store/toast";
import { useTr } from "@/lib/i18n";

/** Google Chat, standing in for itself.
 *
 *  A leadership meeting runs on one laptop, open on whoever's account. Ticking
 *  the approval box there records that person as the approver, which is false
 *  — and false in the one place the system is meant to be trustworthy. So the
 *  question is sent here and answered by the approver's own account (D69).
 *
 *  It arrives as a LIST, not fifteen separate cards (D70). Somebody answering
 *  card by card has no idea what they have committed to until they add fifteen
 *  numbers up, so the card carries the three totals that matter: asked,
 *  approved so far, and what has to be paid — with the paying account's
 *  balance beside them, because "yes" and "we can afford it" are two
 *  different questions and only one of them is answered by the list.
 *
 *  In Phase 2 the card is posted by a worker subscribed to
 *  `procurement.approval.requested`, and answers arrive as a signed webhook.
 */
export default function ChatSimulatorPage() {
  const state = useDemo();
  const { toast } = useToast();
  const tr = useTr();
  const [asEmail, setAsEmail] = useState("evin@talaliving.com");
  const [batches, reload] = useLoad(() => procurement.listApprovalBatches({ pending: true }), []);
  const [accounts] = useLoad(() => accounting.listAccounts(), []);
  const balance = accounts.status === "ready"
    ? accounts.data.find((a) => a.code === "BCA 271")?.balance
    : undefined;

  return (
    <div>
      <PageHeader
        breadcrumb="Demo"
        title="Google Chat"
        description={tr(
          "The approval half that does not happen in this app. A list is sent here, the approver answers from their own account, and the decision is recorded against them — not against whoever's laptop the meeting is running on.",
          "Separuh persetujuan yang tidak terjadi di aplikasi ini. Daftar dikirim ke sini, penyetuju menjawab dari akunnya sendiri, dan keputusannya dicatat atas namanya — bukan atas nama pemilik laptop tempat rapat berjalan.",
        )}
      />

      <div className="mb-5 flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-card">
        <label htmlFor="as-who" className="text-[13px] text-slate-600">{tr("Answering as", "Menjawab sebagai")}</label>
        <select
          id="as-who"
          value={asEmail}
          onChange={(e) => setAsEmail(e.target.value)}
          className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-sm focus:border-brand-400 focus:outline-none"
        >
          {state.users.map((u) => (
            <option key={u.id} value={u.email}>{u.full_name} · {u.email}</option>
          ))}
        </select>
        <p className="text-[12px] text-slate-500">
          {tr(
            "Google says who this is; the app does not get a say. Answer somebody else's list and watch it be refused — that refusal is the reason this route exists.",
            "Google yang menentukan siapa ini; aplikasi tidak ikut menentukan. Jawab daftar milik orang lain dan lihat ditolak — penolakan itulah alasan jalur ini ada.",
          )}
        </p>
      </div>

      <SendProof asEmail={asEmail} />

      {/* The second road W2 named and that did not exist until D267: an order
          written by somebody without the authority to confirm it. The outbox
          event was already being written on `requestPoApproval`; what was
          missing was this card. */}
      <PoApprovalCards asEmail={asEmail} toast={toast} />

      <Card>
        <CardHeader
          title={tr("Waiting for an answer", "Menunggu jawaban")}
          subtitle={tr("One card per send, with everything that went out in it.", "Satu kartu per kiriman, berisi semua yang ikut dikirim.")}
          icon={MessagesSquare}
          action={<SourceBadge state={batches} />}
        />
        <Loaded state={batches} onRetry={reload}>
          {(rows) => rows.length === 0 ? (
            <div className="p-5">
              <EmptyState
                icon={MessagesSquare}
                title={tr("No lists waiting", "Tidak ada daftar yang menunggu")}
                description={tr(
                  "Send items from the requests board — the button appears when something is waiting for approval.",
                  "Kirim item dari papan permintaan — tombolnya muncul saat ada yang menunggu persetujuan.",
                )}
              />
            </div>
          ) : (
            <div className="space-y-5 p-5">
              {rows.map((b) => (
                <BatchCard
                  key={b.id}
                  batch={b}
                  asEmail={asEmail}
                  balance={balance}
                  onDone={reload}
                  toast={toast}
                />
              ))}
            </div>
          )}
        </Loaded>
      </Card>
    </div>
  );
}

function PoApprovalCards({
  asEmail, toast,
}: {
  asEmail: string;
  toast: (tone: "success" | "warning" | "critical", title: string, body?: string) => void;
}) {
  const tr = useTr();
  const [rows, reload] = useLoad(() => procurement.listPoApprovals({ pending: true }), []);
  const [busy, setBusy] = useState<string | null>(null);
  const [declining, setDeclining] = useState<string | null>(null);
  const [note, setNote] = useState("");

  async function answer(token: string, poNo: string, approved: boolean, text: string | null) {
    setBusy(token);
    const res = await procurement.answerPoFromChat({
      token, answered_by_email: asEmail, approved, note: text,
    });
    setBusy(null);
    if (res.error) {
      toast(res.error.status === 403 ? "critical" : "warning", tr("Not recorded", "Tidak tercatat"), res.error.message);
      return;
    }
    toast(
      "success",
      approved ? tr(`Confirmed ${poNo}`, `${poNo} dikonfirmasi`) : tr(`Declined ${poNo}`, `${poNo} ditolak`),
      tr(`Recorded as ${asEmail}, via chat`, `Dicatat sebagai ${asEmail}, lewat chat`),
    );
    setDeclining(null); setNote("");
    reload();
  }

  return (
    <Loaded state={rows} onRetry={reload}>
      {(list) => list.length === 0 ? <></> : (
        <Card className="mb-5">
          <CardHeader
            title={tr("Purchase orders waiting to be confirmed", "Purchase order yang menunggu dikonfirmasi")}
            subtitle={tr(
              "An order is a promise made to a supplier in the company's name. When the person writing it already holds the authority it is confirmed in the same act — asking yourself is theatre. When they do not, the question arrives here.",
              "Pesanan adalah janji kepada pemasok atas nama perusahaan. Kalau penulisnya sudah memegang wewenangnya, pesanan dikonfirmasi saat itu juga — bertanya ke diri sendiri hanya sandiwara. Kalau tidak, pertanyaannya datang ke sini.",
            )}
            icon={FileSignature}
            action={<SourceBadge state={rows} />}
          />
          <div className="space-y-5 p-5">
            {list.map((po) => (
              <div key={po.token} className="rounded-xl border border-slate-200 bg-white shadow-card">
                <div className="flex flex-wrap items-center gap-2.5 border-b border-slate-100 px-4 py-2.5">
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-brand-600 text-white">
                    <Bot className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-semibold text-slate-800">
                      OPS TALALIVING · {tr("purchase order for confirmation", "purchase order untuk dikonfirmasi")}
                    </p>
                    <p className="text-[11px] text-slate-400">
                      {po.po_no} · {tr("to", "kepada")} {po.sent_to_email} · {tr("sent by", "dikirim oleh")} {po.asked_by_email} ·{" "}
                      {new Date(po.asked_at).toLocaleString()}
                    </p>
                  </div>
                </div>

                <dl className="grid gap-x-6 gap-y-2 border-b border-slate-100 bg-slate-50/60 px-4 py-3 text-[13px] sm:grid-cols-3">
                  <div>
                    <dt className="text-[11px] uppercase tracking-wide text-slate-400">Vendor</dt>
                    <dd className="font-medium text-slate-800">{po.vendor_name}</dd>
                    {po.vendor_pic && <dd className="text-[11px] text-slate-500">{po.vendor_pic}</dd>}
                  </div>
                  <div>
                    <dt className="text-[11px] uppercase tracking-wide text-slate-400">{tr("Contract value", "Nilai kontrak")}</dt>
                    <dd className="tabular-nums font-medium text-slate-800">{formatIDR(po.contract_value)}</dd>
                    <dd className="text-[11px] text-slate-500">{tr(`${po.line_count} line${po.line_count === 1 ? "" : "s"}`, `${po.line_count} baris`)}</dd>
                  </div>
                  <div>
                    <dt className="text-[11px] uppercase tracking-wide text-slate-400">{tr("Expected", "Perkiraan tiba")}</dt>
                    {/* Missing, never a guess: an order with no agreed date is
                        the thing that makes a delivery merely absent (D134). */}
                    <dd className="font-medium text-slate-800">{po.expected_delivery ?? "—"}</dd>
                    {po.project_codes.length > 0 && (
                      <dd className="text-[11px] text-slate-500">{po.project_codes.join(" · ")}</dd>
                    )}
                  </div>
                </dl>

                {declining === po.token ? (
                  <div className="px-4 py-3">
                    <input
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      placeholder={tr("Why not? Somebody has to tell the supplier something.", "Kenapa tidak? Seseorang harus menyampaikan sesuatu ke pemasok.")}
                      className="h-9 w-full rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none"
                    />
                    <div className="mt-2 flex justify-end gap-2">
                      <Button size="sm" variant="ghost" onClick={() => { setDeclining(null); setNote(""); }}>
                        {tr("Cancel", "Batal")}
                      </Button>
                      <Button
                        size="sm" variant="danger" icon={X}
                        disabled={busy !== null}
                        onClick={() => answer(po.token, po.po_no, false, note)}
                      >
                        {tr("Decline", "Tolak")}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-wrap justify-end gap-2 px-4 py-3">
                    <Button
                      size="sm" variant="outline" icon={X}
                      disabled={busy !== null}
                      onClick={() => setDeclining(po.token)}
                    >
                      {tr("Decline", "Tolak")}
                    </Button>
                    <Button
                      size="sm" icon={Check}
                      disabled={busy !== null}
                      onClick={() => answer(po.token, po.po_no, true, null)}
                    >
                      {tr("Confirm this order", "Konfirmasi pesanan ini")}
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}
    </Loaded>
  );
}

function BatchCard({
  batch, asEmail, balance, onDone, toast,
}: {
  batch: ApprovalBatchView;
  asEmail: string;
  balance: number | undefined;
  onDone: () => void;
  toast: (tone: "success" | "warning" | "critical", title: string, body?: string) => void;
}) {
  const tr = useTr();
  const [busy, setBusy] = useState<string | null>(null);
  const mine = asEmail === batch.sent_to_email;
  const pending = batch.items.filter((i) => !i.answered_at);
  const shortfall = balance === undefined ? null : Math.max(batch.to_pay_total - balance, 0);

  async function answerOne(
    item: ApprovalRequestView, approved: boolean, qty: number | null, amount: number, instructions: string | null,
  ) {
    setBusy(item.id);
    const res = await procurement.answerFromChat({
      token: item.token, answered_by_email: asEmail, approved,
      approved_qty: qty, approved_amount: amount, instructions,
    });
    setBusy(null);
    if (res.error) {
      toast(res.error.status === 403 ? "critical" : "warning", tr("Not recorded", "Tidak tercatat"), res.error.message);
      return;
    }
    toast(
      "success",
      approved ? tr(`Approved ${formatIDR(amount)}`, `Disetujui ${formatIDR(amount)}`) : tr("Declined", "Ditolak"),
      tr(`Recorded as ${asEmail}, via chat`, `Dicatat sebagai ${asEmail}, lewat chat`),
    );
    onDone();
  }

  async function approveRest() {
    setBusy("all");
    const res = await procurement.answerBatch({ batch_token: batch.token, answered_by_email: asEmail });
    setBusy(null);
    if (res.error) {
      toast(res.error.status === 403 ? "critical" : "warning", tr("Not recorded", "Tidak tercatat"), res.error.message);
      return;
    }
    toast(
      "success",
      tr(`Approved ${res.data.answered} item(s)`, `${res.data.answered} item disetujui`),
      tr(
        `${formatIDR(res.data.to_pay_total)} to pay · recorded as ${asEmail}`,
        `${formatIDR(res.data.to_pay_total)} harus dibayar · dicatat sebagai ${asEmail}`,
      ),
    );
    onDone();
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-card">
      <div className="flex flex-wrap items-center gap-2.5 border-b border-slate-100 px-4 py-2.5">
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-brand-600 text-white">
          <Bot className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold text-slate-800">
            OPS TALALIVING · {tr(
              `${batch.items.length} item${batch.items.length === 1 ? "" : "s"} for approval`,
              `${batch.items.length} item untuk disetujui`,
            )}
          </p>
          <p className="text-[11px] text-slate-400">
            {batch.batch_no} · {tr("to", "kepada")} {batch.sent_to_email} · {tr("sent by", "dikirim oleh")} {batch.sent_by_email} ·{" "}
            {new Date(batch.sent_at).toLocaleString()}
          </p>
        </div>
        {batch.answered > 0 && <Badge tone="slate">{tr(`${batch.answered} answered`, `${batch.answered} dijawab`)}</Badge>}
      </div>

      {/* The three totals, so a yes is not a number somebody has to add up. */}
      <dl className="grid gap-x-6 gap-y-2 border-b border-slate-100 bg-slate-50/60 px-4 py-3 text-[13px] sm:grid-cols-4">
        <div>
          <dt className="text-[11px] uppercase tracking-wide text-slate-400">{tr("Asked for", "Diminta")}</dt>
          <dd className="tabular-nums font-medium text-slate-800">{formatIDR(batch.requested_total)}</dd>
        </div>
        <div>
          <dt className="text-[11px] uppercase tracking-wide text-slate-400">{tr("Approved so far", "Disetujui sejauh ini")}</dt>
          <dd className="tabular-nums font-medium text-emerald-700">{formatIDR(batch.approved_total)}</dd>
        </div>
        <div>
          <dt className="text-[11px] uppercase tracking-wide text-slate-400">{tr("Has to be paid", "Harus dibayar")}</dt>
          <dd className="tabular-nums font-medium text-slate-800">{formatIDR(batch.to_pay_total)}</dd>
        </div>
        <div>
          <dt className="flex items-center gap-1 text-[11px] uppercase tracking-wide text-slate-400">
            <Landmark className="h-3 w-3" /> BCA 271
          </dt>
          <dd className={cn(
            "tabular-nums font-medium",
            shortfall === null ? "text-slate-400" : shortfall > 0 ? "text-amber-700" : "text-slate-800",
          )}>
            {balance === undefined ? "—" : formatIDR(balance)}
            {shortfall !== null && shortfall > 0 && (
              <span className="block text-[11px] font-normal text-amber-700">
                {tr("top up", "isi ulang")} {formatIDR(shortfall)}
              </span>
            )}
          </dd>
        </div>
      </dl>

      <ul className="divide-y divide-slate-100">
        {batch.items.map((item) => (
          <ChatItem
            key={item.id}
            item={item}
            busy={busy === item.id}
            onAnswer={answerOne}
          />
        ))}
      </ul>

      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 px-4 py-3">
        {!mine && (
          <p className="mr-auto text-[12px] text-amber-700">
            {tr("This list belongs to", "Daftar ini milik")} {batch.sent_to_email}.
          </p>
        )}
        {pending.length > 0 && (
          <Button size="sm" icon={CheckCheck} disabled={busy !== null} onClick={approveRest}>
            {busy === "all"
              ? tr("Recording…", "Mencatat…")
              : tr(
                `Approve the remaining ${pending.length} as asked · ${formatIDR(pending.reduce((s, i) => s + i.item_total, 0))}`,
                `Setujui ${pending.length} sisanya sesuai permintaan · ${formatIDR(pending.reduce((s, i) => s + i.item_total, 0))}`,
              )}
          </Button>
        )}
      </div>
    </div>
  );
}

function ChatItem({
  item, busy, onAnswer,
}: {
  item: ApprovalRequestView;
  busy: boolean;
  onAnswer: (
    item: ApprovalRequestView, approved: boolean, qty: number | null, amount: number, instructions: string | null,
  ) => void;
}) {
  const tr = useTr();
  const [qty, setQty] = useState<number>(item.qty ?? 0);
  const [amount, setAmount] = useState<number>(item.item_total);
  /* Prefilled with what the room said, so the approver reading this on a phone
     has the context the meeting had. Sending it back unchanged makes it theirs
     — visibly, in a field they can edit (D127). */
  const [instructions, setInstructions] = useState(item.meeting_note ?? "");

  if (item.answered_at) {
    return (
      <li className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-[13px]">
        <span className="min-w-0 flex-1">
          <span className="font-medium text-slate-700">{item.description}</span>
          <span className="ml-2 font-mono text-[10px] text-slate-400">{item.line_no_full}</span>
        </span>
        <Badge tone={item.outcome === "approved" ? "green" : "slate"}>
          {item.outcome === "approved"
            ? tr(`approved ${formatIDR(item.approved_amount ?? 0)}`, `disetujui ${formatIDR(item.approved_amount ?? 0)}`)
            : tr("not yet", "belum")}
        </Badge>
      </li>
    );
  }

  return (
    <li className="space-y-2.5 px-4 py-3">
      <div>
        <p className="text-[14px] font-medium text-slate-800">{item.description}</p>
        {item.purpose && <p className="text-[13px] text-slate-600">{item.purpose}</p>}
        <p className="font-mono text-[10px] text-slate-400">
          {item.line_no_full} · {item.requested_by_name}
          {item.project_code && ` · ${item.project_code}`}
          {item.vendor_name && ` · ${item.vendor_name}`}
          {item.qty != null && ` · ${formatNumber(item.qty)} ${item.uom ?? ""} × ${formatIDR(item.unit_price ?? 0)}`}
        </p>
      </div>

      <div className="grid gap-2.5 sm:grid-cols-4">
        {item.qty != null && (
          <div>
            <label htmlFor={`q-${item.id}`} className="block text-[11px] text-slate-500">{tr("How many", "Berapa banyak")}</label>
            <NumberInput
              id={`q-${item.id}`}
              size="sm"
              value={qty}
              min={0}
              max={item.qty ?? undefined}
              onChange={(v) => {
                setQty(v);
                if (item.unit_price != null) setAmount(Math.round(v * item.unit_price));
              }}
              className="mt-1"
            />
          </div>
        )}
        <div>
          <label htmlFor={`a-${item.id}`} className="block text-[11px] text-slate-500">
            {tr("For how much", "Berapa nilainya")} <span className="text-slate-400">{tr("of", "dari")} {formatIDR(item.item_total)}</span>
          </label>
          <MoneyInput id={`a-${item.id}`} size="sm" value={amount} onChange={setAmount} className="mt-1" />
          {amount !== item.item_total && (
            <p className={cn("mt-1 text-[11px]", amount > item.item_total ? "text-amber-700" : "text-brand-700")}>
              {amount > item.item_total
                ? tr(`${formatIDR(Math.abs(amount - item.item_total))} more than asked`, `${formatIDR(Math.abs(amount - item.item_total))} lebih dari yang diminta`)
                : tr(`${formatIDR(Math.abs(amount - item.item_total))} less than asked`, `${formatIDR(Math.abs(amount - item.item_total))} kurang dari yang diminta`)}
            </p>
          )}
        </div>
        <div className="sm:col-span-2">
          <label htmlFor={`i-${item.id}`} className="block text-[11px] text-slate-500">
            {tr("Instructions (optional)", "Instruksi (opsional)")}
            {item.meeting_note && (
              <span className="ml-1 text-slate-400">{tr("— from the meeting, edit or send as is", "— dari rapat, ubah atau kirim apa adanya")}</span>
            )}
          </label>
          <input
            id={`i-${item.id}`}
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            placeholder={tr("e.g. Negotiate first", "mis. Negosiasi dulu")}
            className="mt-1 h-8 w-full rounded-lg border border-slate-200 px-2 text-[13px] focus:border-brand-400 focus:outline-none"
          />
        </div>
      </div>

      <div className="flex flex-wrap justify-end gap-2">
        <Button
          variant="outline" size="sm" icon={X} disabled={busy}
          onClick={() => onAnswer(item, false, null, amount, instructions || null)}
        >
          {tr("Not yet", "Belum")}
        </Button>
        <Button
          size="sm" icon={Check} disabled={busy}
          onClick={() => onAnswer(item, true, item.qty != null ? qty : null, amount, instructions || null)}
        >
          {busy ? tr("Sending…", "Mengirim…") : tr(`Approve ${formatIDR(amount)}`, `Setujui ${formatIDR(amount)}`)}
        </Button>
      </div>
    </li>
  );
}

/** Leadership dropping a transfer receipt into the chat.
 *
 *  This is how the money usually announces itself: the transfer is made from
 *  a phone, and the proof lands in a chat thread rather than in anybody's
 *  ledger. Nothing is booked by this — it joins the queue of things waiting
 *  for somebody in accounting to agree with the number (D81, A13).
 */
function SendProof({ asEmail }: { asEmail: string }) {
  const { toast } = useToast();
  const tr = useTr();
  const [amount, setAmount] = useState(0);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);

  async function send() {
    if (!file) { toast("warning", tr("No file", "Tidak ada berkas"), tr("A transfer proof is a document, not a number.", "Bukti transfer adalah dokumen, bukan angka.")); return; }
    setBusy(true);
    const res = await documents.uploadToInbox({
      file,
      origin: "chat",
      money_direction: "IN",
      amount_idr: amount || null,
      note: note.trim() || `Transfer into BCA 271, sent by ${asEmail}`,
    });
    setBusy(false);
    if (res.error) { toast("critical", tr("Not sent", "Tidak terkirim"), res.error.message); return; }
    toast(
      "success",
      tr("Sent to accounting", "Terkirim ke accounting"),
      tr("It is waiting to be booked — nothing has reached the ledger yet.", "Menunggu dibukukan — belum ada yang masuk buku besar."),
    );
    setFile(null); setAmount(0); setNote("");
  }

  return (
    <div className="mb-5 rounded-xl border border-slate-200 bg-white px-4 py-3.5 shadow-card">
      <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
        <Upload className="h-3.5 w-3.5" /> {tr("Send a transfer proof", "Kirim bukti transfer")}
      </p>
      <p className="mt-1 text-[12px] text-slate-500">
        {tr(
          "The other half of the round: leadership makes the transfer from a phone and drops the receipt here. It joins the queue on the payment-round screen and is booked by whoever writes the ledger — sending it books nothing.",
          "Separuh lain dari putaran: pimpinan mentransfer dari ponsel dan menaruh buktinya di sini. Bukti itu masuk antrean di layar putaran pembayaran dan dibukukan oleh yang menulis buku besar — mengirimnya tidak membukukan apa pun.",
        )}
      </p>
      <div className="mt-3 grid gap-3 sm:grid-cols-4">
        <div>
          <label htmlFor="sp-amount" className="block text-xs text-slate-500">{tr("Amount", "Jumlah")}</label>
          <MoneyInput id="sp-amount" size="sm" value={amount} onChange={setAmount} className="mt-1" />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="sp-note" className="block text-xs text-slate-500">{tr("Note", "Catatan")}</label>
          <input
            id="sp-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={tr("e.g. Top-up BCA 271 for this week's round", "mis. Isi ulang BCA 271 untuk putaran minggu ini")}
            className="mt-1 h-8 w-full rounded-lg border border-slate-200 px-2 text-[13px] focus:border-brand-400 focus:outline-none"
          />
        </div>
        <div className="flex items-end gap-2">
          <input
            ref={fileRef} id="sp-file" type="file" className="hidden"
            onChange={(e) => { setFile(e.target.files?.[0] ?? null); e.target.value = ""; }}
          />
          <Button variant="outline" size="sm" icon={Upload} onClick={() => fileRef.current?.click()}>
            <span className="max-w-[120px] truncate">{file ? file.name : tr("Choose", "Pilih")}</span>
          </Button>
          <Button size="sm" disabled={busy || !file} onClick={send}>
            {busy ? tr("Sending…", "Mengirim…") : tr("Send", "Kirim")}
          </Button>
        </div>
      </div>
    </div>
  );
}
