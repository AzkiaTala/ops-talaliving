"use client";

import { useState } from "react";
import Link from "next/link";
import { Route, ChevronRight, Plus, CheckCircle2, Landmark } from "lucide-react";
import { Badge, Button, Card, CardHeader, PageHeader } from "@/components/ui/primitives";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Loaded, SourceBadge, useLoad } from "@/components/ui/loaded";
import { formatIDR } from "@/lib/format";
import { cn } from "@/lib/cn";
import { procurement } from "@/demo/api";
import type { VendorJourney } from "@/services/procurement/contracts";
import { useSession } from "@/store/session";
import { NewPo } from "./NewPo";
import { useTr } from "@/lib/i18n";

/** What we owe every supplier, and where each order stands.
 *
 *  The strip at the top is the number nobody could get from the sheet: **what
 *  the company is on the hook for, across every vendor at once** — contracted
 *  and unpaid, and of that, the part goods have already arrived for. One is a
 *  commitment, the other is a bill somebody can send today, and they are not
 *  the same size.
 *
 *  Settled vendors are kept apart rather than mixed in (D102). A list where
 *  two thirds of the rows need nothing is a list people stop reading, and the
 *  settled ones are still one click away because "what did we pay HADI GLASS
 *  in July" is a real question.
 */
export default function TrackerPage() {
  const tr = useTr();
  const { can } = useSession();
  const [rows, reload] = useLoad(() => procurement.listVendorJourneys(), []);
  const [creating, setCreating] = useState(false);
  const [showSettled, setShowSettled] = useState(false);
  const mayCreate = can("procurement.create");

  const columns: Column<VendorJourney>[] = [
    {
      key: "vendor",
      header: tr("Vendor", "Vendor"),
      className: "whitespace-normal",
      render: (v) => (
        <div className="flex items-start gap-2">
          <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-slate-300" />
          <div className="max-w-[300px] whitespace-normal break-words">
            <p className="font-medium leading-snug text-slate-800">{v.vendor_name}</p>
            <p className="text-[11px] text-slate-500">{v.headline}</p>
          </div>
        </div>
      ),
    },
    { key: "orders", header: tr("Orders", "Order"), align: "right", render: (v) => <span className="tabular-nums text-[13px] text-slate-600">{v.orders}</span> },
    { key: "contract", header: tr("Contract", "Kontrak"), align: "right", render: (v) => <span className="tabular-nums text-slate-700">{formatIDR(v.contract_value)}</span> },
    { key: "paid", header: tr("Paid", "Dibayar"), align: "right", render: (v) => <span className="tabular-nums text-slate-700">{formatIDR(v.paid)}</span> },
    {
      key: "outstanding",
      header: tr("Outstanding", "Sisa utang"),
      align: "right",
      render: (v) => (
        <span className={cn("tabular-nums", v.outstanding > 0 ? "text-slate-800" : "text-slate-400")}>
          {formatIDR(v.outstanding)}
        </span>
      ),
    },
    {
      key: "billable",
      header: tr("Billable now", "Bisa ditagih sekarang"),
      align: "right",
      render: (v) => (
        <span className={cn(
          "tabular-nums font-semibold",
          v.billable_now > 0 ? "text-amber-700" : "text-slate-400",
        )}>
          {formatIDR(v.billable_now)}
        </span>
      ),
    },
    {
      key: "state",
      header: tr("Status", "Status"),
      render: (v) => v.billable_now > 0
        ? <Badge tone="amber">{tr("goods to be invoiced", "barang menunggu ditagih")}</Badge>
        : v.outstanding > 0
          ? <Badge tone="brand">{tr("contract open", "kontrak terbuka")}</Badge>
          : <Badge tone="green">{tr("fully settled", "lunas")}</Badge>,
    },
  ];

  return (
    <div>
      <PageHeader
        breadcrumb={tr("Procurement", "Pengadaan")}
        title={tr("Purchase tracker", "Pelacak pembelian")}
        description={tr(
          "Every supplier we have an order with: what is contracted, what has been paid, what has actually arrived, and what they could invoice next.",
          "Setiap pemasok yang punya order dengan kita: berapa yang dikontrak, yang sudah dibayar, yang benar-benar sudah tiba, dan yang bisa mereka tagih berikutnya.",
        )}
        actions={mayCreate ? (
          <Button icon={Plus} onClick={() => setCreating(true)}>{tr("Add new PO", "Tambah PO baru")}</Button>
        ) : undefined}
      />

      <Loaded state={rows} onRetry={reload}>
        {(all) => {
          const live = all.filter((v) => v.outstanding > 0 || v.billable_now > 0);
          const settled = all.filter((v) => v.outstanding === 0 && v.billable_now === 0);
          const contracted = all.reduce((s, v) => s + v.contract_value, 0);
          const paid = all.reduce((s, v) => s + v.paid, 0);
          const owed = all.reduce((s, v) => s + v.outstanding, 0);
          const billable = all.reduce((s, v) => s + v.billable_now, 0);
          const credit = all.reduce((s, v) => s + v.credit, 0);

          return (
            <>
              {/* What the company is on the hook for, across every vendor. */}
              <div className="mb-4 rounded-xl border border-slate-200 bg-white shadow-card">
                <dl className="grid divide-y divide-slate-100 sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-4 lg:divide-x">
                  {([
                    ["contracted", tr("Contracted", "Dikontrak"), formatIDR(contracted), tr(`${all.length} supplier(s), every open order`, `${all.length} pemasok, semua order terbuka`)],
                    ["paid", tr("Paid to date", "Dibayar sampai kini"), formatIDR(paid), tr("money that has left our bank", "uang yang sudah keluar dari bank kita")],
                    ["owed", tr("Owed to suppliers", "Utang ke pemasok"), formatIDR(owed), tr("contracted and not yet paid", "dikontrak dan belum dibayar")],
                    ["billable", tr("Billable now", "Bisa ditagih sekarang"), formatIDR(billable), tr("goods here that nobody has paid for", "barang sudah di sini tapi belum dibayar")],
                  ] as [string, string, string, string][]).map(([id, k, v, note]) => (
                    <div key={id} className="px-4 py-3.5">
                      <dt className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-slate-400">
                        {id === "owed" && <Landmark className="h-3 w-3" />}
                        {k}
                      </dt>
                      <dd className={cn(
                        "mt-0.5 text-xl font-bold tabular-nums tracking-tight",
                        id === "billable" && billable > 0 ? "text-amber-700" : "text-slate-800",
                      )}>
                        {v}
                      </dd>
                      <p className="text-[11px] text-slate-500">{note}</p>
                    </div>
                  ))}
                </dl>
                <p className="border-t border-slate-100 px-4 py-2 text-[12px] text-slate-500">
                  <strong className="text-slate-700">{formatIDR(owed)}</strong>{" "}
                  {tr("is the commitment;", "adalah komitmennya;")}{" "}
                  <strong className="text-amber-800">{formatIDR(billable)}</strong>{" "}
                  {tr(
                    "of it is a bill a supplier could send today. The rest waits on deliveries that have not happened.",
                    "di antaranya adalah tagihan yang bisa dikirim pemasok hari ini. Sisanya menunggu kiriman yang belum datang.",
                  )}
                  {credit > 0 && (
                    <>
                      {" "}{tr("Separately,", "Selain itu,")}{" "}
                      <strong className="text-slate-700">{formatIDR(credit)}</strong>{" "}
                      {tr(
                        "of goods arrived beyond what was ordered — credit sitting with vendors, not ours to spend.",
                        "barang datang melebihi pesanan — kredit yang ada di vendor, bukan uang kita untuk dibelanjakan.",
                      )}
                    </>
                  )}
                </p>
              </div>

              <Card className="mb-4">
                <CardHeader
                  title={tr(`${live.length} supplier(s) with something open`, `${live.length} pemasok dengan urusan terbuka`)}
                  subtitle={tr(
                    "Most billable first — the ones with goods here that nobody has paid for.",
                    "Yang paling bisa ditagih lebih dulu — pemasok yang barangnya sudah di sini tapi belum dibayar.",
                  )}
                  icon={Route}
                  action={<SourceBadge state={rows} />}
                />
                <DataTable
                  dense
                  columns={columns}
                  rows={live}
                  rowKey={(v) => v.vendor_id}
                  onRowClick={(v) => { window.location.href = `/procurement/tracker/${v.vendor_id}`; }}
                  empty={tr("Nothing open with any supplier.", "Tidak ada urusan terbuka dengan pemasok mana pun.")}
                />
              </Card>

              {/* Settled, kept apart. Still one click away. */}
              {settled.length > 0 && (
                <Card>
                  <CardHeader
                    title={tr(`${settled.length} fully settled`, `${settled.length} lunas`)}
                    subtitle={tr(
                      "Paid against everything that arrived. Nothing to do — kept because last month's questions arrive next month.",
                      "Sudah dibayar untuk semua yang datang. Tidak ada yang perlu dilakukan — tetap disimpan karena pertanyaan bulan lalu datang bulan depan.",
                    )}
                    icon={CheckCircle2}
                    action={
                      <Button variant="outline" size="sm" onClick={() => setShowSettled((v) => !v)}>
                        {showSettled ? tr("Hide", "Sembunyikan") : tr("Show", "Tampilkan")}
                      </Button>
                    }
                  />
                  {showSettled && (
                    <DataTable
                      dense
                      columns={columns}
                      rows={settled}
                      rowKey={(v) => v.vendor_id}
                      empty={tr("Nothing is fully settled yet.", "Belum ada yang lunas.")}
                      onRowClick={(v) => { window.location.href = `/procurement/tracker/${v.vendor_id}`; }}
                    />
                  )}
                </Card>
              )}

              {creating && (
                <NewPo onClose={() => setCreating(false)} onCreated={() => { setCreating(false); reload(); }} />
              )}
            </>
          );
        }}
      </Loaded>

      <p className="mt-4 text-[12px] text-slate-400">
        {tr(
          "Open a supplier to see every order, every payment and every delivery —",
          "Buka pemasok untuk melihat setiap order, pembayaran, dan kiriman —",
        )}{" "}
        <Link href="/procurement/po" className="underline">{tr("the plain order list", "daftar order biasa")}</Link>{" "}
        {tr("is still there.", "tetap tersedia.")}
      </p>
    </div>
  );
}
