"use client";

import { useState } from "react";
import { Activity, Timer, Trash2, RefreshCw, AlertTriangle } from "lucide-react";
import { Badge, Button, Card, CardHeader, PageHeader } from "@/components/ui/primitives";
import { Loaded, SourceBadge, useLoad } from "@/components/ui/loaded";
import { Paged } from "@/components/ui/pager";
import { cn } from "@/lib/cn";
import { identity } from "@/demo/api";
import { useSession } from "@/store/session";
import { useToast } from "@/store/toast";
import { useTr } from "@/lib/i18n";
import { officeClock } from "@/lib/office";

/** The activity log — what each person did, and for how long we keep it.
 *
 *  This is the screen that was deliberately not built until somebody answered
 *  the question behind it (Q22), because logging who looked at whose salary is
 *  surveillance of your own staff, and picking a retention rule quietly is how
 *  that decision gets made by accident. The owner's answer (D188):
 *
 *  - **detail for 120 days** (D188 said 30; D283 is the owner's later answer)
 *    — screen by screen, so a specific question about a specific day can be
 *    answered;
 *  - **a daily recap per person, 120 rows each** — six months in the owner's
 *    own arithmetic, *6 bulan itu maksudnya 120 hari kerja* — what somebody did
 *    all day, long after the individual rows are gone. Counted per person, so
 *    three weeks of leave costs nobody three weeks of history.
 *
 *  Two consequences the screen makes visible rather than hiding. The recap is
 *  **stored**, which only one other thing in this system is — `activity_daily`,
 *  the machine record, for the same reason — because it has to outlive its own
 *  source. And the sweep **deletes** — the only deletion here, and it
 *  is a rule rather than a correction (A2).
 */
