"use client";

import { useEffect, useState } from "react";
import { Fingerprint, MapPin } from "lucide-react";
import { Badge, Card } from "@/components/ui/primitives";
import { Loaded, useLoad } from "@/components/ui/loaded";
import { hr } from "@/demo/api";
import type { TimesheetDay } from "@/services/hr/contracts";
import { officeClock, officeDay, officeToday, shiftDay } from "@/lib/office";
import { formatNumber } from "@/lib/format";
import { useToast } from "@/store/toast";
import { useTr } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { useDayLabel } from "./shared";

/** A moment from the database as `HH:MM` on the office clock (F183). */
function at(v: string | undefined): string | null {
  return v ? officeClock(new Date(v)) : null;
}

/** What today looks like, read from today's taps — and what the button says.
 *
 *  D307: the tap writes nothing about *masuk* or *pulang*; the button reads
 *  the day first, the way somebody glances at the machine's light. So the
 *  label follows the reading: nothing yet → MASUK; in but not out → PULANG;
 *  out already → one more tap is overtime, and the button says so. Where the
 *  reading has not placed a tap in a slot, the first tap stands for *masuk*,
 *  which is what the reader at the door would show too. */
export function readToday(day: TimesheetDay | undefined) {
  const scans = day?.scans ?? [];
  const inAt = at(day?.slots.in) ?? (scans[0] ? at(scans[0].at) : null);
  const outAt = at(day?.slots.out) ?? (scans.length >= 2 && !day?.slots.in ? at(scans[scans.length - 1]!.at) : null);
  const next: "masuk" | "pulang" | "lagi" = !inAt ? "masuk" : !outAt ? "pulang" : "lagi";
  return { inAt, outAt, next, taps: scans.length };
}

export function PresensiTab({ employeeNo }: { employeeNo: string }) {
  const tr = useTr();
  const day = useDayLabel();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  /* One tick a second, so the minute flips when the office clock does. */
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);

  const today = officeToday();
  const from = shiftDay(today, -13);
  const [days, reload] = useLoad(
    () => hr.attendanceFor({ employee_no: employeeNo, from, to: today }),
    [employeeNo, from, today],
  );
  const todayRow = days.status === "ready" ? days.data.find((d) => d.work_date === today) : undefined;
  const reading = readToday(todayRow);

  async function tap() {
    setBusy(true);
    const res = await hr.tapSelf();
    setBusy(false);
    if (res.error) {
      toast(res.error.status === 403 ? "critical" : "warning", tr("Not recorded", "Tidak tercatat"), res.error.message);
      return;
    }
    toast("success", tr("Tap recorded", "Tap tercatat"), tr(`At ${officeClock(new Date(res.data.at))}.`, `Pukul ${officeClock(new Date(res.data.at))}.`));
    reload();
  }

  const secs = String(new Date(now).getUTCSeconds()).padStart(2, "0");
  const label = reading.next === "masuk" ? tr("CLOCK IN", "MASUK")
    : reading.next === "pulang" ? tr("CLOCK OUT", "PULANG")
    : tr("TAP AGAIN", "TAP LAGI");

  return (
    <div className="space-y-4">
      <Card className="px-5 pb-5 pt-6 text-center">
        <p className="text-[14px] text-slate-500">{day(officeDay(now), true)}</p>
        <p className="mt-1 font-mono text-[64px] font-semibold leading-none tracking-tight text-slate-900 tabular-nums">
          {officeClock(now)}<span className="text-[28px] text-slate-400">:{secs}</span>
        </p>
        <p className="mt-1 text-[12px] text-slate-400">WITA</p>

        <p className="mt-4 text-[17px] font-medium text-slate-800" data-testid="today-state">
          {days.status === "loading" ? "…"
            : reading.outAt ? tr(`Out ${reading.outAt}`, `Pulang ${reading.outAt}`)
            : reading.inAt ? tr(`In ${reading.inAt}`, `Masuk ${reading.inAt}`)
            : tr("Not in yet", "Belum masuk")}
        </p>
        {reading.outAt && reading.inAt && (
          <p className="text-[13px] text-slate-500">{tr(`In ${reading.inAt}`, `Masuk ${reading.inAt}`)}</p>
        )}

        <button
          type="button"
          onClick={tap}
          disabled={busy || days.status === "loading"}
          className={cn(
            "mt-5 flex h-20 w-full items-center justify-center gap-3 rounded-2xl text-[22px] font-bold tracking-wide text-white shadow-sm transition active:scale-[0.99] disabled:opacity-60",
            reading.next === "pulang" ? "bg-amber-600 active:bg-amber-700" : "bg-brand-600 active:bg-brand-700",
          )}
        >
          <Fingerprint className="h-8 w-8" />
          {busy ? tr("Recording…", "Mencatat…") : label}
        </button>
        {reading.next === "lagi" && (
          <p className="mt-2 text-[12px] text-slate-500">
            {tr("Overtime? Tap when it starts and when it ends.", "Lembur? Tap saat mulai dan saat selesai.")}
          </p>
        )}

        {/* Location (D332) goes here: the reading of where this tap was made,
            and the off-site form — location, photo, note — when it was not
            made at the warehouse. Deliberately empty in D331. */}
        <div data-slot="location" className="mt-4 flex items-center justify-center gap-1.5 text-[12px] text-slate-400">
          <MapPin className="h-3.5 w-3.5" />
          {tr("Location is not recorded yet.", "Lokasi belum dicatat.")}
        </div>
      </Card>

      <Card>
        <p className="border-b border-slate-100 px-5 py-3 text-[14px] font-semibold text-slate-800">
          {tr("Last 14 days", "14 hari terakhir")}
        </p>
        <Loaded state={days} onRetry={reload}>
          {(rows) => {
            const list = rows.slice().sort((a, b) => b.work_date.localeCompare(a.work_date));
            return (
              <ul className="divide-y divide-slate-100">
                {list.length === 0 && (
                  <li className="px-5 py-6 text-[14px] text-slate-500">{tr("No attendance in the last 14 days.", "Belum ada presensi 14 hari terakhir.")}</li>
                )}
                {list.map((d) => {
                  const r = readToday(d);
                  return (
                    <li key={d.work_date} className="flex items-center gap-3 px-5 py-3 text-[14px]">
                      <span className="w-[92px] shrink-0 font-medium text-slate-800">{day(d.work_date)}</span>
                      <span className="flex-1 text-slate-600">
                        {d.mark
                          ? d.pay.why
                          : r.inAt
                            ? `${r.inAt} – ${r.outAt ?? "…"}`
                            : tr("no taps", "tidak ada tap")}
                        {d.overtime_hours > 0 && (
                          <span className="ml-1 text-brand-700">+{formatNumber(d.overtime_hours)} {tr("h OT", "j lembur")}</span>
                        )}
                      </span>
                      {/* Today is not over: one tap is a day in progress, not a day to check. */}
                      {d.state === "review" && d.work_date !== today && <Badge tone="amber">{tr("check", "dicek")}</Badge>}
                    </li>
                  );
                })}
              </ul>
            );
          }}
        </Loaded>
      </Card>
    </div>
  );
}
