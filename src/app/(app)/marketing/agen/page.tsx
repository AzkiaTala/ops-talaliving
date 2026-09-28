"use client";

import { useState } from "react";
import { UserCheck, HandCoins, Plus, Check } from "lucide-react";
import { Badge, Button, Card, CardHeader, PageHeader } from "@/components/ui/primitives";
import { Loaded, SourceBadge, useLoad } from "@/components/ui/loaded";
import { Paged } from "@/components/ui/pager";
import { MoneyInput } from "@/components/ui/money-input";
import { formatIDR, formatNumber } from "@/lib/format";
import { cn } from "@/lib/cn";
import { marketing } from "@/demo/api";
import {
  REFERRAL_STATUS_LABEL,
  type ReferralStatus, type RepView,
} from "@/services/marketing/contracts";
import { useSession } from "@/store/session";
import { useToast } from "@/store/toast";
import { useTr } from "@/lib/i18n";

/** The agents who said yes, and what the business owes them (D185, D186).
 *
 *  This is the half an ordinary CRM has no shape for. The funnel ends when an
 *  agent agrees; the *programme* starts there. From that point the questions
 *  are: who have they introduced, which introductions became projects, and how
 *  much commission has been earned but not paid.
 *
 *  Commission is computed from **contracts that exist** — a project code and a
 *  value. A lead, a survey and a quotation are work in progress and contribute
 *  nothing to the figure, because a commission on a hoped-for size is a number
 *  somebody would eventually quote back at us.
 */
export default function RepsPage() {
  const tr = useTr();
  const { can } = useSession();
  const { toast } = useToast();
  const [reps, reload] = useLoad(() => marketing.listReps(), []);
  const [adding, setAdding] = useState<string | null>(null);
  const [draft, setDraft] = useState({ owner_name: "", unit: "", phone: "" });
  const [winning, setWinning] = useState<string | null>(null);
  const [win, setWin] = useState({ project_code: "", contract_value: 0 });
  const [busy, setBusy] = useState(false);
  const mayEdit = can("marketing.update");

  async function addReferral(repNo: string) {
    setBusy(true);
    const res = await marketing.addReferral({
      rep_no: repNo, owner_name: draft.owner_name,
      unit: draft.unit || null, phone: draft.phone || null,
    });
    setBusy(false);
    if (res.error) { toast("warning", tr("Not saved", "Tidak tersimpan"), res.error.message); return; }
    toast("success", tr(`${res.data.referral_no} recorded`, `${res.data.referral_no} tercatat`), draft.owner_name);
    setDraft({ owner_name: "", unit: "", phone: "" });
    setAdding(null);
    reload();
  }

  async function setStatus(referralNo: string, status: ReferralStatus) {
    setBusy(true);
    const res = await marketing.setReferralStatus({ referral_no: referralNo, status });
    setBusy(false);
    if (res.error) {
      /* WON is refused without a project and a value — that refusal is the
         point, so it is shown rather than swallowed. */
      toast("warning", tr("Not yet possible", "Belum bisa"), res.error.message);
      if (status === "WON") setWinning(referralNo);
      return;
    }
    toast("success", REFERRAL_STATUS_LABEL[status], "");
    reload();
  }

  async function recordWin(referralNo: string) {
    setBusy(true);
    const res = await marketing.setReferralStatus({
      referral_no: referralNo, status: "WON",
      project_code: win.project_code, contract_value: win.contract_value,
    });
    setBusy(false);
    if (res.error) { toast("warning", tr("Not yet possible", "Belum bisa"), res.error.message); return; }
    toast("success", tr("Became a project", "Jadi proyek"), `${win.project_code} · ${formatIDR(win.contract_value)}`);
    setWinning(null);
    setWin({ project_code: "", contract_value: 0 });
    reload();
  }

  return (
    <div>
      <PageHeader
        breadcrumb={tr("Marketing", "Marketing")}
        title={tr("Representatives & commission", "Representative & komisi")}
        description={tr("Agents who have agreed, the unit owners they brought in, and the commission owed. Commission is only calculated from contracts that actually exist.", "Agen yang sudah setuju, pemilik unit yang mereka bawa, dan komisi yang terutang. Komisi hanya dihitung dari kontrak yang benar-benar ada.")}
        actions={<SourceBadge state={reps} />}
      />

      <Loaded state={reps} onRetry={reload}>
        {(all) => {
          const unpaid = all.reduce((s, r) => s + r.commission_unpaid, 0);
          const wonValue = all.reduce((s, r) => s + r.won_value, 0);
          const leads = all.reduce((s, r) => s + r.leads, 0);

          return (
            <>
              <div className="mb-4 rounded-xl border border-slate-200 bg-white shadow-card">
                <dl className="grid divide-y divide-slate-100 sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-4 lg:divide-x">
                  {([
                    [tr("Representatives", "Representative"), String(all.length), tr("agents who have agreed", "agen yang sudah setuju")],
                    [tr("Leads in", "Kontak masuk"), String(leads), tr("unit owners brought in", "pemilik unit yang dibawa")],
                    [tr("Project value from agents", "Nilai proyek dari agen"), formatIDR(wonValue), tr("contracts already signed", "kontrak yang sudah jadi")],
                    [tr("Unpaid commission", "Komisi belum dibayar"), formatIDR(unpaid), unpaid > 0 ? tr("owed to agents", "utang ke agen") : tr("none", "tidak ada")],
                  ] as [string, string, string][]).map(([k, v, note]) => (
                    <div key={k} className="px-4 py-3.5">
                      <dt className="text-[11px] uppercase tracking-wide text-slate-400">{k}</dt>
                      <dd className={cn(
                        "mt-0.5 text-xl font-bold tabular-nums tracking-tight",
                        k === tr("Unpaid commission", "Komisi belum dibayar") && unpaid > 0 ? "text-amber-700" : "text-slate-800",
                      )}>
                        {v}
                      </dd>
                      <p className="text-[11px] text-slate-500">{note}</p>
                    </div>
                  ))}
                </dl>
                <p className="border-t border-slate-100 px-4 py-2 text-[12px] text-slate-500">
                  <strong className="text-slate-700">{tr("Commission is paid through the ledger", "Komisi dibayar lewat ledger")}</strong>
                  {tr(
                    ", like any other money going out — this screen records how much is owed, it does not pay it.",
                    ", seperti uang keluar lainnya — layar ini mencatat berapa yang terutang, bukan membayarnya.",
                  )}
                </p>
              </div>

              {all.length === 0 && (
                <Card>
                  <p className="px-5 py-8 text-[13px] text-slate-500">
                    {tr(
                      "No agents have agreed yet. Onboarding is done from the pipeline screen, on agents who have replied.",
                      "Belum ada agen yang setuju. Onboarding dilakukan dari layar pipeline, pada agen yang sudah membalas.",
                    )}
                  </p>
                </Card>
              )}

              <div className="space-y-4">
                {all.map((rep) => (
                  <RepCard
                    key={rep.id} rep={rep} mayEdit={mayEdit} busy={busy}
                    adding={adding === rep.rep_no}
                    draft={draft} setDraft={setDraft}
                    onAdd={() => setAdding(adding === rep.rep_no ? null : rep.rep_no)}
                    onSubmit={() => addReferral(rep.rep_no)}
                    onStatus={setStatus}
                    winning={winning} setWinning={setWinning}
                    win={win} setWin={setWin} onWin={recordWin}
                  />
                ))}
              </div>
            </>
          );
        }}
      </Loaded>
    </div>
  );
}

