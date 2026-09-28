"use client";

import { useState } from "react";
import { Flag, Undo2 } from "lucide-react";
import { Modal } from "@/components/ui/drawer";
import { Button } from "@/components/ui/primitives";
import { Loaded, useLoad } from "@/components/ui/loaded";
import { hr } from "@/demo/api";
import { DAY_MARK_LABEL, type DayMarkKind } from "@/services/hr/contracts";
import { useToast } from "@/store/toast";
import { useTr, type Message } from "@/lib/i18n";

/** What happened to a whole date.
 *
 *  A public holiday is not marked person by person — it is a fact about the
 *  day, so the mark carries no employee at all and covers everybody who was on
 *  the books. The same is true of the afternoon the power went, or the morning
 *  the office closed for a funeral.
 *
 *  Marking never touches a tap. Somebody who came in on the tanggal merah still
 *  has their scans; what changes is that those hours are lembur rather than an
 *  ordinary day (D142).
 */
const NOTE: Record<DayMarkKind, Message> = {
  holiday: {
    en: "Everybody who scanned gets those hours as overtime; nobody loses a day for not coming.",
    id: "Semua yang tap mendapat jam itu sebagai lembur; tidak ada yang kehilangan hari karena tidak datang.",
  },
  half_day: {
    en: "Counted as 0.5 day for everybody — office event, accident, blackout.",
    id: "Dihitung 0,5 hari untuk semua orang — acara kantor, kecelakaan, listrik padam.",
  },
  absent: {
    en: "For a whole date this is unusual — normally an absence belongs to one person, from their own cell.",
    id: "Untuk satu tanggal penuh ini tidak biasa — biasanya absen milik satu orang, dari selnya sendiri.",
  },
  sick: {
    en: "For a whole date this is unusual — sickness belongs to one person, from their own cell.",
    id: "Untuk satu tanggal penuh ini tidak biasa — sakit milik satu orang, dari selnya sendiri.",
  },
  leave: {
    en: "Collective leave (cuti bersama) — nobody is counted as working.",
    id: "Cuti bersama — tidak ada yang dihitung bekerja.",
  },
  permit: {
    en: "Permit (izin) for the whole office — nobody is counted as working.",
    id: "Izin untuk seluruh kantor — tidak ada yang dihitung bekerja.",
  },
};

