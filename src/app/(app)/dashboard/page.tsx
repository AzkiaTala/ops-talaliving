"use client";

import Link from "next/link";
import {
  AlertTriangle, ArrowRight, Banknote, Bell, CalendarDays, Inbox, Route, Wallet,
} from "lucide-react";
import { Badge, Button, Card, CardHeader, PageHeader, StatCard } from "@/components/ui/primitives";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Loaded, useLoad } from "@/components/ui/loaded";
import { AreaTrend } from "@/components/charts/charts";
import { formatIDR } from "@/lib/format";
import { cn } from "@/lib/cn";
import { accounting, procurement } from "@/demo/api";
import type { CashDue } from "@/services/accounting/contracts";
import type { TransactionView } from "@/services/accounting/contracts";
import { useTr } from "@/lib/i18n";

/** The first screen, on the same data as every other screen.
 *
 *  It used to be the shell's sample page — invented sales orders and a timber
 *  yield chart for a business that has neither in this system. That was
 *  defensible while it was proving the design system worked, and indefensible
 *  once every other screen was reading real derivations: the landing page was
 *  the only place in the app that could not be trusted (D118).
 *
 *  Five questions, in the order somebody actually asks them: how much money is
 *  there, does it last, what falls due next, what is waiting on a decision,
 *  and what is stuck. Every figure links to the screen that can act on it —
 *  a dashboard that cannot be acted on is a poster.
 */
