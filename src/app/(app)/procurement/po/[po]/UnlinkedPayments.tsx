"use client";

import { useState } from "react";
import { AlertTriangle, Link2 } from "lucide-react";
import { Button, Card, CardHeader } from "@/components/ui/primitives";
import { Loaded, useLoad } from "@/components/ui/loaded";
import { MoneyInput } from "@/components/ui/money-input";
import { formatIDR } from "@/lib/format";
import { useTr } from "@/lib/i18n";
import { accounting } from "@/demo/api";
import type { UnlinkedVendorPayment } from "@/services/accounting/contracts";
import { useToast } from "@/store/toast";

/** Payments to this order's vendor that reached no order (0196, ACC-002).
 *
 *  Booked from *New ledger entry* with no allocation, the money left the bank
 *  and this order never heard: it stays UNPAID, cannot close, and paying it
 *  again from *Pay this order* would pay the vendor twice. This card is where
 *  that money is applied to the order it paid — nothing new is posted.
 *
 *  Shown only to whoever holds `post_ledger`, the authority the seam asks for;
 *  and only while there is something to show.
 */
export function UnlinkedPayments({
  poNo, outstanding, onLinked,
}: { poNo: string; outstanding: number; onLinked: () => void }) {
  const tr = useTr();
  const [rows, reload] = useLoad(() => accounting.listUnlinkedVendorPayments({ po_no: poNo }), [poNo]);

  if (rows.status === "ready" && rows.data.length === 0) return null;

  return (
    <Card className="mb-4 border-amber-200">
      <CardHeader
        title={tr("Payments to this vendor not applied to any order", "Pembayaran ke vendor ini yang belum tertaut ke PO")}
        subtitle={tr(
          "Booked on the ledger without naming an order, so this order does not count them. Apply the one that paid this order — do not pay it again.",
          "Dicatat di Ledger tanpa menyebut PO, jadi PO ini tidak menghitungnya. Tautkan pembayaran yang memang untuk PO ini — jangan dibayar lagi.",
        )}
        icon={AlertTriangle}
      />
      <Loaded state={rows} onRetry={reload} skeletonRows={2}>
        {(list) => (
          <ul className="divide-y divide-slate-100 border-t border-slate-100">
            {list.map((p) => (
              <Row key={p.trx_no} p={p} poNo={poNo} outstanding={outstanding}
                onLinked={() => { reload(); onLinked(); }} />
            ))}
          </ul>
        )}
      </Loaded>
    </Card>
  );
}

function Row({
  p, poNo, outstanding, onLinked,
}: { p: UnlinkedVendorPayment; poNo: string; outstanding: number; onLinked: () => void }) {
  const tr = useTr();
  const { toast } = useToast();
  const [amount, setAmount] = useState(Math.min(p.unallocated, outstanding));
  const [busy, setBusy] = useState(false);
  const others = p.open_orders.filter((o) => o.po_no !== poNo).map((o) => o.po_no);

  async function link() {
    setBusy(true);
    const res = await accounting.linkPaymentToPo({ trx_no: p.trx_no, po_no: poNo, amount });
    setBusy(false);
    if (res.error) {
      toast(res.error.status === 403 ? "critical" : "warning", tr("Not applied", "Tidak jadi ditautkan"), res.error.message);
      return;
    }
    toast("success", tr(`${p.trx_no} applied to ${poNo}`, `${p.trx_no} ditautkan ke ${poNo}`), formatIDR(res.data.amount));
    onLinked();
  }

  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3 text-[13px]">
      <div className="min-w-0 flex-1">
        <p className="font-medium text-slate-800">
          <span className="font-mono text-[12px] text-slate-500">{p.trx_no}</span> · {p.trx_date} · {p.account_code}
        </p>
        <p className="truncate text-slate-600">{p.description}</p>
        <p className="text-[12px] text-slate-500">
          {tr(`${formatIDR(p.amount_idr)} paid, ${formatIDR(p.unallocated)} not applied to anything`,
            `${formatIDR(p.amount_idr)} dibayar, ${formatIDR(p.unallocated)} belum ditautkan ke apa pun`)}
          {others.length > 0 && tr(` · the vendor also has ${others.join(", ")} open`, ` · vendor ini juga punya ${others.join(", ")} yang terbuka`)}
        </p>
      </div>
      <div className="w-40"><MoneyInput value={amount} onChange={setAmount} /></div>
      <Button size="sm" icon={Link2} onClick={link}
        disabled={busy || !(amount > 0) || amount > p.unallocated}>
        {busy ? tr("Applying…", "Menautkan…") : tr("Apply to this order", "Tautkan ke PO ini")}
      </Button>
    </li>
  );
}
