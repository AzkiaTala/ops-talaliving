"use client";

import { useEffect, useState } from "react";
import { CalendarCheck, Upload, AlertTriangle, Clock, Flag, ChevronLeft, ChevronRight, Moon } from "lucide-react";
import { Badge, Button, Card, CardHeader, PageHeader } from "@/components/ui/primitives";
import { Loaded, SourceBadge, useLoad } from "@/components/ui/loaded";
import { usePaged } from "@/components/ui/pager";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/cn";
import { mondayOf, officeToday, shiftDay } from "@/lib/office";
import { isLiveMode } from "@/lib/live";
import { hr } from "@/demo/api";
import type { TimesheetTotal } from "@/services/hr/contracts";
import { DAY_MARK_SHORT, OVERTIME_STAGE_LABEL, type DayState } from "@/services/hr/contracts";
import Link from "next/link";
import { useSession } from "@/store/session";
import { useTr } from "@/lib/i18n";
import { ImportScans } from "./ImportScans";
import { DayDrawer } from "./DayDrawer";
import { MarkDay } from "./MarkDay";

/** The timesheet: every person, every day, and whether the machine told us
 *  enough to pay them.
 *
 *  A full day is six taps — masuk, istirahat keluar, istirahat masuk, pulang,
 *  and the lembur pair when there is one. The reader gives us four on a good
 *  day. In the real export this was built against, **48 days out of 227** have
 *  an odd number: a missing *istirahat masuk*, a second tap eleven minutes
 *  later, one scan and nothing else.
 *
 *  So the grid's job is not to display attendance. It is to show, at a glance,
 *  **which days a person still has to read** — because until they have, a
 *  payroll over this period is arithmetic rather than wages (D141).
 */
/** Two weeks: the one before this and this one. Last week is the one a
 *  weekly payroll pays, and this week is the one being tapped into. Until F154
 *  this was a constant — the demo's own fortnight, 29 Aug – 7 Sep 2026 — so in
 *  live mode the grid never showed a day anybody could still fix. */
const SPAN_DAYS = 14;

/** Where the grid opens: the last fortnight in live mode; in the demo, the
 *  fortnight its fixtures were recorded in, which is otherwise an empty grid. */
function defaultFrom(): string {
  return isLiveMode() ? mondayOf(shiftDay(officeToday(), -7)) : "2026-08-24";
}

const CELL: Record<DayState, string> = {
  complete: "bg-emerald-50 text-emerald-800 border-emerald-200",
  review: "bg-amber-50 text-amber-900 border-amber-300 font-semibold",
  marked: "bg-violet-50 text-violet-800 border-violet-200",
  off: "bg-slate-50 text-slate-300 border-slate-100",
};

