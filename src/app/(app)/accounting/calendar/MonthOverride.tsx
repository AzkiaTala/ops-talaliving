"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/drawer";
import { Button } from "@/components/ui/primitives";
import { MoneyInput } from "@/components/ui/money-input";
import { formatIDR } from "@/lib/format";
import { accounting } from "@/demo/api";
import type { CashCell, CashRow } from "@/services/accounting/contracts";
import { useToast } from "@/store/toast";
import { useTr } from "@/lib/i18n";

/** One month that is not like the others.
 *
 *  December's payroll carries the THR; the month the stationery order was
 *  pulled forward has no stationery in it. Both are exceptions to a standing
 *  estimate, not a new estimate — changing the line itself would move every
 *  month after it too, which is how a plan silently drifts.
 *
 *  The reason is required. In three months nobody remembers why one cell is
 *  bigger, including the person who typed it.
 */
export function MonthOverride({
  row, cell, onClose, onSaved,
}: {
  row: CashRow;
  cell: CashCell;
  onClose: () => void;
  onSaved: () => void;
}) {
  const tr = useTr();
  const { toast } = useToast();
  const [amount, setAmount] = useState(cell.planned || row.component.amount);
  const [skip, setSkip] = useState(cell.state === "SKIPPED");
  const [reason, setReason] = useState(cell.reason ?? "");
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    const res = await accounting.setOverride({
      component_id: row.component.id,
      month: cell.month,
      amount: skip ? null : amount,
      reason,
    });
    setBusy(false);
    if (res.error) {
      toast(res.error.status === 403 ? "critical" : "warning", tr("Not changed", "Tidak diubah"), res.error.message);
      return;
    }
    toast("success", tr(`${cell.month} changed`, `${cell.month} diubah`),
      skip
        ? tr(`${row.component.name} is not planned for that month.`, `${row.component.name} tidak direncanakan untuk bulan itu.`)
        : `${row.component.name} · ${formatIDR(amount)}`);
    onSaved();
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`${row.component.name} — ${cell.month}`}
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>{tr("Cancel", "Batal")}</Button>
          <Button onClick={save} disabled={busy || !reason.trim()}>
            {busy ? tr("Saving…", "Menyimpan…") : tr("Change this month", "Ubah bulan ini")}
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        <p className="text-[13px] text-slate-600">
          {tr("Every other month stays at", "Bulan-bulan lain tetap")} <strong className="tabular-nums">{formatIDR(row.component.amount)}</strong>.
          {cell.actual > 0 && (
            <> {tr(`So far ${formatIDR(cell.actual)} has actually gone out in ${cell.month}.`, `Sejauh ini ${formatIDR(cell.actual)} benar-benar sudah keluar di ${cell.month}.`)}</>
          )}
        </p>

        <label className="flex items-start gap-2 text-[13px] text-slate-700">
          <input
            type="checkbox"
            checked={skip}
            onChange={(e) => setSkip(e.target.checked)}
            className="mt-0.5 h-3.5 w-3.5 rounded border-slate-300"
          />
          <span>{tr("Nothing this month — the bill does not arrive, or it was paid early.", "Tidak ada bulan ini — tagihannya tidak datang, atau sudah dibayar lebih awal.")}</span>
        </label>

        {!skip && (
          <div>
            <label htmlFor="ov-amount" className="block text-xs text-slate-500">{tr("This month instead", "Untuk bulan ini")}</label>
            <MoneyInput id="ov-amount" value={amount} onChange={setAmount} className="mt-1" />
          </div>
        )}

        <div>
          <label htmlFor="ov-reason" className="block text-xs text-slate-500">{tr("Why this month differs", "Mengapa bulan ini berbeda")}</label>
          <input
            id="ov-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={tr("e.g. THR — the December run carries the holiday allowance", "mis. THR — penggajian Desember membawa tunjangan hari raya")}
            className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none"
          />
          <p className="mt-1 text-[11px] text-slate-500">
            {tr("Required. It shows on the cell, so the next person reading the plan does not have to guess.",
              "Wajib. Alasan ini tampil di sel, sehingga orang berikutnya yang membaca rencana tidak perlu menebak.")}
          </p>
        </div>
      </div>
    </Modal>
  );
}