function RepCard({
  rep, mayEdit, busy, adding, draft, setDraft, onAdd, onSubmit, onStatus,
  winning, setWinning, win, setWin, onWin,
}: {
  rep: RepView;
  mayEdit: boolean;
  busy: boolean;
  adding: boolean;
  draft: { owner_name: string; unit: string; phone: string };
  setDraft: (d: { owner_name: string; unit: string; phone: string }) => void;
  onAdd: () => void;
  onSubmit: () => void;
  onStatus: (referralNo: string, status: ReferralStatus) => void;
  winning: string | null;
  setWinning: (v: string | null) => void;
  win: { project_code: string; contract_value: number };
  setWin: (v: { project_code: string; contract_value: number }) => void;
  onWin: (referralNo: string) => void;
}) {
  const tr = useTr();
  return (
    <Card>
      <CardHeader
        title={`${rep.name}${rep.agency ? ` · ${rep.agency}` : ""}`}
        subtitle={`${rep.rep_no} · ${rep.market?.label ?? tr("cross-market", "lintas pasar")} · ${tr("commission", "komisi")} ${formatNumber(rep.commission_percent)}% · onboarding ${rep.onboarded_on}${rep.from_properties.length ? ` · ${tr("from", "dari")} ${rep.from_properties.join(", ")}` : ""}`}
        icon={UserCheck}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={rep.commission_unpaid > 0 ? "amber" : "green"}>
              {rep.commission_unpaid > 0 ? tr(`${formatIDR(rep.commission_unpaid)} owed`, `${formatIDR(rep.commission_unpaid)} terutang`) : tr("nothing owed", "tidak ada utang")}
            </Badge>
            {mayEdit && (
              <Button size="sm" variant="outline" icon={Plus} onClick={onAdd}>
                {adding ? tr("Close", "Tutup") : tr("New lead", "Kontak baru")}
              </Button>
            )}
          </div>
        }
      />

      <dl className="grid divide-y divide-slate-100 border-t border-slate-100 sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-4 lg:divide-x">
        {([
          [tr("Leads", "Kontak"), String(rep.leads), tr("brought in by this agent", "dibawa agen ini")],
          [tr("Became projects", "Jadi proyek"), String(rep.won), tr(`of ${rep.leads}`, `dari ${rep.leads}`)],
          [tr("Contract value", "Nilai kontrak"), formatIDR(rep.won_value), tr("already signed", "yang sudah jadi")],
          [tr("Commission", "Komisi"), formatIDR(rep.commission_earned), tr(`${formatNumber(rep.commission_percent)}% of contract value`, `${formatNumber(rep.commission_percent)}% dari nilai kontrak`)],
        ] as [string, string, string][]).map(([k, v, note]) => (
          <div key={k} className="px-4 py-2.5">
            <dt className="text-[10px] uppercase tracking-wide text-slate-400">{k}</dt>
            <dd className="text-[16px] font-semibold tabular-nums text-slate-800">{v}</dd>
            <p className="text-[11px] text-slate-500">{note}</p>
          </div>
        ))}
      </dl>

      {adding && mayEdit && (
        <div className="grid gap-2 border-t border-slate-100 px-5 py-3 sm:grid-cols-[1fr_130px_150px_auto]">
          <input
            value={draft.owner_name} onChange={(e) => setDraft({ ...draft, owner_name: e.target.value })}
            placeholder={tr("Unit owner name", "Nama pemilik unit")} aria-label={tr("Owner name", "Nama pemilik")}
            className="h-9 rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none"
          />
          <input
            value={draft.unit} onChange={(e) => setDraft({ ...draft, unit: e.target.value })}
            placeholder={tr("Unit", "Unit")} aria-label={tr("Unit", "Unit")}
            className="h-9 rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none"
          />
          <input
            value={draft.phone} onChange={(e) => setDraft({ ...draft, phone: e.target.value })}
            placeholder={tr("Phone", "Telepon")} aria-label={tr("Phone", "Telepon")}
            className="h-9 rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none"
          />
          <Button size="sm" disabled={busy || !draft.owner_name.trim()} onClick={onSubmit}>{tr("Save", "Simpan")}</Button>
        </div>
      )}

      <Paged rows={rep.referrals} pageSize={10} unit={tr("leads", "kontak")}>
        {(page) => (
          <ul className="divide-y divide-slate-100 border-t border-slate-100">
            {page.map((r) => (
              <li key={r.id} className="px-5 py-2.5">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="text-[13px] font-medium text-slate-800">{r.owner_name}</span>
                  <span className="text-[12px] text-slate-500">
                    {r.unit ?? "—"}{r.property_ref ? ` · ${r.property_ref}` : ""}
                  </span>
                  <Badge tone={r.status === "WON" ? "green" : r.status === "LOST" ? "red" : "brand"}>
                    {REFERRAL_STATUS_LABEL[r.status]}
                  </Badge>
                  {r.status === "WON" && (
                    <span className="text-[12px] text-slate-600">
                      {r.project_code} · {formatIDR(r.contract_value ?? 0)}
                      <span className="ml-2 text-slate-400">
                        {tr("commission", "komisi")} {formatIDR(Math.round((r.contract_value ?? 0) * rep.commission_percent / 100))}
                        {r.commission_trx_no ? tr(` · paid ${r.commission_trx_no}`, ` · dibayar ${r.commission_trx_no}`) : tr(" · unpaid", " · belum dibayar")}
                      </span>
                    </span>
                  )}
                  <span className="flex-1" />
                  <span className="font-mono text-[10px] text-slate-400">{r.referral_no}</span>
                </div>
                {r.note && <p className="mt-0.5 text-[11px] text-slate-500">{r.note}</p>}

                {mayEdit && r.status !== "WON" && r.status !== "LOST" && (
                  winning === r.referral_no ? (
                    <div className="mt-2 grid gap-2 sm:grid-cols-[140px_180px_auto_auto]">
                      <input
                        value={win.project_code} onChange={(e) => setWin({ ...win, project_code: e.target.value })}
                        placeholder={tr("Project code", "Kode proyek")} aria-label={tr("Project code", "Kode proyek")}
                        className="h-9 rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none"
                      />
                      <MoneyInput value={win.contract_value} onChange={(v) => setWin({ ...win, contract_value: v })} />
                      <Button size="sm" icon={Check} disabled={busy || !win.project_code.trim() || win.contract_value <= 0}
                        onClick={() => onWin(r.referral_no)}>
                        {tr("Record project", "Catat proyek")}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setWinning(null)}>{tr("Cancel", "Batal")}</Button>
                    </div>
                  ) : (
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {(["SURVEYED", "QUOTED", "LOST"] as ReferralStatus[]).filter((s) => s !== r.status).map((s) => (
                        <Button key={s} size="sm" variant="outline" disabled={busy} onClick={() => onStatus(r.referral_no, s)}>
                          {REFERRAL_STATUS_LABEL[s]}
                        </Button>
                      ))}
                      <Button size="sm" icon={HandCoins} disabled={busy} onClick={() => setWinning(r.referral_no)}>
                        {tr("Became a project", "Jadi proyek")}
                      </Button>
                    </div>
                  )
                )}
              </li>
            ))}
            {rep.referrals.length === 0 && (
              <li className="px-5 py-5 text-[13px] text-slate-500">{tr("No leads from this agent yet.", "Belum ada kontak dari agen ini.")}</li>
            )}
          </ul>
        )}
      </Paged>
    </Card>
  );
}
