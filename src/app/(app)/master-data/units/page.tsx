"use client";

import { useState } from "react";
import { Ruler, Plus, ArrowRight, Trash2, Save, Repeat } from "lucide-react";
import { Badge, Button, Card, CardHeader, PageHeader } from "@/components/ui/primitives";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Modal } from "@/components/ui/drawer";
import { Loaded, SourceBadge, useLoad } from "@/components/ui/loaded";
import { forgetUnits } from "@/components/ui/uom-options";
import { procurement } from "@/demo/api";
import {
  UOM_DIMENSIONS, type Uom, type UomConversion, type UomDimension,
} from "@/services/procurement/contracts";
import { useToast } from "@/store/toast";
import { useSession } from "@/store/session";
import { useTr, type Message } from "@/lib/i18n";

/** Units of measure, and how they convert.
 *
 *  Every quantity in the system is written in one of these — request lines,
 *  orders, ledger lines, stock moves — so a unit's **code never changes** once
 *  it exists; only its name and dimension can be corrected. A unit is deleted
 *  only when nothing is measured in it, and the refusal says what still is.
 *
 *  A conversion is stored once, in one direction: `lusin → pcs = 12`. Its
 *  reverse is the same fact, so the second copy is refused rather than kept to
 *  one day disagree with the first.
 */
const inputClass =
  "mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-brand-400 focus:outline-none";

const DIM_LABEL: Record<UomDimension, Message> = {
  count: { en: "count", id: "jumlah" },
  mass: { en: "mass", id: "massa" },
  length: { en: "length", id: "panjang" },
  area: { en: "area", id: "luas" },
  volume: { en: "volume", id: "volume" },
  time: { en: "time", id: "waktu" },
};

type UnitForm = { mode: "create" | "edit"; code: string; name: string; dimension: UomDimension };
type ConvForm = {
  mode: "create" | "edit"; from_uom: string; to_uom: string;
  factor: string; yield_ratio: string; note: string;
};

