"use client";

import { useState } from "react";
import { Boxes, AlertTriangle, Search, PackageMinus, PackagePlus, Camera } from "lucide-react";
import { Badge, Button, Card, CardHeader, PageHeader } from "@/components/ui/primitives";
import { Loaded, SourceBadge, useLoad } from "@/components/ui/loaded";
import { Paged } from "@/components/ui/pager";
import { formatIDR, formatNumber } from "@/lib/format";
import { cn } from "@/lib/cn";
import { inventory } from "@/demo/api";
import type { StockItemView } from "@/services/inventory/contracts";
import { StockDrawer } from "./StockDrawer";
import { RegisterItem } from "./RegisterItem";
import { useSession } from "@/store/session";
import { useTr } from "@/lib/i18n";

/** The rack.
 *
 *  Until now a delivery was confirmed, paid for, and forgotten: nothing in the
 *  system knew that sixty sheets of plywood were in the gudang, so nobody could
 *  ask whether the next request was needed (D170). This screen is the answer to
 *  three questions and deliberately not to a fourth:
 *
 *  - **What is on the rack** — summed from the movements, never stored (A3).
 *  - **What is about to stop the workshop** — below the minimum somebody set,
 *    sorted to the top. An item nobody set a minimum for is not *fine*; it is
 *    unstated, and it says so.
 *  - **What it is worth** — over the part that arrived with a price. Stock that
 *    came in unpriced is counted and left out of the value, and the figure is
 *    marked incomplete rather than quietly counting it as free (D172).
 *
 *  The fourth question — what the stock that *left* cost — is not answered
 *  here. FIFO, average and standard costing give three different numbers and
 *  nobody has said which one this business uses (Q43).
 */
