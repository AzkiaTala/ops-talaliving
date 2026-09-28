"use client";

import { useState } from "react";
import { CalendarClock, Check, X, Plus, AlertTriangle } from "lucide-react";
import { Badge, Button, Card, CardHeader, PageHeader } from "@/components/ui/primitives";
import { Loaded, SourceBadge, useLoad } from "@/components/ui/loaded";
import { Paged } from "@/components/ui/pager";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/cn";
import { hr } from "@/demo/api";
import { LEAVE_KIND_LABEL, type LeaveKind, type LeaveRequestView } from "@/services/hr/contracts";
import { useSession } from "@/store/session";
import { useToast } from "@/store/toast";
import { useTr } from "@/lib/i18n";

/** Cuti & izin — the half that happens before the timesheet.
 *
 *  Until now this system had only the mark: HRD wrote *cuti* on a day and the
 *  payroll worked out whether it was paid (D144). What was missing is the part
 *  that happens first — somebody asks, somebody decides — and the number an
 *  employee actually wants, which is how many days they have left (D178).
 *
 *  Approving is what writes the mark. Nothing is refused for running past the
 *  entitlement: those days are still taken and still recorded, they are simply
 *  not paid — and this screen says so **before** the decision rather than
 *  leaving it to be discovered on a payslip.
 */