export function MarkDay({
  date, onClose, onDone,
}: {
  date: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const tr = useTr();
  const { toast } = useToast();
  const [sheet, reload] = useLoad(() => hr.getTimesheet({ from: date, to: date }), [date]);
  const [kind, setKind] = useState<DayMarkKind>("holiday");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  /* A mark is withdrawn rather than deleted, and a withdrawal with no sentence
     is refused by the database (C19). */
  const [undoing, setUndoing] = useState(false);
  const [undoReason, setUndoReason] = useState("");

  async function mark() {
    setBusy(true);
    const res = await hr.markDay({ work_date: date, kind, reason });
    setBusy(false);
    if (res.error) {
      toast(res.error.status === 403 ? "critical" : "warning", tr("Not marked", "Tidak ditandai"), res.error.message);
      return;
    }
    toast("success", tr("Day marked", "Hari ditandai"), tr(`${date} · ${DAY_MARK_LABEL[res.data.kind]} · whole office`, `${date} · ${DAY_MARK_LABEL[res.data.kind]} · seluruh kantor`));
    onDone();
  }

  async function unmark(markId: string) {
    setBusy(true);
    const res = await hr.unmarkDay(markId, undoReason);
    setBusy(false);
    if (res.error) {
      toast(res.error.status === 403 ? "critical" : "warning", tr("Not removed", "Tidak dihapus"), res.error.message);
      return;
    }
    setUndoing(false); setUndoReason("");
    toast("success", tr("Mark withdrawn", "Tanda ditarik"), tr(`${date} is back to what the machine recorded.`, `${date} kembali ke yang direkam mesin.`));
    reload();
    onDone();
  }

  return (
    <Modal
      open onClose={onClose} width="max-w-lg"
      title={tr(`Mark ${date}`, `Tandai ${date}`)}
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>{tr("Cancel", "Batal")}</Button>
          <Button icon={Flag} onClick={mark} disabled={busy || !reason.trim()}>
            {busy ? tr("Marking…", "Menandai…") : tr("Mark for everybody", "Tandai untuk semua orang")}
          </Button>
        </div>
      }
    >
      <Loaded state={sheet} onRetry={reload} skeletonRows={3}>
        {(s) => {
          /* A mark that already covers the whole office, if there is one. */
          const existing = s.days.find((d) => d.mark && d.mark.employee_id === null)?.mark ?? null;
          return (
            <div className="space-y-4">
              {existing ? (
                <div className="rounded-xl border border-violet-200 bg-violet-50 px-4 py-3">
                  <p className="text-[13px] font-semibold text-violet-900">
                    {tr("Already marked", "Sudah ditandai")} — {DAY_MARK_LABEL[existing.kind]}
                  </p>
                  <p className="mt-0.5 text-[12px] text-violet-900">{existing.reason}</p>
                  {!undoing && (
                    <Button size="sm" variant="ghost" icon={Undo2} className="mt-2" disabled={busy}
                      onClick={() => setUndoing(true)}>
                      {tr("Withdraw this mark", "Tarik tanda ini")}
                    </Button>
                  )}
                  {undoing && (
                    <div className="mt-2">
                      <input
                        value={undoReason} onChange={(e) => setUndoReason(e.target.value)}
                        placeholder={tr("Why it is withdrawn — wrong date, not a public holiday…", "Kenapa ditarik — salah tanggal, bukan tanggal merah…")}
                        className="h-9 w-full rounded-lg border border-violet-200 px-2 text-sm focus:border-brand-400 focus:outline-none"
                      />
                      <p className="mt-1 text-[11px] text-violet-800">
                        {tr("The mark stays on record. What the next person reads is the reason.", "Tandanya tetap tercatat. Yang dibaca orang berikutnya adalah alasannya.")}
                      </p>
                      <div className="mt-2 flex justify-end gap-2">
                        <Button size="sm" variant="ghost" disabled={busy}
                          onClick={() => { setUndoing(false); setUndoReason(""); }}>
                          {tr("Cancel", "Batal")}
                        </Button>
                        <Button size="sm" icon={Undo2} disabled={busy || !undoReason.trim()}
                          onClick={() => unmark(existing.id)}>
                          {tr("Withdraw", "Tarik")}
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-[13px] text-slate-600">
                  {tr(
                    `This covers all ${s.employees.length} people on the books. The taps stay exactly as the machine recorded them — what changes is how payroll counts the day.`,
                    `Ini mencakup semua ${s.employees.length} orang yang terdaftar. Tap tetap persis seperti yang direkam mesin — yang berubah adalah cara penggajian menghitung hari itu.`,
                  )}
                </p>
              )}

              <div>
                <span className="block text-xs text-slate-500">{tr("What this day was", "Hari ini adalah")}</span>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {(Object.keys(DAY_MARK_LABEL) as DayMarkKind[]).map((k) => (
                    <Button key={k} size="sm" variant={kind === k ? "primary" : "outline"} onClick={() => setKind(k)}>
                      {DAY_MARK_LABEL[k]}
                    </Button>
                  ))}
                </div>
                <p className="mt-1.5 text-[11px] text-slate-500">{tr(NOTE[kind].en, NOTE[kind].id)}</p>
              </div>

              <div>
                <label htmlFor="mark-reason" className="block text-xs text-slate-500">{tr("Reason", "Keterangan")}</label>
                <input
                  id="mark-reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder={kind === "holiday" ? "Maulid Nabi Muhammad SAW" : tr("Power out since 13:00", "Listrik padam sejak pukul 13.00")}
                  className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none"
                />
                <p className="mt-1 text-[11px] text-slate-500">
                  {tr("Required.", "Wajib.")} <em>{tr("A half day", "Setengah hari")}</em>{" "}
                  {tr("with no reason is a decision nobody can check in six months.", "tanpa alasan adalah keputusan yang tidak bisa diperiksa siapa pun enam bulan lagi.")}
                </p>
              </div>

              {s.days.some((d) => d.scans.length > 0) && (
                <p className="rounded-lg bg-slate-50 px-3 py-2 text-[11px] text-slate-500">
                  {tr(
                    `${s.days.filter((d) => d.scans.length > 0).length} people scanned on this date. Their taps are kept.`,
                    `${s.days.filter((d) => d.scans.length > 0).length} orang tap pada tanggal ini. Tap mereka tetap disimpan.`,
                  )}
                </p>
              )}
            </div>
          );
        }}
      </Loaded>
    </Modal>
  );
}
