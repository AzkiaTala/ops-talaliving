"use client";

import { useState } from "react";
import { AlertTriangle, FileSpreadsheet, Upload } from "lucide-react";
import { Modal } from "@/components/ui/drawer";
import { Button } from "@/components/ui/primitives";
import { formatIDR, formatNumber } from "@/lib/format";
import { hr } from "@/demo/api";
import { splitCsvLine } from "@/lib/csv";
import { useToast } from "@/store/toast";
import { useTr } from "@/lib/i18n";

/** Reading the company's own overtime form.
 *
 *  The paper exists already — *FORM LEMBUR KARYAWAN PT TALAHOME*: twenty
 *  numbered rows of **NO · NAMA · DESCRIPTION · GAJI · JAM · TTD**, a date at
 *  the top and three signature blocks at the foot. So the system reads that
 *  shape rather than asking a supervisor to retype the night into a different
 *  one (D154).
 *
 *  People are matched **by name**, because that is the only identifier the
 *  form carries. A name the system does not recognise is listed back and its
 *  row left out — never created, never guessed. The signed paper itself is
 *  attached separately as the surat lembur, which is what leadership signs
 *  against (D146).
 */
type Row = { no: string; name: string; description: string; gaji: number | null; jam: number | null };

/** The export of that sheet: a header row somewhere in the first few lines,
 *  then the numbered rows. Blank rows are the unused part of the form and are
 *  simply skipped. */
function parseForm(text: string): { rows: Row[]; blank: number } {
  /* Quote-aware: a spreadsheet writes `"105,000"` as one cell, and splitting
     on every comma shifted the hours into the signature column (F47). */
  const lines = text.split(/\r?\n/).map(splitCsvLine);
  const headerAt = lines.findIndex((c) =>
    c.some((x) => x.trim().toUpperCase() === "NAMA")
    && c.some((x) => ["JAM", "GAJI"].includes(x.trim().toUpperCase())));
  if (headerAt === -1) return { rows: [], blank: 0 };

  const header = lines[headerAt].map((h) => h.trim().toUpperCase());
  const col = (name: string) => header.indexOf(name);
  const iNo = col("NO");
  const iName = col("NAMA");
  const iDesc = col("DESCRIPTION");
  const iGaji = col("GAJI");
  const iJam = col("JAM");

  /* Rupiah as typed on a form: `70.000`, `Rp 70,000`, `70000`. */
  const money = (v: string | undefined) => {
    const digits = (v ?? "").replace(/[^\d]/g, "");
    return digits ? Number(digits) : null;
  };
  /* Hours as typed: `2`, `2,5`, `2.5`, and `2:30` which means two and a half. */
  const hours = (v: string | undefined) => {
    const raw = (v ?? "").trim();
    if (!raw) return null;
    const hm = raw.match(/^(\d+)[:.](\d{2})$/);
    if (hm) return Number(hm[1]) + Number(hm[2]) / 60;
    const n = Number(raw.replace(",", "."));
    return Number.isFinite(n) ? n : null;
  };

  const rows: Row[] = [];
  let blank = 0;
  for (const c of lines.slice(headerAt + 1)) {
    const name = (iName >= 0 ? c[iName] : "")?.trim() ?? "";
    const jam = hours(iJam >= 0 ? c[iJam] : undefined);
    if (!name) { blank += 1; continue; }
    rows.push({
      no: (iNo >= 0 ? c[iNo] : "")?.trim() ?? "",
      name,
      description: (iDesc >= 0 ? c[iDesc] : "")?.trim() ?? "",
      gaji: money(iGaji >= 0 ? c[iGaji] : undefined),
      jam,
    });
  }
  return { rows, blank };
}

