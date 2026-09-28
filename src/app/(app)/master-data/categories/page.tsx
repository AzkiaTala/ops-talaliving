"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { FolderTree, Plus, Pencil, Trash2, CornerDownRight } from "lucide-react";
import { Badge, Button, Card, CardHeader, PageHeader } from "@/components/ui/primitives";
import { Modal } from "@/components/ui/drawer";
import { Loaded, SourceBadge, useLoad } from "@/components/ui/loaded";
import { categoryTree } from "@/components/ui/category-options";
import { procurement } from "@/demo/api";
import type { ItemCategory } from "@/services/procurement/contracts";
import { useToast } from "@/store/toast";
import { useSession } from "@/store/session";
import { useTr } from "@/lib/i18n";

/** The item category tree: **Category → Item type → Item** (owner,
 *  2026-09-23). *Packing → Foam Sheet → Foam Sheet 2mm*.
 *
 *  Two levels live here; the third is the item itself, whose name carries its
 *  specification — a different size, colour or unit is a different item, and
 *  is added on the Items page. A category or type is deleted only when
 *  nothing is filed under it.
 */
const inputClass =
  "mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-brand-400 focus:outline-none";

type Form = { mode: "create" | "edit"; code: string; name: string; parent_code: string };

export default function CategoriesPage() {
  const tr = useTr();
  const { can } = useSession();
  const { toast } = useToast();
  const mayEdit = can("procurement.update");
  const [cats, reloadCats] = useLoad(() => procurement.listCategories(), []);
  const [items] = useLoad(() => procurement.listItemViews({ include_archived: true }), []);
  const [form, setForm] = useState<Form | null>(null);
  const [saving, setSaving] = useState(false);

  /** Items filed directly under each code. */
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    if (items.status === "ready") {
      for (const i of items.data) m.set(i.category_code, (m.get(i.category_code) ?? 0) + 1);
    }
    return m;
  }, [items]);

  const list = cats.status === "ready" ? cats.data : [];
  const tops = list.filter((c) => !c.parent_code && c.code !== "uncurated");

  async function save() {
    if (!form) return;
    setSaving(true);
    const input = { name: form.name, parent_code: form.parent_code || null };
    const res = form.mode === "create"
      ? await procurement.createCategory(input)
      : await procurement.updateCategory(form.code, input);
    setSaving(false);
    if (res.error) {
      toast(res.error.status === 409 ? "warning" : "critical", tr("Not saved", "Tidak tersimpan"), res.error.message);
      return;
    }
    toast("success", form.mode === "create" ? tr("Added", "Ditambahkan") : tr("Saved", "Tersimpan"), res.data.name);
    setForm(null);
    reloadCats();
  }

  async function remove(c: ItemCategory) {
    setSaving(true);
    const res = await procurement.deleteCategory(c.code);
    setSaving(false);
    if (res.error) {
      toast(res.error.status === 409 ? "warning" : "critical", tr("Not deleted", "Tidak terhapus"), res.error.message);
      return;
    }
    toast("success", tr("Deleted", "Dihapus"), tr(`"${c.name}" is gone. Nothing was filed under it.`, `"${c.name}" sudah dihapus. Tidak ada yang tersimpan di bawahnya.`));
    setForm(null);
    reloadCats();
  }

  function row(c: ItemCategory, isType: boolean, typeCount: number) {
    const direct = counts.get(c.code) ?? 0;
    return (
      <li key={c.code} className={isType ? "flex items-center gap-2 py-2 pl-8 pr-3" : "flex items-center gap-2 px-3 py-2.5"}>
        {isType && <CornerDownRight className="h-3.5 w-3.5 shrink-0 text-slate-300" />}
        <span className="min-w-0 flex-1">
          <span className={isType ? "text-[13px] text-slate-700" : "text-sm font-semibold text-slate-800"}>{c.name}</span>
          <span className="ml-2 font-mono text-[10px] text-slate-400">{c.code}</span>
        </span>
        {!isType && typeCount > 0 && <Badge tone="slate">{tr(`${typeCount} type${typeCount === 1 ? "" : "s"}`, `${typeCount} jenis`)}</Badge>}
        <Link
          href={`/master-data/items?category=${encodeURIComponent(c.code)}`}
          className="shrink-0 text-[12px] tabular-nums text-brand-700 hover:underline"
        >
          {tr(`${direct} item${direct === 1 ? "" : "s"}`, `${direct} barang`)}
        </Link>
        {mayEdit && c.code !== "uncurated" && (
          <span className="flex shrink-0 gap-1">
            {!isType && (
              <Button
                variant="ghost" size="sm" icon={Plus}
                aria-label={tr(`Add item type under ${c.name}`, `Tambah jenis barang di bawah ${c.name}`)}
                onClick={() => setForm({ mode: "create", code: "", name: "", parent_code: c.code })}
              >
                {tr("Type", "Jenis")}
              </Button>
            )}
            <Button
              variant="ghost" size="sm" icon={Pencil}
              aria-label={tr(`Edit ${c.name}`, `Ubah ${c.name}`)}
              onClick={() => setForm({ mode: "edit", code: c.code, name: c.name, parent_code: c.parent_code ?? "" })}
            >
              <span className="sr-only">{tr("Edit", "Ubah")}</span>
            </Button>
          </span>
        )}
      </li>
    );
  }

  const editing = form?.mode === "edit" ? list.find((c) => c.code === form.code) : undefined;
  const editingHasTypes = !!editing && list.some((c) => c.parent_code === editing.code);

  return (
    <div>
      <PageHeader
        breadcrumb={tr("Master Data", "Data Master")}
        title={tr("Item categories", "Kategori barang")}
        description={tr("Category → Item type → Item. The item is the thing bought, with its specification in its name.", "Kategori → Jenis barang → Barang. Barang adalah benda yang dibeli, dengan spesifikasi di namanya.")}
        actions={mayEdit && (
          <Button icon={Plus} onClick={() => setForm({ mode: "create", code: "", name: "", parent_code: "" })}>
            {tr("Add category", "Tambah kategori")}
          </Button>
        )}
      />

      <Card>
        <CardHeader
          title={tr("Category tree", "Pohon kategori")}
          subtitle={tr("e.g. Packing → Foam Sheet → Foam Sheet 2mm. A different size, colour or unit is a different item.", "mis. Packing → Foam Sheet → Foam Sheet 2mm. Ukuran, warna, atau satuan yang berbeda adalah barang yang berbeda.")}
          icon={FolderTree}
          action={<SourceBadge state={cats} />}
        />
        <Loaded state={cats} onRetry={reloadCats}>
          {(all) => (
            <ul className="divide-y divide-slate-100" data-testid="category-tree">
              {categoryTree(all).map(({ top, types }) => (
                <li key={top.code}>
                  <ul className="divide-y divide-slate-50">
                    {row(top, false, types.length)}
                    {types.map((t) => row(t, true, 0))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </Loaded>
      </Card>

      <Modal
        open={!!form}
        onClose={() => setForm(null)}
        title={form?.mode === "create" ? (form.parent_code ? tr("Add item type", "Tambah jenis barang") : tr("Add category", "Tambah kategori")) : tr("Edit category", "Ubah kategori")}
      >
        {form && (
          <div className="space-y-3">
            <div>
              <label htmlFor="cat-name" className="block text-sm text-slate-600">{tr("Name", "Nama")}</label>
              <input
                id="cat-name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder={form.parent_code ? "e.g. Foam Sheet" : "e.g. Packing"}
                className={inputClass}
              />
            </div>
            <div>
              <label htmlFor="cat-parent" className="block text-sm text-slate-600">{tr("Sits under", "Berada di bawah")}</label>
              <select
                id="cat-parent"
                value={form.parent_code}
                onChange={(e) => setForm({ ...form, parent_code: e.target.value })}
                disabled={editingHasTypes || form.code === "uncurated"}
                className={inputClass + " bg-white"}
              >
                <option value="">{tr("— Top level (a category) —", "— Tingkat teratas (kategori) —")}</option>
                {tops.filter((t) => t.code !== form.code).map((t) => (
                  <option key={t.code} value={t.code}>{t.name} {tr("(an item type under it)", "(jenis barang di bawahnya)")}</option>
                ))}
              </select>
              {editingHasTypes && (
                <p className="mt-1 text-xs text-slate-500">{tr("It has item types of its own, so it stays a top-level category.", "Kategori ini punya jenis barang sendiri, jadi tetap menjadi kategori tingkat teratas.")}</p>
              )}
            </div>
            <p className="text-xs text-slate-500">
              {tr("Items are the third level and are added on the Items page — e.g.", "Barang adalah tingkat ketiga dan ditambahkan di halaman Barang — mis.")} <em>Foam Sheet 2mm</em> {tr("under", "di bawah")}
              <em> Packing › Foam Sheet</em>.
            </p>
            <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
              {form.mode === "edit" && form.code !== "uncurated" && (
                <Button
                  variant="ghost" icon={Trash2} className="mr-auto text-rose-700"
                  disabled={saving}
                  onClick={() => editing && remove(editing)}
                >
                  {tr("Delete", "Hapus")}
                </Button>
              )}
              <Button variant="outline" onClick={() => setForm(null)}>{tr("Cancel", "Batal")}</Button>
              <Button onClick={save} disabled={saving || !form.name.trim()}>
                {saving ? tr("Saving…", "Menyimpan…") : tr("Save", "Simpan")}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
