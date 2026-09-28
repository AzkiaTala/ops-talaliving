"use client";

import { useState } from "react";
import { Lock, AlertTriangle } from "lucide-react";
import { Modal } from "@/components/ui/drawer";
import { Button } from "@/components/ui/primitives";
import { procurement } from "@/demo/api";
import { useToast } from "@/store/toast";
import { useTr } from "@/lib/i18n";

/** Declaring an order finished.
 *
 *  Refused while either axis disagrees — money and goods are never collapsed
 *  (A1) — and refused while nothing is filed against it. A written reason is
 *  the way past that, because real orders end untidily: the last two sheets
 *  were never delivered and nobody is going to chase them. What is not
 *  acceptable is an order that quietly closes as if it had finished cleanly,
 *  which is why the reason is kept on the audit row (D130).
 */
export function ClosePo({
  poNo, blockers, onClose, onClosed,
}: {
  poNo: string;
  blockers: string[];
  onClose: () => void;
  onClosed: () => void;
}) {
  const tr = useTr();
  const { toast } = useToast();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const clean = blockers.length === 0;

  async function close() {
    setBusy(true);
    const res = await procurement.closePo({ po_no: poNo, settle_reason: reason.trim() || null });
    setBusy(false);
    if (res.error) {
      toast(res.error.status === 409 ? "critical" : "warning", tr("Not closed", "Tidak ditutup"), res.error.message);
      return;
    }
    toast(
      "success",
      tr(`${poNo} closed`, `${poNo} ditutup`),
      clean ? tr("Everything matched.", "Semuanya cocok.") : tr("Closed early, with the reason on the record.", "Ditutup lebih awal, dengan alasan tercatat."),
    );
    onClosed();
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={tr(`Close ${poNo}`, `Tutup ${poNo}`)}
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>{tr("Cancel", "Batal")}</Button>
          <Button icon={Lock} onClick={close} disabled={busy || (!clean && !reason.trim())}>
            {busy ? tr("Closing…", "Menutup…") : clean ? tr("Close it", "Tutup") : tr("Close it anyway", "Tetap tutup")}
          </Button>
        </div>
      }
    >
      {clean ? (
        <p className="text-[13px] text-slate-600">
          {tr(
            "Everything ordered has arrived, everything has been paid, and the evidence is filed. Closing it just says so.",
            "Semua yang dipesan sudah tiba, semua sudah dibayar, dan buktinya sudah diarsipkan. Menutupnya hanya menyatakan hal itu.",
          )}
        </p>
      ) : (
        <div className="space-y-3">
          <div className="rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-2.5">
            <p className="flex items-center gap-1.5 text-[13px] font-medium text-amber-900">
              <AlertTriangle className="h-4 w-4" /> {tr("This order is not finished", "Order ini belum selesai")}
            </p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5 text-[12px] text-amber-900">
              {blockers.map((b) => <li key={b}>{b}</li>)}
            </ul>
          </div>
          <div>
            <label htmlFor="cl-reason" className="block text-xs text-slate-500">{tr("Why close it anyway", "Mengapa tetap ditutup")}</label>
            <input
              id="cl-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={tr(
                "e.g. the last two sheets were written off — vendor agreed, nothing more is coming",
                "mis. dua lembar terakhir dihapuskan — vendor setuju, tidak ada lagi yang akan datang",
              )}
              className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none"
            />
            <p className="mt-1 text-[11px] text-slate-500">
              {tr(
                "Required, and kept on the record. In six months this sentence is the only thing that explains why the numbers do not match.",
                "Wajib, dan disimpan dalam catatan. Enam bulan lagi, kalimat ini satu-satunya yang menjelaskan mengapa angkanya tidak cocok.",
              )}
            </p>
          </div>
        </div>
      )}
    </Modal>
  );
}
