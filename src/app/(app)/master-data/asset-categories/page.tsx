"use client";

import { useState } from "react";
import { MonitorSmartphone, Plus, Pencil, Trash2 } from "lucide-react";
import { Badge, Button, Card, CardHeader, PageHeader } from "@/components/ui/primitives";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Modal } from "@/components/ui/drawer";
import { Loaded, SourceBadge, useLoad } from "@/components/ui/loaded";
import { inventory } from "@/demo/api";
import type { AssetCategory } from "@/services/inventory/contracts";
import { useToast } from "@/store/toast";
import { useSession } from "@/store/session";
import { useTr } from "@/lib/i18n";

/** What kind of thing an asset is — CCTV, computers, vehicles (`0107`).
 *  The code is fixed once made; a category in use is retired, not deleted. */
const inputClass =
  "mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-brand-400 focus:outline-none";

type Form = { mode: "create" | "edit"; code: string; name: string; description: string; is_active: boolean };

export default function AssetCategoriesPage() {
  const tr = useTr();
  const { can } = useSession();
  const { toast } = useToast();
  const mayEdit = can("inventory.update");
  const [state, reload] = useLoad(() => inventory.listAssetCategories(), []);
  const [form, setForm] = useState<Form | null>(null);
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!form) return;
    setSaving(true);
    const res = await inventory.saveAssetCategory({
      code: form.code, name: form.name, description: form.description, is_active: form.is_active,
    });
    setSaving(false);
    if (res.error) { toast("warning", tr("Not saved", "Tidak tersimpan"), res.error.message); return; }
    toast("success", form.mode === "create" ? tr("Category added", "Kategori ditambahkan") : tr("Category saved", "Kategori tersimpan"), res.data.name);
    setForm(null);
    reload();
  }

  async function remove() {
    if (!form) return;
    setSaving(true);
    const res = await inventory.deleteAssetCategory(form.code);
    setSaving(false);
    if (res.error) { toast("warning", tr("Not deleted", "Tidak terhapus"), res.error.message); return; }
    toast("success", tr("Deleted", "Dihapus"), tr(`"${form.name}" is gone. No asset was in it.`, `"${form.name}" sudah dihapus. Tidak ada aset di dalamnya.`));
    setForm(null);
    reload();
  }

  const columns: Column<AssetCategory>[] = [
    {
      key: "name",
      header: tr("Category", "Kategori"),
      render: (c) => (
        <div>
          <p className="font-medium text-slate-800">
            {c.name}
            {!c.is_active && <Badge tone="slate" className="ml-2">{tr("Retired", "Dipensiunkan")}</Badge>}
          </p>
          <p className="font-mono text-[10px] text-slate-400">{c.code}</p>
        </div>
      ),
    },
    { key: "desc", header: tr("What goes in it", "Isinya"), render: (c) => <span className="text-slate-600">{c.description ?? "—"}</span> },
    {
      key: "edit",
      header: "",
      render: (c) => mayEdit ? (
        <Button
          variant="ghost" size="sm" icon={Pencil} aria-label={tr(`Edit ${c.name}`, `Ubah ${c.name}`)}
          onClick={() => setForm({ mode: "edit", code: c.code, name: c.name, description: c.description ?? "", is_active: c.is_active })}
        >
          <span className="sr-only">{tr("Edit", "Ubah")}</span>
        </Button>
      ) : null,
    },
  ];

  return (
    <div>
      <PageHeader
        breadcrumb={tr("Master Data", "Data Master")}
        title={tr("Asset categories", "Kategori aset")}
        description={tr("What kind of thing an asset is. Used by Inventory › Assets.", "Jenis benda sebuah aset. Dipakai oleh Inventaris › Aset.")}
        actions={mayEdit && (
          <Button icon={Plus} onClick={() => setForm({ mode: "create", code: "", name: "", description: "", is_active: true })}>
            {tr("Add category", "Tambah kategori")}
          </Button>
        )}
      />
      <Card>
        <CardHeader title={tr("All categories", "Semua kategori")} subtitle={tr("A category in use is retired, not deleted.", "Kategori yang sedang dipakai dipensiunkan, bukan dihapus.")} icon={MonitorSmartphone} action={<SourceBadge state={state} />} />
        <Loaded state={state} onRetry={reload}>
          {(rows) => <DataTable columns={columns} rows={rows} rowKey={(c) => c.code} dense empty={tr("No categories.", "Belum ada kategori.")} />}
        </Loaded>
      </Card>

      <Modal open={!!form} onClose={() => setForm(null)} title={form?.mode === "create" ? tr("Add asset category", "Tambah kategori aset") : tr(`Edit ${form?.name ?? ""}`, `Ubah ${form?.name ?? ""}`)}>
        {form && (
          <div className="space-y-3">
            <div>
              <label htmlFor="ac-name" className="block text-sm text-slate-600">{tr("Name", "Nama")}</label>
              <input id="ac-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder={tr("e.g. Air conditioners", "mis. AC")} className={inputClass} />
            </div>
            <div>
              <label htmlFor="ac-code" className="block text-sm text-slate-600">{tr("Code", "Kode")}</label>
              <input id="ac-code" value={form.code} disabled={form.mode === "edit"}
                onChange={(e) => setForm({ ...form, code: e.target.value.toLowerCase().replace(/\s+/g, "-") })}
                placeholder={tr("e.g. ac", "mis. ac")} className={inputClass + " font-mono disabled:bg-slate-50 disabled:text-slate-500"} />
            </div>
            <div>
              <label htmlFor="ac-desc" className="block text-sm text-slate-600">{tr("What goes in it", "Isinya")}</label>
              <input id="ac-desc" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className={inputClass} />
            </div>
            {form.mode === "edit" && (
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input id="ac-active" type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} />
                {tr("Active — offered when registering an asset", "Aktif — ditawarkan saat mendaftarkan aset")}
              </label>
            )}
            <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
              {form.mode === "edit" && (
                <Button variant="ghost" icon={Trash2} className="mr-auto text-rose-700" disabled={saving} onClick={remove}>{tr("Delete", "Hapus")}</Button>
              )}
              <Button variant="outline" onClick={() => setForm(null)}>{tr("Cancel", "Batal")}</Button>
              <Button onClick={save} disabled={saving || !form.name.trim() || form.code.trim().length < 2}>
                {saving ? tr("Saving…", "Menyimpan…") : tr("Save", "Simpan")}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
