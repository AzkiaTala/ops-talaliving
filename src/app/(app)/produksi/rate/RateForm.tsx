"use client";

import { useMemo, useState } from "react";
import { Save, Search, X } from "lucide-react";
import { Button } from "@/components/ui/primitives";
import { MoneyInput } from "@/components/ui/money-input";
import { useLoad } from "@/components/ui/loaded";
import { formatIDR } from "@/lib/format";
import { cn } from "@/lib/cn";
import { procurement, production } from "@/demo/api";
import {
  BOM_RATE_GROUPS, BOM_RATE_GROUP_LABELS,
  type BomRateGroup, type BomRateView,
} from "@/services/production/contracts";
import { useToast } from "@/store/toast";
import { useTr } from "@/lib/i18n";

/** The units a rate is usually quoted in. Free text all the same: a rate
 *  list is the one place a carpenter's day is a unit. */
export const RATE_UNITS = ["m3", "m2", "m1", "lembar", "batang", "kg", "ltr", "set", "pcs", "unit", "hari", "jam"];

const inputCls = "h-9 w-full rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none";

/** One rate, new or existing (0180's `save_bom_rate`). Used by the rate list
 *  and, inline, by the AI suggestion when the model names a material the list
 *  does not have yet — the estimator types its rate once, and every later
 *  BOM finds it. */
