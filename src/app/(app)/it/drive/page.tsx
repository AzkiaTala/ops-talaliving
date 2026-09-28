"use client";

import { useState } from "react";
import { HardDrive, FolderCheck, FolderPlus, ExternalLink } from "lucide-react";
import { Badge, Button, Card, CardHeader, PageHeader, type Tone } from "@/components/ui/primitives";
import { Loaded, useLoad } from "@/components/ui/loaded";
import { documents } from "@/demo/api";
import { useSession } from "@/store/session";
import { useToast } from "@/store/toast";
import { useTr } from "@/lib/i18n";
import type { DriveCheck, DriveSetUp, DriveVerdict } from "@/services/documents/contracts";

/** IT → Google Drive: can the app file into each shared drive (F172, D320).
 *
 *  Uploads use `drive.file`, which sees only what the app itself made. The
 *  owner's hand-made OPS folders were invisible to it, and the first real
 *  upload failed with *File not found*. The owner kept that permission and
 *  chose the app's own folder instead: `ops-talaliving`, at the root of each
 *  shared drive, made by the app.
 *
 *  This screen shows each drive's state and makes that folder, for every
 *  drive at once or one at a time (IT admin, `it.manage_drives`). Looking is
 *  read-only. The one write is making `ops-talaliving` and recording its id.
 *  A drive the app cannot reach says why, and what IT changes in Google Drive.
 */

const VERDICT: Record<DriveVerdict, { tone: Tone; en: [string, string]; id: [string, string] }> = {
  ready: {
    tone: "green",
    en: ["Ready", "Uploads go into this drive's ops-talaliving folder."],
    id: ["Siap", "Upload masuk ke folder ops-talaliving di drive ini."],
  },
  not_set_up: {
    tone: "amber",
    en: ["Not set up", "The app can reach this drive, but its ops-talaliving folder is not made yet. Create it here, or the first upload will."],
    id: ["Belum disiapkan", "Aplikasi bisa menjangkau drive ini, tapi folder ops-talaliving belum dibuat. Buat di sini, atau upload pertama yang akan membuatnya."],
  },
  not_member_or_wrong_id: {
    tone: "red",
    en: ["Not reachable", "Google says the recorded folder does not exist for the app's account. Either the account is not a member of this shared drive, or the recorded id is wrong. Add the account above to the shared drive as Content manager, then check again."],
    id: ["Tidak bisa diakses", "Google bilang folder yang dicatat tidak ada untuk akun aplikasi. Akun itu belum menjadi anggota shared drive ini, atau id yang dicatat salah. Tambahkan akun di atas ke shared drive sebagai Content manager, lalu cek lagi."],
  },
  read_only_member: {
    tone: "red",
    en: ["Read-only member", "The account is in this shared drive as Viewer or Commenter and may not add files. Make it Content manager."],
    id: ["Anggota hanya-baca", "Akun ada di shared drive ini sebagai Viewer atau Commenter dan tidak boleh menambah file. Jadikan Content manager."],
  },
  app_folder_missing: {
    tone: "red",
    en: ["Folder gone", "An ops-talaliving folder is recorded, but uploads can no longer open it (moved, binned or deleted). Create it again."],
    id: ["Folder hilang", "Folder ops-talaliving tercatat, tapi upload tidak bisa membukanya lagi (dipindah, dibuang, atau dihapus). Buat ulang."],
  },
  not_configured: {
    tone: "slate",
    en: ["Not recorded", "Nothing records which shared drive this is."],
    id: ["Belum dicatat", "Belum ada catatan shared drive mana ini."],
  },
  check_failed: {
    tone: "red",
    en: ["Check failed", "The check itself could not run."],
    id: ["Cek gagal", "Pengecekan tidak bisa dijalankan."],
  },
};