export default function UnitsPage() {
  const tr = useTr();
  const { can } = useSession();
  const { toast } = useToast();
  const mayEdit = can("procurement.update");
  const [units, reloadUnits] = useLoad(() => procurement.listUom(), []);
  const [convs, reloadConvs] = useLoad(() => procurement.listUomConversions(), []);
  const [unitForm, setUnitForm] = useState<UnitForm | null>(null);
  const [convForm, setConvForm] = useState<ConvForm | null>(null);
  const [saving, setSaving] = useState(false);

  const unitList = units.status === "ready" ? units.data : [];

  async function saveUnit() {
    if (!unitForm) return;
    setSaving(true);
    const res = unitForm.mode === "create"
      ? await procurement.createUom({ code: unitForm.code, name: unitForm.name, dimension: unitForm.dimension })
      : await procurement.updateUom(unitForm.code, { name: unitForm.name, dimension: unitForm.dimension });
    setSaving(false);
    if (res.error) {
      toast(res.error.status === 409 ? "warning" : "critical", tr("Not saved", "Tidak tersimpan"), res.error.message);
      return;
    }
    toast("success", unitForm.mode === "create" ? tr("Unit added", "Satuan ditambahkan") : tr("Unit updated", "Satuan diperbarui"),
      `${res.data.code} — ${res.data.name}`);
    forgetUnits();
    setUnitForm(null);
    reloadUnits();
  }

  async function deleteUnit(code: string) {
    setSaving(true);
    const res = await procurement.deleteUom(code);
    setSaving(false);
    if (res.error) {
      toast(res.error.status === 409 ? "warning" : "critical", tr("Not deleted", "Tidak terhapus"), res.error.message);
      return;
    }
    toast("success", tr("Unit deleted", "Satuan dihapus"), tr(`"${code}" is gone. Nothing was measured in it.`, `"${code}" sudah dihapus. Tidak ada yang diukur dengan satuan ini.`));
    forgetUnits();
    setUnitForm(null);
    reloadUnits();
  }

  async function saveConv() {
    if (!convForm) return;
    const factor = Number(convForm.factor);
    const yieldRatio = convForm.yield_ratio.trim() === "" ? null : Number(convForm.yield_ratio);
    setSaving(true);
    const res = await procurement.saveUomConversion({
      from_uom: convForm.from_uom, to_uom: convForm.to_uom, factor,
      yield_ratio: yieldRatio, note: convForm.note,
    });
    setSaving(false);
    if (res.error) {
      toast(res.error.status === 409 ? "warning" : "critical", tr("Not saved", "Tidak tersimpan"), res.error.message);
      return;
    }
    toast("success", tr("Conversion saved", "Konversi tersimpan"), `1 ${res.data.from_uom} = ${res.data.factor} ${res.data.to_uom}`);
    setConvForm(null);
    reloadConvs();
  }

  async function deleteConv(fromUom: string, toUom: string) {
    setSaving(true);
    const res = await procurement.deleteUomConversion(fromUom, toUom);
    setSaving(false);
    if (res.error) { toast("critical", tr("Not deleted", "Tidak terhapus"), res.error.message); return; }
    toast("success", tr("Conversion deleted", "Konversi dihapus"), `${fromUom} → ${toUom}`);
    setConvForm(null);
    reloadConvs();
  }

  const unitColumns: Column<Uom>[] = [
    { key: "code", header: tr("Code", "Kode"), render: (u) => <span className="font-mono text-[13px] font-medium text-slate-800">{u.code}</span> },
    { key: "name", header: tr("Name", "Nama"), render: (u) => u.name },
    { key: "dim", header: tr("Dimension", "Dimensi"), render: (u) => <Badge tone="slate">{DIM_LABEL[u.dimension] ? tr(DIM_LABEL[u.dimension].en, DIM_LABEL[u.dimension].id) : u.dimension}</Badge> },
  ];

  const convColumns: Column<UomConversion>[] = [
    {
      key: "pair",
      header: tr("Conversion", "Konversi"),
      render: (c) => (
        <span className="inline-flex items-center gap-1.5 font-mono text-[13px] text-slate-800">
          1 {c.from_uom} <ArrowRight className="h-3.5 w-3.5 text-slate-400" /> {c.factor} {c.to_uom}
        </span>
      ),
    },
    {
      key: "yield",
      header: tr("Yield", "Rendemen"),
      align: "right",
      render: (c) => c.yield_ratio == null
        ? <span className="text-slate-300">—</span>
        : `${Math.round(c.yield_ratio * 100)}%`,
    },
    {
      key: "note",
      header: tr("Note", "Catatan"),
      className: "whitespace-normal",
      render: (c) => c.note ?? <span className="text-slate-300">—</span>,
    },
  ];

  return (
    <div>
      <PageHeader
        breadcrumb={tr("Master Data", "Data Master")}
        title={tr("Units", "Satuan")}
        description={tr("Every quantity in the system is written in one of these units. A unit's code never changes once created; a unit can be deleted only while nothing is measured in it.", "Setiap jumlah di sistem ditulis dalam salah satu satuan ini. Kode satuan tidak berubah setelah dibuat; satuan hanya bisa dihapus selama belum ada yang diukur dengannya.")}
        actions={mayEdit && (
          <Button icon={Plus} onClick={() => setUnitForm({ mode: "create", code: "", name: "", dimension: "count" })}>
            {tr("Add unit", "Tambah satuan")}
          </Button>
        )}
      />

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader
            title={tr("Units of measure", "Satuan ukur")}
            subtitle={units.status === "ready" ? tr(`${units.data.length} units`, `${units.data.length} satuan`) : undefined}
            icon={Ruler}
            action={<SourceBadge state={units} />}
          />
          <Loaded state={units} onRetry={reloadUnits}>
            {(rows) => (
              <DataTable
                dense
                columns={unitColumns}
                rows={rows}
                rowKey={(u) => u.code}
                onRowClick={mayEdit
                  ? (u) => setUnitForm({ mode: "edit", code: u.code, name: u.name, dimension: u.dimension })
                  : undefined}
                empty={tr("No units yet.", "Belum ada satuan.")}
              />
            )}
          </Loaded>
        </Card>

        <Card>
          <CardHeader
            title={tr("Conversions", "Konversi")}
            subtitle={tr("Stored once, in one direction. Yield is for conversions that lose material, like log to board.", "Disimpan sekali, satu arah. Rendemen untuk konversi yang kehilangan bahan, seperti log ke papan.")}
            icon={Repeat}
            action={mayEdit && (
              <Button
                size="sm"
                variant="outline"
                icon={Plus}
                className="shrink-0 whitespace-nowrap"
                onClick={() => setConvForm({
                  mode: "create", from_uom: unitList[0]?.code ?? "", to_uom: unitList[1]?.code ?? "",
                  factor: "", yield_ratio: "", note: "",
                })}
              >
                {tr("Add conversion", "Tambah konversi")}
              </Button>
            )}
          />
          <Loaded state={convs} onRetry={reloadConvs}>
            {(rows) => (
              <DataTable
                dense
                columns={convColumns}
                rows={rows}
                rowKey={(c) => c.id}
                onRowClick={mayEdit
                  ? (c) => setConvForm({
                    mode: "edit", from_uom: c.from_uom, to_uom: c.to_uom,
                    factor: String(c.factor), yield_ratio: c.yield_ratio == null ? "" : String(c.yield_ratio),
                    note: c.note ?? "",
                  })
                  : undefined}
                empty={tr("No conversions yet.", "Belum ada konversi.")}
              />
            )}
          </Loaded>
        </Card>
      </div>

      <Modal
        open={!!unitForm}
        onClose={() => setUnitForm(null)}
        title={unitForm?.mode === "create" ? tr("Add unit", "Tambah satuan") : tr(`Edit unit ${unitForm?.code ?? ""}`, `Ubah satuan ${unitForm?.code ?? ""}`)}
      >
        {unitForm && (
          <div className="space-y-3 text-sm">
            <div>
              <label htmlFor="uom-code" className="block text-xs text-slate-500">{tr("Code", "Kode")}</label>
              <input
                id="uom-code"
                value={unitForm.code}
                disabled={unitForm.mode === "edit"}
                onChange={(e) => setUnitForm({ ...unitForm, code: e.target.value.toLowerCase() })}
                placeholder={tr("e.g. carton", "mis. karton")}
                className={`${inputClass} font-mono disabled:bg-slate-50 disabled:text-slate-500`}
              />
              <p className="mt-1 text-xs text-slate-500">
                {unitForm.mode === "create"
                  ? tr("Short, lower-case, no spaces. It cannot be changed later — every line written in it keeps it.", "Pendek, huruf kecil, tanpa spasi. Tidak bisa diubah nanti — setiap baris yang ditulis dengannya tetap memakainya.")
                  : tr("The code cannot be changed: every line ever written in this unit uses it.", "Kode tidak bisa diubah: setiap baris yang pernah ditulis dengan satuan ini memakainya.")}
              </p>
            </div>
            <div>
              <label htmlFor="uom-name" className="block text-xs text-slate-500">{tr("Name", "Nama")}</label>
              <input
                id="uom-name"
                value={unitForm.name}
                onChange={(e) => setUnitForm({ ...unitForm, name: e.target.value })}
                placeholder={tr("e.g. Carton", "mis. Karton")}
                className={inputClass}
              />
            </div>
            <div>
              <label htmlFor="uom-dim" className="block text-xs text-slate-500">{tr("Dimension", "Dimensi")}</label>
              <select
                id="uom-dim"
                value={unitForm.dimension}
                onChange={(e) => setUnitForm({ ...unitForm, dimension: e.target.value as UomDimension })}
                className={inputClass}
              >
                {UOM_DIMENSIONS.map((d) => <option key={d} value={d}>{tr(DIM_LABEL[d].en, DIM_LABEL[d].id)}</option>)}
              </select>
            </div>
            <div className="flex justify-between gap-2 pt-2">
              {unitForm.mode === "edit" ? (
                <Button variant="outline" icon={Trash2} onClick={() => deleteUnit(unitForm.code)} disabled={saving}>
                  {tr("Delete", "Hapus")}
                </Button>
              ) : <span />}
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setUnitForm(null)}>{tr("Cancel", "Batal")}</Button>
                <Button
                  icon={Save}
                  onClick={saveUnit}
                  disabled={saving || !unitForm.code.trim() || !unitForm.name.trim()}
                >
                  {saving ? tr("Saving…", "Menyimpan…") : tr("Save", "Simpan")}
                </Button>
              </div>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        open={!!convForm}
        onClose={() => setConvForm(null)}
        title={convForm?.mode === "create" ? tr("Add conversion", "Tambah konversi") : tr("Edit conversion", "Ubah konversi")}
      >
        {convForm && (
          <div className="space-y-3 text-sm">
            <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-2">
              <div>
                <label htmlFor="conv-from" className="block text-xs text-slate-500">{tr("1 of", "1")}</label>
                <select
                  id="conv-from"
                  value={convForm.from_uom}
                  disabled={convForm.mode === "edit"}
                  onChange={(e) => setConvForm({ ...convForm, from_uom: e.target.value })}
                  className={`${inputClass} disabled:bg-slate-50`}
                >
                  {unitList.map((u) => <option key={u.code} value={u.code}>{u.code}</option>)}
                </select>
              </div>
              <ArrowRight className="mb-2.5 h-4 w-4 text-slate-400" />
              <div>
                <label htmlFor="conv-to" className="block text-xs text-slate-500">{tr("equals, in", "sama dengan, dalam")}</label>
                <select
                  id="conv-to"
                  value={convForm.to_uom}
                  disabled={convForm.mode === "edit"}
                  onChange={(e) => setConvForm({ ...convForm, to_uom: e.target.value })}
                  className={`${inputClass} disabled:bg-slate-50`}
                >
                  {unitList.map((u) => <option key={u.code} value={u.code}>{u.code}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label htmlFor="conv-factor" className="block text-xs text-slate-500">{tr("Factor", "Faktor")}</label>
              <input
                id="conv-factor"
                inputMode="decimal"
                value={convForm.factor}
                onChange={(e) => setConvForm({ ...convForm, factor: e.target.value })}
                placeholder={tr("e.g. 12", "mis. 12")}
                className={inputClass}
              />
              {convForm.factor && Number(convForm.factor) > 0 && (
                <p className="mt-1 text-xs text-slate-500">
                  1 {convForm.from_uom} = {convForm.factor} {convForm.to_uom}
                </p>
              )}
            </div>
            <div>
              <label htmlFor="conv-yield" className="block text-xs text-slate-500">{tr("Yield (optional, 0–1)", "Rendemen (opsional, 0–1)")}</label>
              <input
                id="conv-yield"
                inputMode="decimal"
                value={convForm.yield_ratio}
                onChange={(e) => setConvForm({ ...convForm, yield_ratio: e.target.value })}
                placeholder={tr("Only when material is lost, e.g. 0.52", "Hanya bila ada bahan yang hilang, mis. 0.52")}
                className={inputClass}
              />
            </div>
            <div>
              <label htmlFor="conv-note" className="block text-xs text-slate-500">{tr("Note", "Catatan")}</label>
              <input
                id="conv-note"
                value={convForm.note}
                onChange={(e) => setConvForm({ ...convForm, note: e.target.value })}
                placeholder={tr("e.g. screws, per factory box", "mis. sekrup, per kotak pabrik")}
                className={inputClass}
              />
            </div>
            <div className="flex justify-between gap-2 pt-2">
              {convForm.mode === "edit" ? (
                <Button
                  variant="outline"
                  icon={Trash2}
                  onClick={() => deleteConv(convForm.from_uom, convForm.to_uom)}
                  disabled={saving}
                >
                  {tr("Delete", "Hapus")}
                </Button>
              ) : <span />}
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setConvForm(null)}>{tr("Cancel", "Batal")}</Button>
                <Button
                  icon={Save}
                  onClick={saveConv}
                  disabled={saving || !(Number(convForm.factor) > 0) || convForm.from_uom === convForm.to_uom}
                >
                  {saving ? tr("Saving…", "Menyimpan…") : tr("Save", "Simpan")}
                </Button>
              </div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