export default function StockPage() {
  const tr = useTr();
  const { can } = useSession();
  const [rows, reload] = useLoad(() => inventory.listStock(), []);
  const [q, setQ] = useState("");
  const [group, setGroup] = useState("");
  const [lowOnly, setLowOnly] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [registering, setRegistering] = useState(false);
  const mayMove = can("inventory.update");
  const mayRegister = can("inventory.create");

  return (
    <div>
      <PageHeader
        breadcrumb={tr("Inventory", "Persediaan")}
        title={tr("Materials & hardware", "Bahan & hardware")}
        description={tr("Computed from every stock movement, not from a stored figure. Goods come in as soon as receiving is confirmed; they go out when production uses them.", "Dihitung dari setiap pergerakan barang, bukan dari angka yang disimpan. Barang masuk begitu penerimaan dikonfirmasi; keluar saat dipakai produksi.")}
        actions={
          <div className="flex items-center gap-2">
            {mayRegister && !registering && (
              <Button size="sm" icon={PackagePlus} onClick={() => setRegistering(true)}>{tr("Register an item", "Daftarkan barang")}</Button>
            )}
            <SourceBadge state={rows} />
          </div>
        }
      />

      {registering && (
        <RegisterItem
          mayCount={can("inventory.adjust")}
          onCancel={() => setRegistering(false)}
          onCreated={(code) => { setRegistering(false); reload(); setOpen(code); }}
        />
      )}

      <Loaded state={rows} onRetry={reload}>
        {(all) => {
          const shown = all
            .filter((r) => !group || r.group_code === group)
            .filter((r) => !lowOnly || r.below_min)
            .filter((r) => !q || `${r.item_code} ${r.item_name} ${r.item_name_local ?? ""} ${r.category_name}`.toLowerCase().includes(q.toLowerCase()));

          const groups = [...new Map(all.map((r) => [r.group_code, r.group_name])).entries()]
            .sort((a, b) => a[1].localeCompare(b[1]));

          const value = all.reduce((s, r) => s + (r.value ?? 0), 0);
          const unpriced = all.filter((r) => r.unpriced_qty > 0);
          const low = all.filter((r) => r.below_min);
          const noMin = all.filter((r) => r.min_qty == null);
          const never = all.filter((r) => r.moves_count === 0);
          const noPhoto = all.filter((r) => r.photo_count === 0);

          return (
            <>
              <div className="mb-4 rounded-xl border border-slate-200 bg-white shadow-card">
                <dl className="grid divide-y divide-slate-100 sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-4 lg:divide-x">
                  {([
                    ["value", tr("Stock value", "Nilai stok"), formatIDR(value),
                      unpriced.length > 0
                        ? tr(`${unpriced.length} items with incomplete prices`, `${unpriced.length} barang belum lengkap harganya`)
                        : tr("all stock has a price", "seluruh stok punya harga")],
                    ["kinds", tr("Item types", "Jenis barang"), String(all.length),
                      tr(`${never.length} never moved · ${noPhoto.length} without a photo`, `${never.length} belum pernah bergerak · ${noPhoto.length} belum ada foto`)],
                    ["low", tr("Below minimum", "Di bawah minimum"), String(low.length),
                      low.length > 0 ? tr("needs buying", "perlu dibelikan") : tr("nothing running low", "tidak ada yang menipis")],
                    ["nomin", tr("Minimum not set", "Minimum belum ditetapkan"), String(noMin.length),
                      noMin.length > 0 ? tr("cannot be called safe yet", "belum bisa dibilang aman") : tr("all have a limit", "semua punya batas")],
                  ] as [string, string, string, string][]).map(([id, k, v, note]) => (
                    <div key={id} className="px-4 py-3.5">
                      <dt className="text-[11px] uppercase tracking-wide text-slate-400">{k}</dt>
                      <dd className={cn(
                        "mt-0.5 text-xl font-bold tabular-nums tracking-tight",
                        id === "low" && low.length > 0 ? "text-amber-700" : "text-slate-800",
                      )}>
                        {v}
                      </dd>
                      <p className="text-[11px] text-slate-500">{note}</p>
                    </div>
                  ))}
                </dl>
                {unpriced.length > 0 && (
                  <p className="border-t border-slate-100 px-4 py-2 text-[12px] text-slate-500">
                    <strong className="text-slate-700">{tr("The value is incomplete.", "Nilainya belum lengkap.")}</strong>{" "}
                    {unpriced.map((r) => `${r.item_name} (${formatNumber(r.unpriced_qty)} ${r.uom})`).join(" · ")}{" "}
                    {tr("came in without a unit price, so they are left out — not counted as zero.", "masuk tanpa harga satuan, jadi tidak ikut dihitung — bukan dihitung nol.")}
                  </p>
                )}
              </div>

              {low.length > 0 && (
                <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-3 text-[13px] text-amber-900">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  <span>
                    {low.map((r) => tr(
                      `${r.item_name} — ${formatNumber(r.on_hand)} ${r.uom} left of a minimum of ${formatNumber(r.min_qty ?? 0)}`,
                      `${r.item_name} — sisa ${formatNumber(r.on_hand)} ${r.uom} dari minimum ${formatNumber(r.min_qty ?? 0)}`,
                    )).join(" · ")}
                  </span>
                </div>
              )}

              <Card>
                <CardHeader
                  title={tr(`${shown.length} of ${all.length} items`, `${shown.length} dari ${all.length} barang`)}
                  subtitle={tr("Click an item for its movement history, which products use it, and what is on order.", "Klik satu barang untuk riwayat pergerakannya, dipakai di produk apa saja, dan apa yang sedang dipesan.")}
                  icon={Boxes}
                  action={
                    <div className="flex flex-wrap items-center gap-2">
                      <label className="flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 px-2">
                        <Search className="h-3.5 w-3.5 text-slate-400" />
                        <input
                          value={q} onChange={(e) => setQ(e.target.value)}
                          placeholder={tr("Search items…", "Cari barang…")}
                          aria-label={tr("Search items", "Cari barang")}
                          className="h-7 w-36 text-sm focus:outline-none"
                        />
                      </label>
                      <select
                        value={group} onChange={(e) => setGroup(e.target.value)}
                        aria-label={tr("Category", "Kategori")}
                        className="h-8 rounded-lg border border-slate-200 px-2 text-[13px] focus:border-brand-400 focus:outline-none"
                      >
                        <option value="">{tr("All categories", "Semua kategori")}</option>
                        {groups.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
                      </select>
                      <Button
                        size="sm" variant={lowOnly ? "primary" : "outline"}
                        onClick={() => setLowOnly((v) => !v)}
                      >
                        {tr("Low only", "Menipis saja")}
                      </Button>
                    </div>
                  }
                />

                <Paged rows={shown} pageSize={20} unit={tr("items", "barang")}>
                  {(page) => (
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[820px] border-collapse text-[13px]">
                        <thead>
                          <tr className="border-b border-slate-200 bg-slate-50/70 text-[11px] uppercase tracking-wide text-slate-500">
                            <th className="px-4 py-2 text-left">{tr("Item", "Barang")}</th>
                            <th className="px-4 py-2 text-left">{tr("Category", "Kategori")}</th>
                            <th className="px-4 py-2 text-right">{tr("On the rack", "Di rak")}</th>
                            <th className="px-4 py-2 text-left">{tr("Location", "Lokasi")}</th>
                            <th className="px-4 py-2 text-right">{tr("Minimum", "Minimum")}</th>
                            <th className="px-4 py-2 text-right">{tr("Value", "Nilai")}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {page.map((r) => <Row key={r.item_code} row={r} onOpen={() => setOpen(r.item_code)} />)}
                          {shown.length === 0 && (
                            <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-500">{tr("Nothing matches.", "Tidak ada yang cocok.")}</td></tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  )}
                </Paged>

                <p className="flex flex-wrap items-start gap-2 border-t border-slate-100 px-4 py-2.5 text-[11px] text-slate-500">
                  <PackageMinus className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
                  <span>
                    {tr("Goods out are recorded from this screen or from their Job Order. Issuing more than is recorded is", "Barang keluar dicatat dari layar ini atau dari Job Order-nya. Mengeluarkan lebih banyak dari yang tercatat")}{" "}
                    <strong>{tr("not refused", "tidak ditolak")}</strong>{" "}
                    {tr(
                      "— the wood is there or it is not, and a screen that refuses to record reality only teaches people to stop recording. Stock that goes negative is flagged for a recount.",
                      "— kayunya ada atau tidak ada, dan layar yang menolak mencatat kenyataan hanya mengajari orang berhenti mencatat. Stok yang jadi minus ditandai supaya dihitung ulang.",
                    )}
                  </span>
                </p>
              </Card>

              {open && (
                <StockDrawer
                  itemCode={open}
                  mayMove={mayMove}
                  onClose={() => setOpen(null)}
                  onChanged={reload}
                />
              )}
            </>
          );
        }}
      </Loaded>
    </div>
  );
}

function Row({ row: r, onOpen }: { row: StockItemView; onOpen: () => void }) {
  const tr = useTr();
  return (
    <tr onClick={onOpen} className="cursor-pointer border-b border-slate-100 hover:bg-slate-50">
      <td className="px-4 py-2">
        <span className="block font-medium text-slate-800">{r.item_name}</span>
        {r.item_name_local && <span className="block text-[12px] text-slate-600">{r.item_name_local}</span>}
        <span className="flex items-center gap-1.5 font-mono text-[10px] text-slate-400">
          {r.item_code} · {tr("per", "per")} {r.uom}
          {r.photo_count === 0 ? (
            <span className="font-sans text-amber-700">· {tr("no photo yet", "belum ada foto")}</span>
          ) : (
            <span className="flex items-center gap-0.5 font-sans"><Camera className="h-3 w-3" />{r.photo_count}</span>
          )}
        </span>
      </td>
      <td className="px-4 py-2 text-slate-600">
        {r.category_name}
        <span className="block text-[11px] text-slate-400">{r.group_name}</span>
      </td>
      <td className="px-4 py-2 text-right">
        <span className={cn(
          "font-semibold tabular-nums",
          r.on_hand < 0 ? "text-rose-700" : r.below_min ? "text-amber-700" : "text-slate-800",
        )}>
          {formatNumber(r.on_hand)}
        </span>
        {r.on_hand < 0 && <span className="block text-[11px] text-rose-700">{tr("negative — needs a recount", "minus — perlu dihitung ulang")}</span>}
        {r.moves_count === 0 && <span className="block text-[11px] text-slate-400">{tr("never moved", "belum pernah bergerak")}</span>}
      </td>
      <td className="px-4 py-2 text-[12px] text-slate-600">
        {r.by_location.length === 0
          ? <span className="text-slate-300">—</span>
          : r.by_location.map((l) => `${l.location_name} ${formatNumber(l.qty)}`).join(" · ")}
      </td>
      <td className="px-4 py-2 text-right tabular-nums text-slate-600">
        {r.min_qty == null
          ? <span className="text-[11px] text-slate-400">{tr("not set", "belum ditetapkan")}</span>
          : formatNumber(r.min_qty)}
      </td>
      <td className="px-4 py-2 text-right">
        {r.value == null ? (
          <span className="text-[12px] text-amber-700">{tr("no price yet", "belum ada harga")}</span>
        ) : (
          <>
            <span className="tabular-nums text-slate-800">{formatIDR(r.value)}</span>
            {r.unpriced_qty > 0 && (
              <span className="block text-[11px] text-amber-700">
                {tr("incomplete", "belum lengkap")} · {formatNumber(r.unpriced_qty)} {r.uom} {tr("without a price", "tanpa harga")}
              </span>
            )}
          </>
        )}
      </td>
    </tr>
  );
}