export default function DriveCheckPage() {
  const tr = useTr();
  const { can } = useSession();
  const { toast } = useToast();
  const [report, reload] = useLoad(() => documents.checkDrives(), []);
  const [busy, setBusy] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, DriveSetUp>>({});

  const setUp = async (slug?: string) => {
    setBusy(slug ?? "*");
    const res = await documents.setUpDrives(slug);
    setBusy(null);
    if (res.error) { toast("critical", tr("Not done", "Tidak berhasil"), res.error.message); return; }
    setResults((prev) => ({ ...prev, ...Object.fromEntries(res.data.map((r) => [r.slug, r])) }));
    const bad = res.data.filter((r) => !r.ok).length;
    toast(bad ? "warning" : "success",
      bad ? tr(`${bad} drive(s) could not be set up`, `${bad} drive tidak bisa disiapkan`)
          : tr("ops-talaliving is ready", "ops-talaliving siap"),
      bad ? tr("See each drive below.", "Lihat tiap drive di bawah.") : "");
    reload();
  };

  return (
    <div>
      <PageHeader
        breadcrumb="IT"
        title="Google Drive"
        description={tr(
          "Whether the app can file into each shared drive. Everything goes into the app's own ops-talaliving folder at the root of the drive.",
          "Apakah aplikasi bisa menyimpan file ke tiap shared drive. Semuanya masuk ke folder ops-talaliving milik aplikasi di root drive.",
        )}
        actions={
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={reload}>{tr("Check again", "Cek lagi")}</Button>
            {can("it.manage_drives") && (
              <Button size="sm" icon={FolderPlus} disabled={busy != null} onClick={() => setUp()}>
                {busy === "*" ? tr("Creating…", "Membuat…") : tr("Create ops-talaliving in every drive", "Buat ops-talaliving di semua drive")}
              </Button>
            )}
          </div>
        }
      />

      <Loaded state={report} onRetry={reload}>
        {(r) => (
          <>
            <Card className="mb-4">
              <CardHeader
                icon={HardDrive}
                title={tr("The app's Drive account", "Akun Drive aplikasi")}
                subtitle={tr(
                  "Files are written by this account, not by the person uploading. It must be a Content manager of every shared drive below.",
                  "File ditulis oleh akun ini, bukan oleh orang yang meng-upload. Akun ini harus menjadi Content manager di setiap shared drive di bawah.",
                )}
              />
              <div className="flex flex-wrap items-center gap-x-6 gap-y-1 px-5 py-3 text-[13px]">
                <span className="font-mono text-slate-800">{r.service_account}</span>
                <span className="text-slate-500">
                  {tr("Files into", "Menyimpan ke")} <span className="font-mono">{"<shared drive>"} / {r.app_folder} / …</span>
                  {" · "}{tr("permission", "izin")} <span className="font-mono">{r.upload_scope}</span>
                </span>
              </div>
            </Card>

            <Card>
              <CardHeader icon={FolderCheck} title={tr("Shared drives", "Shared drive")} />
              <ul className="divide-y divide-slate-100">
                {r.drives.map((d) => (
                  <DriveRow
                    key={d.slug} d={d} appFolder={r.app_folder} result={results[d.slug]}
                    busy={busy === d.slug || busy === "*"} onSetUp={can("it.manage_drives") ? () => setUp(d.slug) : undefined}
                  />
                ))}
              </ul>
            </Card>
          </>
        )}
      </Loaded>
    </div>
  );
}

function DriveRow({ d, appFolder, result, busy, onSetUp }: {
  d: DriveCheck; appFolder: string; result?: DriveSetUp; busy: boolean; onSetUp?: () => void;
}) {
  const tr = useTr();
  const v = VERDICT[d.verdict];
  const link = (id: string) => (
    <a href={`https://drive.google.com/drive/folders/${id}`} target="_blank" rel="noreferrer"
       className="inline-flex items-center gap-1 font-mono text-brand-700 hover:underline">
      {id} <ExternalLink className="h-3 w-3" />
    </a>
  );

  return (
    <li className="px-5 py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="w-40 shrink-0 text-[13px] font-semibold text-slate-800">{d.label}</span>
        <Badge tone={v.tone}>{tr(v.en[0], v.id[0])}</Badge>
        {d.drive?.name && <span className="text-[12px] text-slate-500">{tr("drive", "drive")} “{d.drive.name}”</span>}
        <span className="flex-1" />
        {onSetUp && d.verdict !== "ready" && d.verdict !== "not_configured" && (
          <Button variant="secondary" size="sm" icon={FolderPlus} disabled={busy} onClick={onSetUp}>
            {busy ? tr("Creating…", "Membuat…") : tr(`Create ${appFolder}`, `Buat ${appFolder}`)}
          </Button>
        )}
      </div>
      <p className="mt-1 text-[12px] text-slate-600">{tr(v.en[1], v.id[1])}</p>
      {d.note && <p className="mt-1 font-mono text-[11px] text-rose-700">{d.note}</p>}

      <dl className="mt-2 grid gap-x-6 gap-y-0.5 text-[11px] text-slate-500 sm:grid-cols-2">
        <div>{tr("Recorded folder", "Folder tercatat")}: {d.recorded_folder_id ? link(d.recorded_folder_id) : "—"}</div>
        <div>{appFolder}: {d.folder_id ? link(d.folder_id) : tr("not made yet", "belum dibuat")}</div>
        {d.drive && !d.drive.ok && (
          <div className="sm:col-span-2 text-rose-700">Google: {d.drive.status} {d.drive.message}</div>
        )}
        {d.app_folder && !d.app_folder.ok && (
          <div className="sm:col-span-2 text-rose-700">{appFolder}: {d.app_folder.status} {d.app_folder.message}</div>
        )}
      </dl>

      {result && (
        <p className={`mt-2 rounded-lg px-3 py-2 text-[12px] ${result.ok ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-800"}`}>
          {result.ok
            ? (result.created
                ? tr(`${appFolder} created and recorded.`, `${appFolder} dibuat dan dicatat.`)
                : tr(`${appFolder} was already there; recorded.`, `${appFolder} sudah ada; dicatat.`))
            : result.message}
        </p>
      )}
    </li>
  );
}
