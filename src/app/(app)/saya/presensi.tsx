"use client";

import { useEffect, useState } from "react";
import { Badge, Card } from "@/components/ui/primitives";
import { Loaded, useLoad } from "@/components/ui/loaded";
import { hr } from "@/demo/api";
import { LocatedTap } from "@/components/attendance/located-tap";
import type { TimesheetDay } from "@/services/hr/contracts";
import { OFFICE_TZ, officeClock, officeDay, officeToday, shiftDay } from "@/lib/office";
import { formatNumber } from "@/lib/format";
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
        <p className="mt-1 text-[12px] text-slate-400">{OFFICE_TZ.short}</p>

        <p className="mt-4 text-[17px] font-medium text-slate-800" data-testid="today-state">
          {days.status === "loading" ? "…"
            : reading.outAt ? tr(`Out ${reading.outAt}`, `Pulang ${reading.outAt}`)
            : reading.inAt ? tr(`In ${reading.inAt}`, `Masuk ${reading.inAt}`)
            : tr("Not in yet", "Belum masuk")}
        </p>
        {reading.outAt && reading.inAt && (
          <p className="text-[13px] text-slate-500">{tr(`In ${reading.inAt}`, `Masuk ${reading.inAt}`)}</p>
        )}

        {/* D332: the tap reads where the phone is, once, at the press, and is
            judged against the warehouse. Off-site opens the form (location,
            optional photo, required note) and is recorded and flagged. */}
        <LocatedTap
          className="mt-5"
          size="lg"
          label={label}
          tone={reading.next === "pulang" ? "amber" : "brand"}
          disabled={days.status === "loading"}
          onTapped={() => reload()}
        />
        {reading.next === "lagi" && (
          <p className="mt-2 text-[12px] text-slate-500">
            {tr("Overtime? Tap when it starts and when it ends.", "Lembur? Tap saat mulai dan saat selesai.")}
          </p>
        )}

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