export default function ActivityPage() {
  const { can } = useSession();
  const { toast } = useToast();
  const tr = useTr();
  const [tab, setTab] = useState<"detail" | "recap">("detail");
  const [events, reloadEvents] = useLoad(() => identity.listActivity(), []);
  const [daily, reloadDaily] = useLoad(() => identity.listActivityDaily(), []);
  const [retention, reloadRetention] = useLoad(() => identity.getRetention(), []);
  const [busy, setBusy] = useState(false);
  /* Two different rights, deliberately not one. Leadership may read this log
     (owner, Q22 — *baca*); rolling a day up is a write, and purging it is the
     only deletion the system performs, so it sits at IT's admin level (D190). */
  const mayRollUp = can("it.update");
  const mayPurge = can("it.purge_activity");

  function reloadAll() { reloadEvents(); reloadDaily(); reloadRetention(); }

  /* The two horizons, once the panel has them. Read from the answer rather
     than written into the labels, because the rule lives in `ops_core.settings`
     and a literal here would keep printing yesterday's number long after
     somebody changed it — the screen would be confidently wrong about its own
     policy, which is the failure this whole screen exists to avoid. */
  const rule = retention.status === "ready" ? retention.data : null;

  async function rollUp() {
    setBusy(true);
    const res = await identity.rollUpActivity({});
    setBusy(false);
    if (res.error) { toast("info", tr("Nothing rolled up", "Tidak ada yang direkap"), res.error.message); return; }
    toast(
      "success",
      tr(`Recap ${res.data.day}`, `Rekap ${res.data.day}`),
      tr(
        `${res.data.written} person(s) written${res.data.skipped ? `, ${res.data.skipped} already there` : ""}`,
        `${res.data.written} orang ditulis${res.data.skipped ? `, ${res.data.skipped} sudah ada` : ""}`,
      ),
    );
    reloadAll();
  }

  async function purge() {
    /* The numbers come from the answer, not from a literal: the rule lives in
       `ops_core.settings` and a hard-coded "30 hari" here would keep saying so
       long after somebody changed it. */
    const what = rule
      ? tr(
        `detail older than ${rule.detail_days} days and recaps beyond ${rule.recap_rows} rows per person`,
        `detail yang lewat ${rule.detail_days} hari dan rekap di atas ${rule.recap_rows} baris per orang`,
      )
      : tr("detail and recaps past the retention limit", "detail dan rekap yang lewat batas retensi");
    if (!window.confirm(tr(
      `Delete ${what}? This is a deletion, not a correction — and it cannot be undone.`,
      `Hapus ${what}? Ini penghapusan, bukan koreksi — dan tidak bisa dibatalkan.`,
    ))) return;
    setBusy(true);
    const res = await identity.purgeActivity();
    setBusy(false);
    if (res.error) { toast("warning", tr("Not done", "Tidak jadi"), res.error.message); return; }
    toast(
      res.data.events_removed + res.data.recaps_removed > 0 ? "success" : "info",
      tr("Retention run", "Retensi dijalankan"),
      tr(
        `${res.data.events_removed} detail(s) and ${res.data.recaps_removed} recap(s) deleted${
          res.data.blocked_days.length ? ` · ${res.data.blocked_days.length} day(s) skipped because not yet rolled up` : ""}`,
        `${res.data.events_removed} detail dan ${res.data.recaps_removed} rekap dihapus${
          res.data.blocked_days.length ? ` · ${res.data.blocked_days.length} hari dilewati karena belum direkap` : ""}`,
      ),
    );
    reloadAll();
  }

  return (
    <div>
      <PageHeader
        breadcrumb="IT"
        title={tr("Activity log", "Log aktivitas")}
        description={tr(
          "Who opened what. Detail is kept for 120 days; the daily recap keeps 120 rows per person. After that it is gone — that is the rule.",
          "Siapa membuka apa. Detailnya disimpan 120 hari; rekap harian disimpan 120 baris per orang. Setelah itu hilang — memang begitu aturannya.",
        )}
        actions={
          <div className="flex items-center gap-2">
            <SourceBadge state={events} />
            {mayRollUp && (
              <Button size="sm" variant="outline" icon={RefreshCw} disabled={busy} onClick={rollUp}>
                {tr("Roll up yesterday", "Rekap kemarin")}
              </Button>
            )}
            {mayPurge && (
              <Button size="sm" variant="outline" icon={Trash2} disabled={busy} onClick={purge}>
                {tr("Run retention", "Jalankan retensi")}
              </Button>
            )}
            {can("it.read") && !mayRollUp && !mayPurge && (
              <span className="text-xs text-slate-500">{tr("Read only — retention is run by IT", "Baca saja — retensi dijalankan IT")}</span>
            )}
          </div>
        }
      />

      <Loaded state={retention} onRetry={reloadRetention}>
        {(r) => (
          <>
            <div className="mb-4 rounded-xl border border-slate-200 bg-white shadow-card">
              <dl className="grid divide-y divide-slate-100 sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-4 lg:divide-x">
                {([
                  [tr("Detail kept", "Detail tersimpan"), String(r.events_total), tr(`rule: ${r.detail_days} days`, `aturan: ${r.detail_days} hari`), false],
                  [tr("Detail past the limit", "Detail lewat batas"), String(r.events_expiring),
                    r.events_expiring > 0 ? tr("will be deleted when retention runs", "akan dihapus saat retensi dijalankan") : tr("none", "tidak ada"), true],
                  [tr("Daily recaps", "Rekap harian"), String(r.recaps_total), tr(`rule: ${r.recap_rows} rows per person`, `aturan: ${r.recap_rows} baris per orang`), false],
                  [tr("Recaps past the limit", "Rekap lewat batas"), String(r.recaps_expiring),
                    r.recaps_expiring > 0 ? tr("will be deleted", "akan dihapus") : tr("none", "tidak ada"), true],
                ] as [string, string, string, boolean][]).map(([k, v, note, expiring]) => (
                  <div key={k} className="px-4 py-3.5">
                    <dt className="text-[11px] uppercase tracking-wide text-slate-400">{k}</dt>
                    <dd className={cn(
                      "mt-0.5 text-xl font-bold tabular-nums tracking-tight",
                      expiring && Number(v) > 0 ? "text-amber-700" : "text-slate-800",
                    )}>
                      {v}
                    </dd>
                    <p className="text-[11px] text-slate-500">{note}</p>
                  </div>
                ))}
              </dl>
              <p className="border-t border-slate-100 px-4 py-2 text-[12px] text-slate-500">
                <strong className="text-slate-700">{tr("The daily recap is stored, not recomputed.", "Rekap harian disimpan, bukan dihitung ulang.")}</strong>{" "}
                {tr(
                  "One of two figures in this system that are — because it has to outlive the rows that make it up. The recap limit is counted",
                  "Salah satu dari dua angka di sistem ini yang begitu — karena ia harus hidup lebih lama daripada baris yang membentuknya. Batas rekap dihitung",
                )}{" "}
                <strong className="text-slate-700">{tr("per person", "per orang")}</strong>
                {tr(
                  ", not per date: somebody on three weeks' leave comes back to their history, not to a hole.",
                  ", bukan per tanggal: orang yang cuti tiga minggu kembali ke riwayatnya, bukan ke lubang.",
                )}
              </p>
            </div>

            {r.days_unrolled > 0 && (
              <div className="mb-4 flex flex-wrap items-start gap-2 rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-3 text-[13px] text-amber-900">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  {tr(
                    `${r.days_unrolled} day(s) have detail but no recap yet. If the detail passes ${r.detail_days} days first, the day is lost entirely — retention refuses to delete such a day until it is rolled up.`,
                    `${r.days_unrolled} hari punya detail tapi belum punya rekap. Kalau detailnya keburu lewat ${r.detail_days} hari, harinya hilang seluruhnya — retensi menolak menghapus hari seperti itu sampai direkap dulu.`,
                  )}
                </span>
              </div>
            )}
          </>
        )}
      </Loaded>

      <div className="mb-3 flex gap-1.5">
        <Button size="sm" variant={tab === "detail" ? "primary" : "outline"} onClick={() => setTab("detail")}>
          {rule ? tr(`Detail ${rule.detail_days} days`, `Detail ${rule.detail_days} hari`) : tr("Daily detail", "Detail harian")}
        </Button>
        <Button size="sm" variant={tab === "recap" ? "primary" : "outline"} onClick={() => setTab("recap")}>
          {rule ? tr(`Daily recap ${rule.recap_rows} days`, `Rekap harian ${rule.recap_rows} hari`) : tr("Daily recap", "Rekap harian")}
        </Button>
      </div>

      {tab === "detail" ? (
        <Loaded state={events} onRetry={reloadEvents}>
          {(all) => (
            <Card>
              <CardHeader
                title={tr(`${all.length} events`, `${all.length} kejadian`)}
                subtitle={tr("Coarse on purpose: screens opened, printed, exported. Not what was typed.", "Kasar dengan sengaja: layar yang dibuka, yang dicetak, yang diekspor. Bukan apa yang diketik.")}
                icon={Activity}
              />
              <Paged rows={all} pageSize={20} unit={tr("events", "kejadian")}>
                {(page) => (
                  <ul className="divide-y divide-slate-100">
                    {page.map((e) => (
                      <li key={e.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-2 text-[12px]">
                        <span className="w-[110px] shrink-0 font-mono text-[10px] text-slate-400">
                          {e.at.slice(5, 16).replace("T", " ")}
                        </span>
                        <Badge tone={e.kind === "export" || e.kind === "print" ? "amber" : "slate"}>{e.kind}</Badge>
                        <span className="text-[13px] text-slate-800">{e.label}</span>
                        <span className="font-mono text-[10px] text-slate-400">{e.target}</span>
                        <span className="flex-1" />
                        <span className="text-slate-500">{e.actor_email}</span>
                      </li>
                    ))}
                    {all.length === 0 && (
                      <li className="px-5 py-8 text-[13px] text-slate-500">{tr("No activity recorded yet.", "Belum ada aktivitas tercatat.")}</li>
                    )}
                  </ul>
                )}
              </Paged>
            </Card>
          )}
        </Loaded>
      ) : (
        <Loaded state={daily} onRetry={reloadDaily}>
          {(all) => (
            <Card>
              <CardHeader
                title={tr(`${all.length} daily recaps`, `${all.length} rekap harian`)}
                subtitle={tr(
                  "One row per person per day: how many, from what time to what time, which screens, how many changed something.",
                  "Satu baris per orang per hari: berapa banyak, dari jam berapa sampai jam berapa, layar apa saja, berapa yang mengubah sesuatu.",
                )}
                icon={Timer}
              />
              <Paged rows={all} pageSize={15} unit={tr("recaps", "rekap")}>
                {(page) => (
                  <ul className="divide-y divide-slate-100">
                    {page.map((d) => (
                      <li key={d.id} className="px-5 py-2.5">
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                          <span className="w-[86px] shrink-0 font-mono text-[11px] text-slate-500">{d.day}</span>
                          <span className="text-[13px] font-medium text-slate-800">{d.full_name}</span>
                          <span className="text-[12px] text-slate-500">
                            {tr(`${d.events} events`, `${d.events} kejadian`)}
                            {d.first_at && ` · ${officeClock(Date.parse(d.first_at))}–${d.last_at ? officeClock(Date.parse(d.last_at)) : ""}`}
                          </span>
                          <span className="flex-1" />
                          <Badge tone={d.changes > 0 ? "brand" : "slate"}>{tr(`${d.changes} changed`, `${d.changes} mengubah`)}</Badge>
                          {d.refusals > 0 && <Badge tone="red">{tr(`${d.refusals} refused`, `${d.refusals} ditolak`)}</Badge>}
                          {/* Counted apart from `mengubah`: a reveal changes
                              nothing, and it is the figure worth reading on its
                              own (D197). */}
                          {d.reveals > 0 && <Badge tone="violet">{tr(`${d.reveals} number reveals`, `${d.reveals} buka nomor`)}</Badge>}
                        </div>
                        <p className="mt-0.5 text-[11px] text-slate-500">
                          {d.top_screens.map((s) => `${s.label} (${s.count})`).join(" · ")}
                        </p>
                      </li>
                    ))}
                    {all.length === 0 && (
                      <li className="px-5 py-8 text-[13px] text-slate-500">{tr("No recaps yet.", "Belum ada rekap.")}</li>
                    )}
                  </ul>
                )}
              </Paged>
            </Card>
          )}
        </Loaded>
      )}
    </div>
  );
}