export default function DashboardPage() {
  const tr = useTr();
  const [plan, reloadPlan] = useLoad(() => accounting.getCashPlan(), []);
  const [due] = useLoad(() => accounting.listDue(), []);
  const [queue] = useLoad(() => procurement.queue(), []);
  const [vendors] = useLoad(() => procurement.listVendorJourneys(), []);
  const [health] = useLoad(() => accounting.getInboxHealth(), []);
  const [rows] = useLoad(() => accounting.listTransactions({ limit: 8 }), []);

  const waiting = queue.status === "ready" ? queue.data : [];
  const waitingValue = waiting.reduce((s, l) => s + (l.item_total ?? 0), 0);
  const billable = vendors.status === "ready"
    ? vendors.data.reduce((s, v) => s + v.billable_now, 0)
    : 0;
  const stuck = health.status === "ready" ? health.data.unresolved : 0;

  const dueColumns: Column<CashDue>[] = [
    {
      key: "date",
      header: tr("Due", "Jatuh tempo"),
      render: (d) => <span className="whitespace-nowrap font-mono text-[12px] text-slate-500">{d.date}</span>,
    },
    {
      key: "what",
      header: tr("What", "Apa"),
      className: "whitespace-normal",
      render: (d) => (
        <span className="text-[13px] text-slate-800">
          {d.name}
          {d.vendor_name && <span className="text-slate-500"> · {d.vendor_name}</span>}
        </span>
      ),
    },
    {
      key: "amount",
      header: tr("Amount", "Jumlah"),
      align: "right",
      render: (d) => (
        <span className={cn(
          "whitespace-nowrap tabular-nums",
          d.direction === "IN" ? "text-emerald-700" : "text-slate-800",
        )}>
          {d.direction === "IN" ? "+ " : ""}{formatIDR(d.planned)}
        </span>
      ),
    },
    {
      key: "state",
      header: "",
      align: "right",
      render: (d) => d.state === "OVERDUE"
        ? <Badge tone="red">{tr(`${Math.abs(d.days_away)} day(s) late`, `terlambat ${Math.abs(d.days_away)} hari`)}</Badge>
        : <Badge tone={d.days_away <= 7 ? "amber" : "slate"}>{tr(`in ${d.days_away} day(s)`, `${d.days_away} hari lagi`)}</Badge>,
    },
  ];

  const ledgerColumns: Column<TransactionView>[] = [
    { key: "date", header: tr("Date", "Tanggal"), render: (t) => <span className="whitespace-nowrap font-mono text-[12px] text-slate-500">{t.trx_date}</span> },
    {
      key: "what", header: tr("What", "Apa"), className: "whitespace-normal",
      render: (t) => (
        <span className="block max-w-[420px] whitespace-normal break-words text-[13px] text-slate-700">
          {t.description}
          <span className="block text-[11px] text-slate-500">{t.type_code} · {t.account_code}</span>
        </span>
      ),
    },
    {
      key: "amount", header: tr("Amount", "Jumlah"), align: "right",
      render: (t) => (
        <span className={cn(
          "whitespace-nowrap tabular-nums",
          t.direction === "IN" ? "text-emerald-700" : "text-slate-800",
        )}>
          {t.direction === "IN" ? "+ " : "− "}{formatIDR(t.amount_idr)}
        </span>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        breadcrumb={tr("Overview", "Ringkasan")}
        title={tr("Today", "Hari ini")}
        description={tr(
          "Everything here is computed from the same demo data as the rest of the app — nothing on this page is invented.",
          "Semua di sini dihitung dari data demo yang sama dengan bagian lain aplikasi — tidak ada yang dikarang di halaman ini.",
        )}
      />

      <Loaded state={plan} onRetry={reloadPlan}>
        {(p) => (
          <>
            <div className="mb-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard
                label={tr("Cash today", "Kas hari ini")}
                value={formatIDR(p.opening_cash)}
                icon={Wallet}
                hint={tr("across the accounts that pay people", "di seluruh rekening yang dipakai membayar")}
              />
              <StatCard
                label={p.short_month ? tr("Money runs out", "Uang habis") : tr("Plan holds until", "Rencana bertahan sampai")}
                value={p.short_month
                  ? p.months.find((m) => m.month === p.short_month)?.label ?? "—"
                  : p.months[p.months.length - 1].label}
                icon={CalendarDays}
                tone={p.short_month ? "red" : "green"}
                hint={p.short_month ? tr(`short ${formatIDR(p.short_by)}`, `kurang ${formatIDR(p.short_by)}`) : tr("on the current plan", "dengan rencana saat ini")}
              />
              <StatCard
                label={tr("Waiting for a decision", "Menunggu keputusan")}
                value={waiting.length}
                icon={Bell}
                tone="amber"
                hint={waitingValue > 0 ? tr(`${formatIDR(waitingValue)} asked for`, `${formatIDR(waitingValue)} diajukan`) : tr("nothing pending", "tidak ada yang menunggu")}
              />
              <StatCard
                label={tr("Billable by suppliers", "Bisa ditagih pemasok")}
                value={formatIDR(billable)}
                icon={Route}
                tone={billable > 0 ? "amber" : "slate"}
                hint={tr("goods here that nobody has paid for", "barang sudah di sini tapi belum dibayar")}
              />
            </div>

            {(p.short_month || stuck > 0) && (
              <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-3 text-[13px] text-amber-900">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span className="flex-1">
                  {p.short_month && <>{p.verdict} </>}
                  {stuck > 0 && <>{tr(`${stuck} document(s) in the inbox still need a decision.`, `${stuck} dokumen di inbox masih menunggu keputusan.`)}</>}
                </span>
                {p.short_month && (
                  <Link href="/accounting/calendar">
                    <Button size="sm" variant="outline" icon={ArrowRight}>{tr("Open the calendar", "Buka kalender")}</Button>
                  </Link>
                )}
                {stuck > 0 && (
                  <Link href="/accounting/verifikasi">
                    <Button size="sm" variant="outline" icon={Inbox}>{tr("Open the inbox", "Buka inbox")}</Button>
                  </Link>
                )}
              </div>
            )}

            <Card className="mb-4">
              <CardHeader
                title={tr("Cash at the end of each month", "Kas di akhir tiap bulan")}
                subtitle={tr(
                  "On the current plan, twelve months forward. Where the line crosses zero is the month to act on.",
                  "Dengan rencana saat ini, dua belas bulan ke depan. Titik garis melewati nol adalah bulan yang harus ditindaklanjuti.",
                )}
                icon={CalendarDays}
                action={
                  <Link href="/accounting/calendar" className="text-[13px] text-brand-700 underline">
                    {tr("the calendar", "kalender")}
                  </Link>
                }
              />
              <div className="px-2 pb-3 pt-1">
                <AreaTrend
                  data={p.months.map((m) => ({ label: m.label.replace(" 20", " '"), closing: m.closing }))}
                  dataKey="closing"
                  height={220}
                />
              </div>
            </Card>
          </>
        )}
      </Loaded>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader
            title={tr("Due next", "Jatuh tempo berikutnya")}
            subtitle={tr("From the payment calendar — anything late comes first.", "Dari kalender pembayaran — yang terlambat tampil lebih dulu.")}
            icon={Bell}
            action={
              <Link href="/accounting/calendar" className="text-[13px] text-brand-700 underline">{tr("all of it", "semuanya")}</Link>
            }
          />
          <Loaded state={due} onRetry={() => {}} skeletonRows={4}>
            {(all) => (
              <DataTable
                dense
                columns={dueColumns}
                rows={all.slice(0, 6)}
                rowKey={(d) => `${d.component_id}:${d.date}`}
                empty={tr("Nothing falls due in the next three weeks.", "Tidak ada yang jatuh tempo dalam tiga minggu ke depan.")}
              />
            )}
          </Loaded>
        </Card>

        <Card>
          <CardHeader
            title={tr("Last money out", "Pengeluaran terakhir")}
            subtitle={tr("The most recent rows in the ledger.", "Baris terbaru di buku besar.")}
            icon={Banknote}
            action={
              <Link href="/accounting/ledger" className="text-[13px] text-brand-700 underline">{tr("the ledger", "buku besar")}</Link>
            }
          />
          <Loaded state={rows} onRetry={() => {}} skeletonRows={4}>
            {(all) => (
              <DataTable
                dense
                columns={ledgerColumns}
                rows={all.slice(0, 6)}
                rowKey={(t) => t.trx_no}
                empty={tr("Nothing has been posted yet.", "Belum ada yang dibukukan.")}
              />
            )}
          </Loaded>
        </Card>
      </div>
    </div>
  );
}