export function ImportForm({
  sheetNo, onClose, onDone,
}: {
  sheetNo: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const { toast } = useToast();
  const tr = useTr();
  const [file, setFile] = useState<{ name: string; rows: Row[]; blank: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ added: number; skipped: number; unknown: string[] } | null>(null);

  async function read(f: File) {
    const text = await f.text();
    const { rows, blank } = parseForm(text);
    setResult(null);
    setFile({ name: f.name, rows, blank });
    if (rows.length === 0) {
      toast("warning", tr("Could not read", "Tidak terbaca"), tr("That file has no NAMA + JAM rows. Make sure the column headings were exported too.", "Tidak ada baris NAMA + JAM di file itu. Pastikan judul kolomnya ikut ter-export."));
    }
  }

  async function run() {
    if (!file) return;
    setBusy(true);
    const res = await hr.importOvertimeForm({ sheet_no: sheetNo, filename: file.name, rows: file.rows });
    setBusy(false);
    if (res.error) {
      toast(res.error.status === 403 ? "critical" : "warning", tr("Not imported", "Tidak masuk"), res.error.message);
      return;
    }
    setResult({ added: res.data.added, skipped: res.data.skipped, unknown: res.data.unknown });
    toast(
      res.data.added > 0 ? "success" : "info",
      tr(`${res.data.added} names added`, `${res.data.added} nama masuk`),
      res.data.unknown.length > 0
        ? tr(`${res.data.unknown.length} names not recognised`, `${res.data.unknown.length} nama tidak dikenal`)
        : tr("All names matched.", "Semua nama cocok."),
    );
  }

  const withHours = file?.rows.filter((r) => r.jam && r.jam > 0).length ?? 0;
  const totalHours = file?.rows.reduce((a, r) => a + (r.jam ?? 0), 0) ?? 0;
  const totalMoney = file?.rows.reduce((a, r) => a + (r.gaji ?? 0), 0) ?? 0;

  return (
    <Modal
      open onClose={onClose} width="max-w-xl"
      title={tr("Upload overtime form", "Upload form lembur")}
      footer={
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] text-slate-500">{tr("Names already on this sheet are not added twice.", "Nama yang sudah ada di lembar ini tidak ditambah dua kali.")}</p>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose} disabled={busy}>{result ? tr("Close", "Tutup") : tr("Cancel", "Batal")}</Button>
            {result ? (
              <Button onClick={onDone}>{tr("View the sheet", "Lihat lembarnya")}</Button>
            ) : (
              <Button icon={Upload} onClick={run} disabled={busy || !file || file.rows.length === 0}>
                {busy ? tr("Reading…", "Membaca…") : file ? tr(`Add ${file.rows.length} rows`, `Masukkan ${file.rows.length} baris`) : tr("Add", "Masukkan")}
              </Button>
            )}
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        <div>
          <label htmlFor="form-file" className="block text-xs text-slate-500">
            {tr("PT Talahome overtime form", "Form lembur PT Talahome")} — <code className="text-[11px]">NO, NAMA, DESCRIPTION, GAJI, JAM, TTD</code>
          </label>
          <input
            id="form-file" type="file" accept=".csv,text/csv,text/plain"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void read(f); }}
            className="mt-1 block w-full rounded-lg border border-dashed border-slate-300 px-3 py-4 text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-brand-50 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-brand-700 hover:border-brand-300"
          />
          <p className="mt-1 text-[11px] text-slate-500">
            {tr(
              "Export the sheet as CSV. Blank rows on the form are ignored; the TTD column is not read — the signatures are on paper, and that paper is attached as the surat lembur.",
              "Export sheet-nya sebagai CSV. Baris kosong di form diabaikan; kolom TTD tidak dibaca — tanda tangannya ada di kertas, dan kertas itu dilampirkan sebagai surat lembur.",
            )}
          </p>
        </div>

        {file && !result && (
          <div className="rounded-xl border border-slate-200 bg-slate-50/60 px-4 py-3">
            <p className="flex items-center gap-2 text-[13px] font-medium text-slate-800">
              <FileSpreadsheet className="h-4 w-4 text-slate-400" /> {file.name}
            </p>
            <dl className="mt-2 grid grid-cols-3 gap-2 text-[12px]">
              <div>
                <dt className="text-slate-500">{tr("Filled rows", "Baris terisi")}</dt>
                <dd className="font-semibold tabular-nums text-slate-800">{file.rows.length}</dd>
              </div>
              <div>
                <dt className="text-slate-500">{tr("Total hours", "Total jam")}</dt>
                <dd className="font-semibold tabular-nums text-slate-800">{formatNumber(totalHours)}</dd>
              </div>
              <div>
                <dt className="text-slate-500">{tr("Total pay on the form", "Total gaji di form")}</dt>
                <dd className="font-semibold tabular-nums text-slate-800">
                  {totalMoney > 0 ? formatIDR(totalMoney) : "—"}
                </dd>
              </div>
            </dl>
            {withHours < file.rows.length && (
              <p className="mt-2 text-[11px] text-amber-700">
                {tr(
                  `${file.rows.length - withHours} rows have a name but no hours — they are still added with 0 hours so they show and can be fixed.`,
                  `${file.rows.length - withHours} baris punya nama tapi tidak ada jamnya — tetap masuk dengan 0 jam supaya kelihatan dan bisa diperbaiki.`,
                )}
              </p>
            )}
            <ul className="mt-2 space-y-0.5 text-[11px] text-slate-600">
              {file.rows.slice(0, 6).map((r, i) => (
                <li key={i}>
                  {r.no ? `${r.no}. ` : ""}{r.name} · {formatNumber(r.jam ?? 0)} {tr("hours", "jam")}
                  {r.gaji ? ` · ${formatIDR(r.gaji)}` : ""}
                  {r.description ? ` · ${r.description}` : ""}
                </li>
              ))}
              {file.rows.length > 6 && <li className="text-slate-400">{tr(`+${file.rows.length - 6} more rows`, `+${file.rows.length - 6} baris lagi`)}</li>}
            </ul>
          </div>
        )}

        {result && (
          <div className="space-y-3">
            <dl className="grid grid-cols-3 gap-2 rounded-xl border border-slate-200 px-4 py-3 text-[12px]">
              <div>
                <dt className="text-slate-500">{tr("Added", "Masuk")}</dt>
                <dd className="text-lg font-bold tabular-nums text-emerald-700">{result.added}</dd>
              </div>
              <div>
                <dt className="text-slate-500">{tr("Already there", "Sudah ada")}</dt>
                <dd className="text-lg font-bold tabular-nums text-slate-700">{result.skipped}</dd>
              </div>
              <div>
                <dt className="text-slate-500">{tr("Unknown names", "Nama tak dikenal")}</dt>
                <dd className={result.unknown.length > 0 ? "text-lg font-bold tabular-nums text-amber-700" : "text-lg font-bold tabular-nums text-slate-700"}>
                  {result.unknown.length}
                </dd>
              </div>
            </dl>
            {result.unknown.length > 0 && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
                <p className="flex items-center gap-2 text-[13px] font-semibold text-amber-900">
                  <AlertTriangle className="h-4 w-4" /> {tr("Names not in the employee records", "Nama yang tidak ada di data karyawan")}
                </p>
                <p className="mt-1 text-[12px] text-amber-900">
                  {tr(
                    "Those rows were not added. No employee is created automatically — check the spelling, or register the person first under HRD → Employees.",
                    "Barisnya tidak dimasukkan. Tidak ada karyawan yang dibuat otomatis — periksa ejaannya, atau daftarkan orangnya dulu di HRD → Karyawan.",
                  )}
                </p>
                <ul className="mt-2 flex flex-wrap gap-2">
                  {result.unknown.map((n) => (
                    <li key={n} className="rounded-lg border border-amber-300 bg-white px-2 py-0.5 text-[11px] text-amber-900">
                      {n}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
