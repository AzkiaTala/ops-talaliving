"use client";

import { TypeOptions } from "@/components/ui/type-options";
import { useEffect, useRef, useState } from "react";
import { Banknote, Upload } from "lucide-react";
import { Button, Card, CardHeader } from "@/components/ui/primitives";
import { MoneyInput } from "@/components/ui/money-input";
import { formatIDR } from "@/lib/format";
import { useTr } from "@/lib/i18n";
import { accounting, documents } from "@/demo/api";
import type { PoDetail } from "@/services/procurement/contracts";
import type { AccountBalance, TransactionTypeCode } from "@/services/accounting/contracts";
import { useToast } from "@/store/toast";
import { useSession } from "@/store/session";

/** Paying an order from its own page (B8).
 *
 *  Until this existed the only road for money was a request line, so an
 *  order's deposit could fall due with no button anywhere that paid it, and a
 *  line paid instead left the order reading UNPAID (F149). `post_to_po` writes
 *  one ledger row and splits it across the order's linked request lines by
 *  value — so the requests board and this page agree without anybody pointing
 *  the money twice.
 *
 *  The same two questions as `PayFromLine`: may this person work in
 *  accounting, and do they hold `post_ledger` (D24). The amount starts at what
 *  is payable now, because that is the number somebody is looking at when they
 *  open this.
 */
export function PayPo({ po, onPosted }: { po: PoDetail; onPosted: () => void }) {
  const tr = useTr();
  const { can, hasAuthority } = useSession();
  const { toast } = useToast();
  const mayPost = can("accounting.create") && hasAuthority("post_ledger");
  const outstanding = Math.max(po.status_view.outstanding, 0);
  const [accounts, setAccounts] = useState<AccountBalance[]>([]);
  const [accountId, setAccountId] = useState("");
  const [amount, setAmount] = useState(po.payable_now || outstanding);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [type, setType] = useState<TransactionTypeCode>("SUPPLIERS");
  const [file, setFile] = useState<File | null>(null);
  const [posting, setPosting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!mayPost) return;
    void accounting.listAccounts().then((r) => {
      if (!r.data) return;
      const paying = r.data.filter((a) => a.is_paying && a.is_active !== false);
      setAccounts(paying);
      setAccountId((cur) => cur || paying[0]?.account_id || "");
    });
  }, [mayPost]);

  useEffect(() => { setAmount(po.payable_now || outstanding); }, [po.po_no, po.payable_now, outstanding]);

  if (!mayPost || po.status !== "ISSUED" || outstanding <= 0) return null;
  const linked = po.lines.filter((l) => l.pr_line_no).length;

  async function post() {
    if (!file) {
      toast("warning", tr("Proof first", "Bukti dulu"), tr("A payment is recorded with its proof — the transfer receipt.", "Pembayaran dicatat bersama buktinya — bukti transfer."));
      return;
    }
    setPosting(true);
    const up = await documents.upload({ file, kind: "Payment Proof" });
    if (up.error) { setPosting(false); toast("critical", tr("Upload failed", "Unggah gagal"), up.error.message); return; }
    await documents.link({ attachment_id: up.data.id, entity: "po", entity_no: po.po_no, kind: "Payment Proof" });
    const res = await accounting.postToPo({
      po_no: po.po_no, amount, account_id: accountId, trx_date: date, type_code: type,
      attachment_id: up.data.id,
    });
    setPosting(false);
    if (res.error) {
      toast(res.error.status === 409 ? "warning" : "critical", tr("Not posted", "Tidak dicatat"), res.error.message);
      return;
    }
    toast("success", tr(`Posted as ${res.data.trx_no}`, `Dicatat sebagai ${res.data.trx_no}`), `${formatIDR(amount)} · ${po.po_no}`);
    setFile(null);
    onPosted();
  }

  return (
    <Card className="mb-4">
      <CardHeader
        title={tr("Pay this order", "Bayar order ini")}
        subtitle={linked > 0
          ? tr(
            `One ledger row, shared across the ${linked} request line(s) this order buys by their value — the requests board sees it too.`,
            `Satu baris buku besar, dibagi ke ${linked} baris permintaan yang dibeli order ini menurut nilainya — papan permintaan juga melihatnya.`,
          )
          : tr("One ledger row, counted against this order.", "Satu baris buku besar, dihitung terhadap order ini.")}
        icon={Banknote}
      />
      <div className="grid gap-3 px-5 pb-5 sm:grid-cols-2">
        <div>
          <label htmlFor="po-pay-date" className="block text-xs text-slate-500">{tr("Date paid", "Tanggal bayar")}</label>
          <input id="po-pay-date" type="date" value={date} onChange={(e) => setDate(e.target.value)}
            className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm focus:border-brand-400 focus:outline-none" />
        </div>
        <div>
          <label htmlFor="po-pay-amount" className="block text-xs text-slate-500">{tr("Amount paid", "Jumlah dibayar")}</label>
          <MoneyInput id="po-pay-amount" value={amount} onChange={setAmount} className="mt-1" />
          <p className="mt-1 text-[11px] text-slate-500">
            {tr(
              `Payable now ${formatIDR(po.payable_now)} · outstanding ${formatIDR(outstanding)}`,
              `Wajib dibayar sekarang ${formatIDR(po.payable_now)} · sisa ${formatIDR(outstanding)}`,
            )}
          </p>
        </div>
        <div>
          <label htmlFor="po-pay-account" className="block text-xs text-slate-500">{tr("Paid from", "Dibayar dari")}</label>
          <select id="po-pay-account" value={accountId} onChange={(e) => setAccountId(e.target.value)}
            className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm focus:border-brand-400 focus:outline-none">
            {accounts.map((a) => <option key={a.account_id} value={a.account_id}>{a.name}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="po-pay-type" className="block text-xs text-slate-500">{tr("Ledger type", "Jenis buku besar")}</label>
          <select id="po-pay-type" value={type} onChange={(e) => setType(e.target.value as TransactionTypeCode)}
            className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm focus:border-brand-400 focus:outline-none">
            <TypeOptions current={type} />
          </select>
        </div>
        <div className="sm:col-span-2">
          <input ref={fileRef} type="file" className="hidden"
            onChange={(e) => { setFile(e.target.files?.[0] ?? null); e.target.value = ""; }} />
          <Button variant="outline" size="sm" icon={Upload} onClick={() => fileRef.current?.click()}>
            {file ? file.name : tr("Attach the payment proof", "Lampirkan bukti pembayaran")}
          </Button>
          {amount > outstanding && (
            <p className="mt-2 text-[12px] text-amber-800">
              {tr(
                `Only ${formatIDR(outstanding)} is outstanding. Money beyond the contract is a question for the vendor.`,
                `Sisa hanya ${formatIDR(outstanding)}. Uang di luar kontrak adalah urusan dengan vendor.`,
              )}
            </p>
          )}
          <Button size="sm" className="mt-3 w-full" onClick={post}
            disabled={posting || !accountId || amount <= 0 || amount > outstanding || !file}>
            {posting ? tr("Posting…", "Mencatat…") : tr(`Post ${formatIDR(amount)} to the ledger`, `Catat ${formatIDR(amount)} ke buku besar`)}
          </Button>
        </div>
      </div>
    </Card>
  );
}