export default function TimesheetPage() {
  const tr = useTr();
  const { can, hasAuthority } = useSession();
  /* Read off the address, as the weekly payroll does, so a link (or a reload)
     lands on the fortnight somebody was looking at. */
  const [from, setFrom] = useState(() => {
    const asked = typeof window === "undefined"
      ? null : new URLSearchParams(window.location.search).get("from");
    return asked && /^\d{4}-\d{2}-\d{2}$/.test(asked) ? mondayOf(asked) : defaultFrom();
  });
  const to = shiftDay(from, SPAN_DAYS - 1);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    url.searchParams.set("from", from);
    window.history.replaceState(null, "", url.toString());
  }, [from]);
  const [sheet, reload] = useLoad(() => hr.getTimesheet({ from, to }), [from, to]);
  const [sheets, reloadSheets] = useLoad(() => hr.listOvertimeSheets(), []);
  const [importing, setImporting] = useState(false);
  const [marking, setMarking] = useState<string | null>(null);
  const [open, setOpen] = useState<{ employee_no: string; work_date: string } | null>(null);
  /* The grid pages by person. Computed out here rather than inside the
     `Loaded` callback, which is not always called and so is no place for a
     hook (D157). */
  const { shown: people, pager: peoplePager } = usePaged(
    sheet.status === "ready" ? sheet.data.employees : [],
    12,
  );
  const mayEdit = can("hrd.update");
  const mayLeader = hasAuthority("approve_overtime");

  return (
    <div>
      <PageHeader
        breadcrumb="HRD"
        title={tr("Timesheet", "Absensi")}
        description={tr(
          `${from} → ${to}. Six taps make a full day; the reader gives four on a good one. Amber is a day somebody still has to read.`,
          `${from} → ${to}. Enam tap membuat satu hari penuh; mesin memberi empat pada hari yang baik. Kuning adalah hari yang masih harus dibaca seseorang.`,
        )}
        actions={mayEdit ? (
          <Button icon={Upload} onClick={() => setImporting(true)}>{tr("Upload biometric file", "Unggah file biometrik")}</Button>
        ) : undefined}
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" icon={ChevronLeft} onClick={() => setFrom(shiftDay(from, -7))}>
          {tr("Previous week", "Minggu sebelumnya")}
        </Button>
        <span className="px-2 font-mono text-[12px] text-slate-500">{from} → {to}</span>
        <Button variant="outline" size="sm" onClick={() => setFrom(shiftDay(from, 7))}>
          {tr("Next week", "Minggu depan")} <ChevronRight className="ml-1 h-3.5 w-3.5" />
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setFrom(defaultFrom())}>
          {tr("Last two weeks", "Dua minggu terakhir")}
        </Button>
      </div>

      <Loaded state={sheet} onRetry={reload}>
        {(s) => (
          <>
            <div className="mb-4 rounded-xl border border-slate-200 bg-white shadow-card">
              <dl className="grid divide-y divide-slate-100 sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-4 lg:divide-x">
                {([
                  [tr("People", "Orang"), String(s.employees.length), tr("on the machine this period", "di mesin periode ini")],
                  [tr("Days to read", "Hari untuk dibaca"), String(s.needs_review), s.needs_review > 0 ? tr("the machine could not describe these", "mesin tidak bisa menjelaskan hari-hari ini") : tr("the machine described every day", "mesin menjelaskan setiap hari")],
                  [tr("Marked by HRD", "Ditandai HRD"), String(s.marked), tr("holiday, half day, absent, sick", "libur, setengah hari, absen, sakit")],
                  [tr("Complete", "Lengkap"), String(s.days.filter((d) => d.state === "complete").length), tr("nothing to do", "tidak ada yang perlu dilakukan")],
                ] as [string, string, string][]).map(([k, v, note], i) => (
                  <div key={k} className="px-4 py-3.5">
                    <dt className="text-[11px] uppercase tracking-wide text-slate-400">{k}</dt>
                    <dd className={cn(
                      "mt-0.5 text-xl font-bold tabular-nums tracking-tight",
                      i === 1 && s.needs_review > 0 ? "text-amber-700" : "text-slate-800",
                    )}>
                      {v}
                    </dd>
                    <p className="text-[11px] text-slate-500">{note}</p>
                  </div>
                ))}
              </dl>
              {s.needs_review > 0 && (
                <p className="border-t border-slate-100 bg-amber-50/60 px-4 py-2.5 text-[12px] text-amber-900">
                  {tr(
                    "A payroll over this period cannot be approved until these are read. Click any amber cell to see the taps the machine actually recorded.",
                    "Penggajian untuk periode ini tidak bisa disetujui sampai hari-hari ini dibaca. Klik sel kuning mana pun untuk melihat tap yang benar-benar direkam mesin.",
                  )}
                </p>
              )}
            </div>

            <Card className="mb-4">
              <CardHeader
                title={tr("Every person, every day", "Setiap orang, setiap hari")}
                subtitle={tr(
                  "Click a cell for the taps behind it. Click a date to mark the whole day — public holiday, half day.",
                  "Klik sel untuk melihat tap di baliknya. Klik tanggal untuk menandai seluruh hari — tanggal merah, setengah hari.",
                )}
                icon={CalendarCheck}
                action={<SourceBadge state={sheet} />}
              />
              <div className="overflow-x-auto">
                <table className="w-full min-w-[900px] border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50/70">
                      <th className="sticky left-0 z-10 bg-slate-50/70 px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                        {tr("Employee", "Karyawan")}
                      </th>
                      {s.dates.map((d) => (
                        <th key={d} className="px-2 py-2.5 text-center text-[11px] font-semibold text-slate-500">
                          <button
                            onClick={() => mayEdit && setMarking(d)}
                            className="underline decoration-dotted underline-offset-4 hover:text-brand-700"
                            title={tr("Mark this day for everybody", "Tandai hari ini untuk semua orang")}
                          >
                            {d.slice(8)}/{d.slice(5, 7)}
                          </button>
                        </th>
                      ))}
                      {/* Pertanyaan yang ditanyakan sebelum *hari ini kenapa*:
                          berapa jam, berapa hari. Dijumlahkan di basis data,
                          bukan di sini (0067). */}
                      <th className="sticky right-0 z-10 border-l border-slate-200 bg-slate-50/70 px-3 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                        {tr("Total", "Total")}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {people.map((e) => (
                      <tr key={e.employee_no} className="border-b border-slate-100">
                        <th scope="row" className="sticky left-0 z-10 bg-white px-4 py-1.5 text-left">
                          <span className="block text-[13px] font-medium text-slate-800">{e.full_name}</span>
                          <span className="block font-mono text-[10px] text-slate-400">
                            {e.employee_no} · {e.pay_basis === "monthly" ? tr("monthly", "bulanan") : tr("daily", "harian")}
                          </span>
                        </th>
                        {s.dates.map((date) => {
                          const day = s.days.find((d) => d.employee_no === e.employee_no && d.work_date === date);
                          if (!day) return <td key={date} />;
                          return (
                            <td key={date} className="px-1 py-1 text-center">
                              <button
                                onClick={() => setOpen({ employee_no: e.employee_no, work_date: date })}
                                className={cn(
                                  "w-full rounded border px-1 py-1 text-[11px] leading-tight transition-colors hover:brightness-95",
                                  CELL[day.state],
                                )}
                                title={day.issues.join(" · ") || day.mark?.reason || ""}
                              >
                                {day.overnight && day.state !== "off" && (
                                  <Moon className="mr-0.5 inline h-2.5 w-2.5 align-[-1px]" aria-label={tr("night shift", "shift malam")} />
                                )}
                                {day.state === "off" ? "—"
                                  : day.state === "marked" ? DAY_MARK_SHORT[day.mark!.kind]
                                    : day.state === "review" ? tr(`${day.scans.length} tap`, `${day.scans.length} tap`)
                                      : formatNumber(day.work_hours)}
                              </button>
                            </td>
                          );
                        })}
                        <TotalCell total={s.totals.find((t) => t.employee_no === e.employee_no)} />
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {/* Forty names today, more next year: the grid pages like every
                  other table rather than growing without limit (D157). */}
              {peoplePager}
              <p className="flex flex-wrap gap-3 border-t border-slate-100 px-4 py-2 text-[11px] text-slate-500">
                <span className="rounded border border-emerald-200 bg-emerald-50 px-1.5 text-emerald-800">{tr("hours", "jam")}</span> {tr("read cleanly", "terbaca bersih")}
                <span className="rounded border border-amber-300 bg-amber-50 px-1.5 text-amber-900">{tr("n tap", "n tap")}</span> {tr("needs reading", "perlu dibaca")}
                <span className="rounded border border-violet-200 bg-violet-50 px-1.5 text-violet-800">{tr("marked", "ditandai")}</span> {tr("HRD said what happened", "HRD menyatakan apa yang terjadi")}
                <span className="rounded border border-slate-100 bg-slate-50 px-1.5 text-slate-400">—</span> {tr("no tap at all", "tidak ada tap sama sekali")}
                {/* A night belongs to the day it started (D330): its morning
                    taps are counted in the evening's cell, not the next day's. */}
                <span className="inline-flex items-center gap-1"><Moon className="h-3 w-3 text-indigo-600" /> {tr("night shift, counted on the day it started", "shift malam, dihitung pada hari mulainya")}</span>
              </p>
            </Card>

            {/* Overtime lives on its own screen now: it arrives as a sheet,
                and the two kinds of sheet answer to different people (D146).
                What belongs here is only the part that touches attendance —
                how many hours the machine saw that nobody has signed for. */}
            <Loaded state={sheets} onRetry={reloadSheets}>
              {(all) => {
                const waiting = all.filter((x) =>
                  x.stage === "waiting_hrd" || x.stage === "waiting_surat" || x.stage === "waiting_leader");
                const unreviewed = all.filter((x) => x.stage === "paid_default");
                return (
                  <Card>
                    <CardHeader
                      title={tr("Overtime", "Lembur")}
                      subtitle={tr(
                        "Overtime hours are not taken from the machine — they arrive as a sheet, and the sheet is what gets signed.",
                        "Jam lembur tidak dicatat dari mesin — ia datang sebagai lembar, dan lembar itu yang ditandatangani.",
                      )}
                      icon={Clock}
                      action={
                        <Link href="/hrd/lembur">
                          <Button size="sm" variant="outline">{tr("Open overtime sheets", "Buka lembar lembur")}</Button>
                        </Link>
                      }
                    />
                    <ul className="divide-y divide-slate-100">
                      {waiting.length === 0 && unreviewed.length === 0 && (
                        <li className="px-5 py-5 text-[13px] text-slate-500">
                          {tr("No sheets are waiting for a decision.", "Tidak ada lembar yang menunggu keputusan.")}
                        </li>
                      )}
                      {[...waiting, ...unreviewed].slice(0, 6).map((x) => (
                        <li key={x.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-2.5">
                          <span className="min-w-[180px] flex-1 text-[13px] text-slate-800">
                            {x.purpose}
                            <span className="ml-2 font-mono text-[10px] text-slate-400">{x.sheet_no} · {x.work_date}</span>
                          </span>
                          <span className="whitespace-nowrap text-[12px] text-slate-600">
                            {tr(`${x.lines.length} people`, `${x.lines.length} orang`)} · {tr(`${formatNumber(x.total_hours)} h`, `${formatNumber(x.total_hours)} jam`)}
                          </span>
                          <Badge tone={x.payable ? "green" : "amber"} dot>{OVERTIME_STAGE_LABEL[x.stage]}</Badge>
                        </li>
                      ))}
                    </ul>
                  </Card>
                );
              }}
            </Loaded>
          </>
        )}
      </Loaded>

      {importing && <ImportScans onClose={() => setImporting(false)} onDone={() => { setImporting(false); reload(); }} />}
      {marking && <MarkDay date={marking} onClose={() => setMarking(null)} onDone={() => { setMarking(null); reload(); }} />}
      {open && (
        <DayDrawer
          employeeNo={open.employee_no}
          workDate={open.work_date}
          onClose={() => setOpen(null)}
          onChanged={() => { reload(); }}
        />
      )}
    </div>
  );
}