export function RateForm({
  initial, onSaved, onCancel, compact,
}: {
  initial?: Partial<BomRateView> & { name?: string };
  onSaved: (rate: BomRateView) => void;
  onCancel: () => void;
  /** Inline in another panel: no note, no retire switch. */
  compact?: boolean;
}) {
  const tr = useTr();
  const { toast } = useToast();
  const existing = initial?.code ? initial : null;
  const [name, setName] = useState(initial?.name ?? "");
  const [group, setGroup] = useState<BomRateGroup>(initial?.rate_group ?? "kayu");
  const [uom, setUom] = useState(initial?.uom ?? "m3");
  const [rate, setRate] = useState(initial?.rate ?? 0);
  const [itemCode, setItemCode] = useState<string | null>(initial?.item_code ?? null);
  const [itemName, setItemName] = useState<string | null>(initial?.item_name ?? null);
  const [note, setNote] = useState(initial?.note ?? "");
  const [active, setActive] = useState(initial?.active ?? true);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState("");
  const [picking, setPicking] = useState(false);
  const [items] = useLoad(() => procurement.listItems(), []);

  const matches = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term || items.status !== "ready") return [];
    return items.data
      .filter((i) => `${i.name} ${i.code} ${i.aka?.join(" ") ?? ""}`.toLowerCase().includes(term))
      .slice(0, 6);
  }, [q, items]);

  async function save() {
    setBusy(true);
    const res = await production.saveBomRate({
      code: existing?.code ?? null, name, rate_group: group, uom, rate,
      item_code: itemCode, note: note || null, active,
    });
    setBusy(false);
    if (res.error) {
      toast(res.error.status === 403 ? "critical" : "warning", tr("Rate not saved", "Rate tidak tersimpan"), res.error.message);
      return;
    }
    toast("success", existing ? tr("Rate saved", "Rate disimpan") : tr("Rate added to the list", "Rate masuk daftar"),
      `${res.data.code} · ${res.data.name} · ${formatIDR(res.data.rate)} / ${res.data.uom}`);
    onSaved(res.data);
  }

  return (
    <div className="space-y-2.5">
      <datalist id="rate-units">{RATE_UNITS.map((u) => <option key={u} value={u} />)}</datalist>
      <div className={cn("grid gap-2", compact ? "sm:grid-cols-[2fr_1.2fr_0.8fr_1.2fr]" : "sm:grid-cols-2")}>
        <label className="text-[11px] text-slate-500">{tr("Name + grade / spec", "Nama + grade / spesifikasi")}
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)}
            placeholder={tr("e.g. Mindi timber grade A", "mis. Kayu mindi grade A")} className={cn(inputCls, "mt-0.5")} />
        </label>
        <label className="text-[11px] text-slate-500">{tr("Group", "Kelompok")}
          <select value={group} onChange={(e) => setGroup(e.target.value as BomRateGroup)} className={cn(inputCls, "mt-0.5 bg-white")}>
            {BOM_RATE_GROUPS.map((g) => (
              <option key={g} value={g}>{tr(BOM_RATE_GROUP_LABELS[g].en, BOM_RATE_GROUP_LABELS[g].id)}</option>
            ))}
          </select>
        </label>
        <label className="text-[11px] text-slate-500">{tr("Per unit", "Per satuan")}
          <input value={uom} onChange={(e) => setUom(e.target.value)} list="rate-units" className={cn(inputCls, "mt-0.5")} />
        </label>
        <label className="text-[11px] text-slate-500">{tr(`Rate (Rp per ${uom || "unit"})`, `Rate (Rp per ${uom || "satuan"})`)}
          <MoneyInput value={rate} onChange={setRate} className="mt-0.5" />
        </label>
      </div>

      {/* The item this rate stands for, if procurement buys it. Optional: a
          finishing or labour rate stands for nothing bought. */}
      <div className="text-[11px] text-slate-500">
        {tr("Item in the items database (optional)", "Item di database items (opsional)")}
        {itemCode ? (
          <div className="mt-0.5 flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 text-[12px] text-slate-700">
            <span className="min-w-0 flex-1 truncate">{itemName ?? itemCode}</span>
            <span className="font-mono text-[10px] text-slate-400">{itemCode}</span>
            <button onClick={() => { setItemCode(null); setItemName(null); }} aria-label={tr("Unlink item", "Lepas item")}
              className="rounded p-0.5 text-slate-400 hover:bg-white hover:text-slate-700"><X className="h-3.5 w-3.5" /></button>
          </div>
        ) : picking ? (
          <div className="mt-0.5">
            <label className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-2">
              <Search className="h-4 w-4 text-slate-400" />
              <input autoFocus value={q} onChange={(e) => setQ(e.target.value)}
                placeholder={tr("Search items: name or code", "Cari item: nama atau kode")}
                aria-label={tr("Search items", "Cari item")} className="h-8 w-full bg-transparent text-sm focus:outline-none" />
            </label>
            <ul className="mt-1 divide-y divide-slate-100 overflow-hidden rounded-lg border border-slate-200 bg-white empty:hidden">
              {matches.map((i) => (
                <li key={i.code}>
                  <button onClick={() => { setItemCode(i.code); setItemName(i.name); setPicking(false); setQ(""); }}
                    className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[12px] hover:bg-brand-50/50">
                    <span className="min-w-0 flex-1 truncate text-slate-800">{i.name}</span>
                    <span className="font-mono text-[10px] text-slate-400">{i.code} · {i.base_uom}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <button onClick={() => setPicking(true)}
            className="mt-0.5 block rounded-lg border border-dashed border-slate-300 px-2 py-1.5 text-[12px] text-slate-600 hover:bg-slate-50">
            {tr("Link to an item — so a line priced from this rate can be bought and issued", "Tautkan ke item — supaya baris dengan rate ini bisa dibeli dan dikeluarkan gudang")}
          </button>
        )}
      </div>

      {!compact && (
        <>
          <label className="block text-[11px] text-slate-500">{tr("Note (optional)", "Catatan (opsional)")}
            <input value={note} onChange={(e) => setNote(e.target.value)}
              placeholder={tr("What the rate includes, where it came from", "Apa saja yang termasuk, dari mana angkanya")}
              className={cn(inputCls, "mt-0.5")} />
          </label>
          {existing && (
            <label className="flex items-center gap-2 text-[12px] text-slate-600">
              <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
              {tr("Active — offered when a BOM line is added", "Aktif — ditawarkan saat menambah baris BOM")}
            </label>
          )}
          {existing && (existing.used_by ?? 0) > 0 && (
            <p className="rounded-lg bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-800">
              {tr(
                `${existing.used_by} product BOM(s) follow this rate. A new figure moves their drafts; released revisions keep the rate they were released with.`,
                `${existing.used_by} BOM produk mengikuti rate ini. Angka baru menggeser draft-nya; revisi yang sudah dirilis tetap memakai rate saat dirilis.`,
              )}
            </p>
          )}
        </>
      )}

      <div className="flex justify-end gap-1.5">
        <Button size="sm" variant="ghost" onClick={onCancel} disabled={busy}>{tr("Cancel", "Batal")}</Button>
        <Button size="sm" icon={Save} onClick={save} disabled={busy || !name.trim() || !uom.trim()}>
          {existing ? tr("Save", "Simpan") : tr("Add to the rate list", "Tambah ke daftar rate")}
        </Button>
      </div>
    </div>
  );
}
