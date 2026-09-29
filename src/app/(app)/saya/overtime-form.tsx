"use client";

import { useState } from "react";
import { Button } from "@/components/ui/primitives";
import { hr } from "@/demo/api";
import { officeToday } from "@/lib/office";
import { useToast } from "@/store/toast";
import { useTr } from "@/lib/i18n";
import { attachPhoto, CameraButton, FIELD } from "./shared";

export interface OvertimeDraft {
  work_date: string;
  hours: string;
  result_note: string;
  task: string;
}

export function emptyOvertime(): OvertimeDraft {
  return { work_date: officeToday(), hours: "", result_note: "", task: "" };
}

/** Asking for overtime from a phone — `hr.reportOvertimeSelf` (0165), then the
 *  evidence photo on the sheet it made (`Laporan Lembur`, ADR-010).
 *
 *  **Built to be extended.** D333 adds a *deliverable* field and an approval
 *  by HR or leadership. The draft is one object, the fields are one block, and
 *  `extraFields`/`beforeSubmit` are where a later session plugs in without
 *  rewriting the submit path or the evidence step. */
export function OvertimeForm({
  onDone,
  extraFields,
  beforeSubmit,
}: {
  onDone: () => void;
  /** More inputs under the standard ones (D333: deliverable). */
  extraFields?: (draft: OvertimeDraft, set: (d: OvertimeDraft) => void) => React.ReactNode;
  /** A last say before the write — return a sentence to stop it. */
  beforeSubmit?: (draft: OvertimeDraft) => string | null;
}) {
  const tr = useTr();
  const { toast } = useToast();
  const [draft, setDraft] = useState<OvertimeDraft>(emptyOvertime);
  const [photo, setPhoto] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    const stop = beforeSubmit?.(draft);
    if (stop) { toast("warning", tr("Not sent", "Belum dikirim"), stop); return; }
    setBusy(true);
    const res = await hr.reportOvertimeSelf({
      work_date: draft.work_date, hours: Number(draft.hours),
      result_note: draft.result_note, task: draft.task || null,
    });
    if (res.error) {
      setBusy(false);
      toast("warning", tr("Not recorded", "Tidak tercatat"), res.error.message);
      return;
    }
    let photoErr: string | null = null;
    if (photo) {
      const err = await attachPhoto(photo, "Laporan Lembur", "overtime", res.data.sheet_no);
      photoErr = err?.message ?? null;
    }
    setBusy(false);
    if (photoErr) {
      toast("warning", tr(`${res.data.sheet_no} recorded — photo not attached`, `${res.data.sheet_no} tercatat — foto belum terlampir`), photoErr);
    } else {
      toast("success", tr(`${res.data.sheet_no} recorded`, `${res.data.sheet_no} tercatat`), tr("Waiting for HRD.", "Menunggu HRD."));
    }
    setDraft(emptyOvertime());
    setPhoto(null);
    onDone();
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <label className="block text-[13px] text-slate-600">
          {tr("Date", "Tanggal")}
          <input type="date" value={draft.work_date} max={officeToday()}
            onChange={(e) => setDraft({ ...draft, work_date: e.target.value })} className={`mt-1 ${FIELD}`} />
        </label>
        <label className="block text-[13px] text-slate-600">
          {tr("Hours", "Jam")}
          <input type="number" inputMode="decimal" min={0.5} max={12} step={0.5} value={draft.hours}
            onChange={(e) => setDraft({ ...draft, hours: e.target.value })} className={`mt-1 ${FIELD}`} />
        </label>
      </div>
      <label className="block text-[13px] text-slate-600">
        {tr("What was finished", "Apa yang selesai")}
        <textarea value={draft.result_note} rows={3}
          onChange={(e) => setDraft({ ...draft, result_note: e.target.value })}
          className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-base focus:border-brand-500 focus:outline-none" />
      </label>
      <label className="block text-[13px] text-slate-600">
        {tr("Task (optional)", "Tugas (opsional)")}
        <input value={draft.task} onChange={(e) => setDraft({ ...draft, task: e.target.value })} className={`mt-1 ${FIELD}`} />
      </label>
      {extraFields?.(draft, setDraft)}
      <CameraButton
        label={tr("Photo of the work (optional)", "Foto hasil kerja (opsional)")}
        file={photo} onFile={setPhoto} disabled={busy}
      />
      <Button
        className="h-12 w-full text-base"
        disabled={busy || !draft.hours || !draft.result_note.trim()}
        onClick={submit}
      >
        {busy ? tr("Sending…", "Mengirim…") : tr("Send overtime", "Ajukan lembur")}
      </Button>
    </div>
  );
}
