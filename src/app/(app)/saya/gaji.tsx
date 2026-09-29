"use client";

import { useState } from "react";
import { ChevronRight, Wallet } from "lucide-react";
import { Card, EmptyState } from "@/components/ui/primitives";
import { Loaded, useLoad } from "@/components/ui/loaded";
import { hr } from "@/demo/api";
import { formatIDR } from "@/lib/format";
import { useTr } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { useDayLabel } from "./shared";

/** The latest payslip, open on arrival (D331).
 *
 *  `myPayslips` already leaves `DRAFT` out (`runs_read_own`, 0166) — a run
 *  still being checked is not a figure anybody should read. The newest of
 *  what is left is the one a person opens this tab for, so it is the card;
 *  older periods sit under it. The figures are `run_lines`' own (0057),
 *  restricted to one row by the account's link — never computed here. */
export function GajiTab() {
  const tr = useTr();
  const day = useDayLabel();
  const [runs, reloadRuns] = useLoad(() => hr.myPayslips(), []);
  const [picked, setPicked] = useState<string | null>(null);

  return (
    <Loaded state={runs} onRetry={reloadRuns}>
      {(all) => {
        const list = all
          .filter((r) => r.status === "APPROVED" || r.status === "PAID")
          .sort((a, b) => b.period_start.localeCompare(a.period_start));
        if (list.length === 0) {
          return (
            <Card>
              <EmptyState icon={Wallet} title={tr("No payslip yet", "Belum ada slip gaji")}
                description={tr("A payslip appears here once HRD has approved the run.", "Slip muncul di sini setelah HRD menyetujui penggajiannya.")} />
            </Card>
          );
        }
        const current = picked ?? list[0]!.run_no;
        const run = list.find((r) => r.run_no === current) ?? list[0]!;
        return (
          <div className="space-y-4">
            <Slip runNo={run.run_no} period={`${day(run.period_start)} – ${day(run.period_end)}`} paid={run.status === "PAID"} />
            {list.length > 1 && (
              <Card>
                <p className="border-b border-slate-100 px-5 py-3 text-[14px] font-semibold text-slate-800">
                  {tr("Earlier periods", "Periode sebelumnya")}
                </p>
                <ul className="divide-y divide-slate-100">
                  {list.filter((r) => r.run_no !== run.run_no).map((r) => (
                    <li key={r.run_no}>
                      <button
                        type="button" onClick={() => { setPicked(r.run_no); window.scrollTo({ top: 0 }); }}
                        className="flex min-h-[52px] w-full items-center gap-2 px-5 text-left text-[14px] text-slate-700"
                      >
                        <span className="flex-1">{day(r.period_start)} – {day(r.period_end)}</span>
                        <span className="text-[12px] text-slate-400">{r.status === "PAID" ? tr("paid", "dibayar") : tr("approved", "disetujui")}</span>
                        <ChevronRight className="h-4 w-4 text-slate-400" />
                      </button>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
          </div>
        );
      }}
    </Loaded>
  );
}

function Slip({ runNo, period, paid }: { runNo: string; period: string; paid: boolean }) {
  const tr = useTr();
  const [slip, reload] = useLoad(() => hr.myPayslip(runNo), [runNo]);
  return (
    <Loaded state={slip} onRetry={reload} skeletonRows={4}>
      {(line) => (
        <Card className="overflow-hidden">
          <div className="bg-brand-600 px-5 py-5 text-white">
            <p className="text-[13px] opacity-90">{period}</p>
            <p className="mt-1 text-[13px] opacity-90">{tr("Take-home", "Diterima")}</p>
            <p className="text-[34px] font-bold leading-tight tabular-nums" data-testid="take-home">{formatIDR(line.take_home)}</p>
            <p className="mt-1 text-[12px] opacity-80">{paid ? tr("Paid", "Sudah dibayar") : tr("Approved, not yet paid", "Disetujui, belum dibayar")} · {runNo}</p>
          </div>
          <dl className="divide-y divide-slate-100 text-[14px]">
            <Row label={tr("Base", "Pokok")} value={formatIDR(line.base_pay)} />
            <Row label={tr("Allowance", "Tunjangan")} value={formatIDR(line.allowance_pay)} />
            <Row label={tr("Overtime", "Lembur")} value={formatIDR(line.overtime_pay)} />
            {line.adjustments.map((a, i) => (
              <Row key={i} label={a.label} value={formatIDR(a.amount)} note={a.reason} />
            ))}
            {line.contribution_total > 0 && <Row label={tr("BPJS deduction", "Potongan BPJS")} value={`− ${formatIDR(line.contribution_total)}`} />}
            <Row label={tr("Take-home", "Diterima")} value={formatIDR(line.take_home)} bold />
          </dl>
          <p className="border-t border-slate-100 px-5 py-3 text-[12px] text-slate-500">
            {tr(`${line.days_present} working days`, `${line.days_present} hari kerja`)}
            {line.days_unpaid > 0 && ` · ${tr(`${line.days_unpaid} unpaid`, `${line.days_unpaid} tidak dibayar`)}`}
          </p>
          {line.warnings.length > 0 && (
            <p className="border-t border-slate-100 bg-amber-50/60 px-5 py-2 text-[12px] text-amber-900">{line.warnings.join(" · ")}</p>
          )}
        </Card>
      )}
    </Loaded>
  );
}

function Row({ label, value, note, bold }: { label: string; value: string; note?: string; bold?: boolean }) {
  return (
    <div className="flex items-baseline gap-3 px-5 py-2.5">
      <dt className={cn("flex-1 text-slate-600", bold && "font-semibold text-slate-800")}>
        {label}
        {note && <span className="block text-[12px] text-slate-400">{note}</span>}
      </dt>
      <dd className={cn("tabular-nums text-slate-800", bold && "font-semibold")}>{value}</dd>
    </div>
  );
}