export default function LeavePage() {
  const tr = useTr();
  const { can } = useSession();
  const { toast } = useToast();
  const [requests, reloadRequests] = useLoad(() => hr.listLeaveRequests(), []);
  const [balances, reloadBalances] = useLoad(() => hr.listLeaveBalances(), []);
  const [draft, setDraft] = useState({ employee_no: "", kind: "cuti" as LeaveKind, from_date: "", to_date: "", reason: "" });
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const mayEdit = can("hrd.update");

  async function file() {
    setBusy(true);
    const res = await hr.requestLeave({
      employee_no: draft.employee_no, kind: draft.kind,
      from_date: draft.from_date, to_date: draft.to_date || draft.from_date,
      reason: draft.reason,
    });
    setBusy(false);
    if (res.error) {
      toast(res.error.status === 409 ? "warning" : "warning", tr("Not recorded", "Tidak tercatat"), res.error.message);
      return;
    }
    toast("success", tr(`${res.data.request_no} recorded`, `${res.data.request_no} tercatat`), tr(`${res.data.full_name} · ${res.data.days} days`, `${res.data.full_name} · ${res.data.days} hari`));
    setDraft({ ...draft, from_date: "", to_date: "", reason: "" });
    setCreating(false);
    reloadRequests(); reloadBalances();
  }

  async function decide(r: LeaveRequestView, approved: boolean, note?: string) {
    setBusy(true);
    const res = await hr.decideLeave({ request_no: r.request_no, approved, note: note ?? null });
    setBusy(false);
    if (res.error) {
      toast(res.error.status === 403 ? "critical" : "warning", tr("Not decided", "Tidak diputuskan"), res.error.message);
      return;
    }
    toast(
      approved ? "success" : "info",
      approved ? tr(`${r.request_no} approved`, `${r.request_no} disetujui`) : tr(`${r.request_no} rejected`, `${r.request_no} ditolak`),
      approved
        ? tr(
          `${res.data.marked.length} days marked on the timesheet${res.data.skipped.length > 0 ? ` · ${res.data.skipped.length} days already had another mark` : ""}`,
          `${res.data.marked.length} hari ditandai di absensi${res.data.skipped.length > 0 ? ` · ${res.data.skipped.length} hari sudah punya tanda lain` : ""}`,
        )
        : tr("The reason is recorded on the request.", "Alasannya tercatat di permintaan."),
    );
    reloadRequests(); reloadBalances();
  }

  return (
    <div>
      <PageHeader
        breadcrumb="HRD"
        title={tr("Leave & permits", "Cuti & izin")}
        description={tr(
          "Requested, decided, then written onto the timesheet. Remaining leave is counted from the days already marked — per person, because entitlements genuinely differ.",
          "Diminta, diputuskan, lalu tertulis di absensi. Sisa hak cuti dihitung dari hari yang sudah ditandai — per orang, karena jatahnya memang berbeda-beda.",
        )}
        actions={
          <div className="flex items-center gap-2">
            <SourceBadge state={requests} />
            {mayEdit && (
              <Button icon={Plus} onClick={() => setCreating((v) => !v)}>
                {creating ? tr("Close", "Tutup") : tr("New request", "Ajukan")}
              </Button>
            )}
          </div>
        }
      />

      {creating && mayEdit && (
        <Card className="mb-4">
          <CardHeader title={tr("Request leave / permit", "Ajukan cuti / izin")} subtitle={tr("One request, one date range.", "Satu permintaan, satu rentang tanggal.")} icon={CalendarClock} />
          <Loaded state={balances} skeletonRows={1}>
            {(bs) => (
              <div className="px-5 py-3">
                <div className="grid gap-2 sm:grid-cols-[1fr_130px_150px_150px]">
                  <select
                    value={draft.employee_no} onChange={(e) => setDraft({ ...draft, employee_no: e.target.value })}
                    aria-label={tr("Employee", "Karyawan")}
                    className="h-9 rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none"
                  >
                    <option value="">{tr("Choose employee…", "Pilih karyawan…")}</option>
                    {bs.map((b) => (
                      <option key={b.employee_no} value={b.employee_no}>
                        {b.full_name} · {tr(`${b.remaining} days left`, `sisa ${b.remaining} hari`)}
                      </option>
                    ))}
                  </select>
                  <select
                    value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value as LeaveKind })}
                    aria-label={tr("Kind", "Jenis")}
                    className="h-9 rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none"
                  >
                    {(Object.keys(LEAVE_KIND_LABEL) as LeaveKind[]).map((k) => (
                      <option key={k} value={k}>{LEAVE_KIND_LABEL[k]}</option>
                    ))}
                  </select>
                  <input
                    type="date" value={draft.from_date} onChange={(e) => setDraft({ ...draft, from_date: e.target.value })}
                    aria-label={tr("From date", "Dari tanggal")}
                    className="h-9 rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none"
                  />
                  <input
                    type="date" value={draft.to_date} onChange={(e) => setDraft({ ...draft, to_date: e.target.value })}
                    aria-label={tr("To date", "Sampai tanggal")}
                    className="h-9 rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none"
                  />
                </div>
                <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_auto]">
                  <input
                    value={draft.reason} onChange={(e) => setDraft({ ...draft, reason: e.target.value })}
                    placeholder={tr("Reason — this is what is read when it is decided", "Alasan — ini yang dibaca saat diputuskan")}
                    className="h-9 rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none"
                  />
                  <Button
                    size="sm" disabled={busy || !draft.employee_no || !draft.from_date || !draft.reason.trim()}
                    onClick={file}
                  >
                    {busy ? tr("Saving…", "Menyimpan…") : tr("Submit", "Ajukan")}
                  </Button>
                </div>
                <p className="mt-1 text-[11px] text-slate-500">
                  {tr(
                    "Going over the entitlement is not refused — the days are still recorded, just not paid, and the numbers show below before it is decided.",
                    "Melebihi jatah tidak ditolak — harinya tetap tercatat, hanya tidak dibayar, dan angkanya terlihat di bawah sebelum diputuskan.",
                  )}
                </p>
              </div>
            )}
          </Loaded>
        </Card>
      )}

      <Loaded state={requests} onRetry={reloadRequests}>
        {(all) => {
          const pending = all.filter((r) => r.status === "PENDING");
          const decided = all.filter((r) => r.status !== "PENDING");
          return (
            <>
              <Card className="mb-4">
                <CardHeader
                  title={tr(`${pending.length} awaiting a decision`, `${pending.length} menunggu keputusan`)}
                  subtitle={tr(
                    "How many days are paid and how many are not, counted from the person's remaining leave — before it is decided.",
                    "Berapa hari yang dibayar dan berapa yang tidak, dihitung dari sisa hak cuti orangnya — sebelum diputuskan.",
                  )}
                  icon={CalendarClock}
                />
                <ul className="divide-y divide-slate-100">
                  {pending.length === 0 && (
                    <li className="px-5 py-6 text-[13px] text-slate-500">{tr("No requests are waiting.", "Tidak ada permintaan yang menunggu.")}</li>
                  )}
                  {pending.map((r) => (
                    <li key={r.id} className="px-5 py-3">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <span className="min-w-[170px]">
                          <span className="block text-[13px] font-medium text-slate-800">{r.full_name}</span>
                          <span className="block font-mono text-[10px] text-slate-400">
                            {r.request_no} · {r.employee_no}
                          </span>
                        </span>
                        <Badge tone="slate">{LEAVE_KIND_LABEL[r.kind]}</Badge>
                        <span className="whitespace-nowrap text-[12px] text-slate-600">
                          {r.from_date} → {r.to_date} · {tr(`${r.days} days`, `${r.days} hari`)}
                        </span>
                        <span className="min-w-[180px] flex-1 text-[12px] text-slate-600">{r.reason}</span>
                        {mayEdit && (
                          <span className="flex gap-1.5">
                            <Button size="sm" icon={Check} disabled={busy} onClick={() => decide(r, true)}>{tr("Approve", "Setujui")}</Button>
                            <Button
                              size="sm" variant="outline" icon={X} disabled={busy}
                              onClick={() => {
                                const note = window.prompt(tr("Reason for rejecting — the person will read it:", "Alasan penolakan — dibaca orangnya:"));
                                if (note?.trim()) void decide(r, false, note);
                              }}
                            >
                              {tr("Reject", "Tolak")}
                            </Button>
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-[12px]">
                        {r.kind === "cuti" ? (
                          <>
                            <span className="text-emerald-700">{tr(`${r.paid_days} days paid`, `${r.paid_days} hari dibayar`)}</span>
                            {r.unpaid_days > 0 && (
                              <span className="text-amber-700"> · {tr(`${r.unpaid_days} days beyond entitlement, unpaid`, `${r.unpaid_days} hari di luar jatah, tidak dibayar`)}</span>
                            )}
                          </>
                        ) : r.kind === "sakit" ? (
                          <span className="text-slate-500">
                            {tr("Paid only if the doctor’s note is attached to the day.", "Dibayar hanya kalau surat dokternya dilampirkan pada harinya.")}
                          </span>
                        ) : (
                          <span className="text-slate-500">{tr("Permit recorded, unpaid.", "Izin tercatat, tidak dibayar.")}</span>
                        )}
                        {r.clashes.length > 0 && (
                          <span className="ml-2 text-amber-700">
                            · {tr(`${r.clashes.length} days already have another mark (${r.clashes.join(", ")}) — will not be overwritten`, `${r.clashes.length} hari sudah punya tanda lain (${r.clashes.join(", ")}) — tidak akan ditimpa`)}
                          </span>
                        )}
                      </p>
                    </li>
                  ))}
                </ul>
              </Card>

              <div className="grid gap-4 lg:grid-cols-2">
                <Loaded state={balances} onRetry={reloadBalances}>
                  {(bs) => {
                    const over = bs.filter((b) => b.over > 0);
                    return (
                      <Card>
                        <CardHeader
                          title={tr("Remaining leave", "Sisa hak cuti")}
                          subtitle={tr(
                            "Each person's entitlement, minus days already marked and days approved but not yet passed.",
                            "Jatah per orang, dikurangi hari yang sudah ditandai dan yang sudah disetujui tapi belum lewat.",
                          )}
                          icon={CalendarClock}
                        />
                        {over.length > 0 && (
                          <p className="flex items-start gap-2 border-b border-slate-100 bg-amber-50/60 px-5 py-2 text-[12px] text-amber-900">
                            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                            {over.map((b) => tr(`${b.full_name} over by ${b.over} days`, `${b.full_name} lewat ${b.over} hari`)).join(" · ")} — {tr("recorded, unpaid.", "tercatat, tidak dibayar.")}
                          </p>
                        )}
                        <Paged rows={bs} pageSize={12} unit={tr("people", "orang")}>
                          {(page) => (
                            <ul className="divide-y divide-slate-100">
                              {page.map((b) => (
                                <li key={b.employee_no} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-2 text-[12px]">
                                  <span className="min-w-[150px] font-medium text-slate-800">
                                    {b.full_name}
                                    <span className="ml-2 font-mono text-[10px] font-normal text-slate-400">{b.employee_no}</span>
                                  </span>
                                  <span className={cn(
                                    "w-[64px] text-right font-semibold tabular-nums",
                                    b.remaining === 0 ? "text-amber-700" : "text-slate-800",
                                  )}>
                                    {formatNumber(b.remaining)}
                                  </span>
                                  <span className="text-slate-500">
                                    {tr(`of ${b.entitlement} · used ${b.taken}`, `dari ${b.entitlement} · terpakai ${b.taken}`)}
                                    {b.booked > 0 && tr(` · ${b.booked} already approved`, ` · ${b.booked} sudah disetujui`)}
                                  </span>
                                  {b.sick_without_letter > 0 && (
                                    <span className="text-[11px] text-amber-700">
                                      {tr(`${b.sick_without_letter} sick days without a note`, `${b.sick_without_letter} hari sakit tanpa surat`)}
                                    </span>
                                  )}
                                </li>
                              ))}
                            </ul>
                          )}
                        </Paged>
                      </Card>
                    );
                  }}
                </Loaded>

                <Card>
                  <CardHeader
                    title={tr("Decided", "Sudah diputuskan")}
                    subtitle={tr("Kept, with the reasons — including the rejected ones.", "Tetap ada, beserta alasannya — termasuk yang ditolak.")}
                    icon={Check}
                  />
                  <Paged rows={decided} pageSize={12} unit={tr("requests", "permintaan")}>
                    {(page) => (
                      <ul className="divide-y divide-slate-100">
                        {page.map((r) => (
                          <li key={r.id} className="px-5 py-2 text-[12px]">
                            <span className="flex flex-wrap items-center gap-2">
                              <Badge tone={r.status === "APPROVED" ? "green" : r.status === "REJECTED" ? "red" : "slate"}>
                                {r.status}
                              </Badge>
                              <span className="font-medium text-slate-800">{r.full_name}</span>
                              <span className="text-slate-500">
                                {LEAVE_KIND_LABEL[r.kind]} · {r.from_date} → {r.to_date}
                              </span>
                              <span className="font-mono text-[10px] text-slate-400">{r.request_no}</span>
                            </span>
                            <span className="mt-0.5 block text-slate-600">{r.reason}</span>
                            {r.decision_note && (
                              <span className="mt-0.5 block text-[11px] text-slate-500">
                                {r.decided_by_name}: {r.decision_note}
                              </span>
                            )}
                          </li>
                        ))}
                        {decided.length === 0 && (
                          <li className="px-5 py-6 text-[13px] text-slate-500">{tr("Nothing decided yet.", "Belum ada yang diputuskan.")}</li>
                        )}
                      </ul>
                    )}
                  </Paged>
                </Card>
              </div>
            </>
          );
        }}
      </Loaded>
    </div>
  );
}