/** Berapa jam dan berapa hari, di ujung barisnya.
 *
 *  **Hari yang belum dibaca dicetak di sebelah totalnya, bukan di catatan
 *  kaki.** Sebuah periode dengan empat hari yang belum dibaca punya total yang
 *  pasti terlalu kecil, dan sebuah angka yang terlalu kecil tanpa keterangan
 *  adalah angka yang dipercaya orang. */
function TotalCell({ total }: { total?: TimesheetTotal }) {
  const tr = useTr();
  if (!total) return <td className="sticky right-0 border-l border-slate-200 bg-white" />;
  return (
    <td className="sticky right-0 z-10 border-l border-slate-200 bg-white px-3 py-1.5 text-right">
      <span className="block text-[13px] font-semibold tabular-nums text-slate-800">
        {tr(`${formatNumber(total.work_hours)} h`, `${formatNumber(total.work_hours)} jam`)}
      </span>
      <span className="block text-[10px] tabular-nums text-slate-400">
        {tr(`${formatNumber(total.days_counted)} days`, `${formatNumber(total.days_counted)} hari`)}
      </span>
      {total.days_review > 0 && (
        <span className="mt-0.5 block text-[10px] font-medium tabular-nums text-amber-700">
          {tr(`${total.days_review} not yet read`, `${total.days_review} belum dibaca`)}
        </span>
      )}
    </td>
  );
}
