"use client";

import { useState } from "react";
import { HardDrive, FolderCheck, FlaskConical, ExternalLink } from "lucide-react";
import { Badge, Button, Card, CardHeader, PageHeader, type Tone } from "@/components/ui/primitives";
import { Loaded, useLoad } from "@/components/ui/loaded";
import { documents } from "@/demo/api";
import { useSession } from "@/store/session";
import { useToast } from "@/store/toast";
import { useTr } from "@/lib/i18n";
import type { DriveCheck, DriveFolderTest, DriveVerdict } from "@/services/documents/contracts";

/** IT → Google Drive: can uploads reach each shared drive's OPS folder, and
 *  if not, why (F172).
 *
 *  The first real upload failed with *File not found* for the Procurement
 *  OPS folder. That answer has two causes with two different fixes. One is an
 *  account that is not a member of the shared drive, and IT fixes it in Drive.
 *  The other is a folder a person made, which the app's `drive.file`
 *  permission cannot see, and fixing that is a decision about the app's
 *  permission. This screen asks Google both ways and says which it is, per
 *  drive.
 *
 *  **Looking is read-only.** *Test creating a folder* is the one write, and it
 *  is IT admin's (`it.manage_drives`). It makes a `_ops_app_test_…` folder in
 *  the OPS folder, once as uploads work today and once with full Drive access,
 *  and moves each one it made to the bin. It is the owner's question, *can the
 *  app make the folders itself or must a person?*, answered by trying.
 */

const VERDICT: Record<DriveVerdict, { tone: Tone; en: [string, string]; id: [string, string] }> = {
  ready: {
    tone: "green",
    en: ["Ready", "Uploads can use this OPS folder as it is."],
    id: ["Siap", "Upload bisa memakai folder OPS ini apa adanya."],
  },
  not_configured: {
    tone: "slate",
    en: ["No folder", "No OPS folder id is recorded for this drive."],
    id: ["Belum ada folder", "Belum ada id folder OPS yang dicatat untuk drive ini."],
  },
  not_member_or_wrong_id: {
    tone: "red",
    en: ["Not reachable", "Google cannot find this folder even for a member. Either the app's account is not a member of this shared drive, or the id is wrong. Add the account below as Content manager, then check again."],
    id: ["Tidak terjangkau", "Google tidak menemukan folder ini bahkan untuk anggota. Akun aplikasi belum menjadi anggota shared drive ini, atau id-nya salah. Tambahkan akun di atas sebagai Content manager, lalu cek lagi."],
  },
  hidden_by_drive_file: {
    tone: "amber",
    en: ["Hidden from uploads", "The account is a member and can see the folder, but uploads cannot. The folder was made by a person, and the app's drive.file permission only sees folders the app made itself. Test creating a folder to see what would work."],
    id: ["Tersembunyi dari upload", "Akun sudah menjadi anggota dan bisa melihat folder ini, tapi upload tidak bisa. Folder dibuat oleh orang, sedangkan izin drive.file aplikasi hanya melihat folder yang dibuat aplikasi sendiri. Coba \"Uji buat folder\" untuk melihat yang bisa jalan."],
  },
  read_only_member: {
    tone: "red",
    en: ["Read-only member", "The account is in this shared drive as Viewer or Commenter and may not add files. Make it Content manager."],
    id: ["Anggota hanya-baca", "Akun ada di shared drive ini sebagai Viewer atau Commenter dan tidak boleh menambah file. Jadikan Content manager."],
  },
  not_a_folder: {
    tone: "red",
    en: ["Not a folder", "The recorded id is a file, not a folder."],
    id: ["Bukan folder", "Id yang dicatat adalah file, bukan folder."],
  },
  trashed: {
    tone: "red",
    en: ["In the bin", "The recorded OPS folder is in the Drive bin. Restore it, or record another."],
    id: ["Di tempat sampah", "Folder OPS yang dicatat ada di tempat sampah Drive. Pulihkan, atau catat folder lain."],
  },
  not_named_ops: {
    tone: "amber",
    en: ["Not named OPS", "Uploads work, but the recorded folder is not named OPS, so the app makes an OPS folder inside it."],
    id: ["Bukan bernama OPS", "Upload bisa, tapi folder yang dicatat tidak bernama OPS, jadi aplikasi membuat folder OPS di dalamnya."],
  },
  check_failed: {
    tone: "red",
    en: ["Check failed", "The check itself could not run."],
    id: ["Cek gagal", "Pengecekan tidak bisa dijalankan."],
  },
};

export default function DriveCheckPage() {
  const tr = useTr();
  const [report, reload] = useLoad(() => documents.checkDrives(), []);

  return (
    <div>
      <PageHeader
        breadcrumb="IT"
        title="Google Drive"
        description={tr(
          "Whether uploads can reach each shared drive's OPS folder, and if not, why and who fixes it.",
          "Apakah upload bisa sampai ke folder OPS tiap shared drive, dan kalau tidak, kenapa dan siapa yang memperbaikinya.",
        )}
        actions={<Button variant="secondary" size="sm" onClick={reload}>{tr("Check again", "Cek lagi")}</Button>}
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
                  {tr("Upload permission:", "Izin upload:")} <span className="font-mono">{r.upload_scope}</span>
                  {" "}{tr("(sees only files and folders the app made)", "(hanya melihat file dan folder buatan aplikasi)")}
                </span>
              </div>
            </Card>

            <Card>
              <CardHeader icon={FolderCheck} title={tr("OPS folder per shared drive", "Folder OPS per shared drive")} />
              <ul className="divide-y divide-slate-100">
                {r.drives.map((d) => <DriveRow key={d.slug} d={d} />)}
              </ul>
            </Card>
          </>
        )}
      </Loaded>
    </div>
  );
}

function DriveRow({ d }: { d: DriveCheck }) {
  const tr = useTr();
  const { can } = useSession();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [test, setTest] = useState<DriveFolderTest | null>(null);
  const v = VERDICT[d.verdict];

  const runTest = async () => {
    setBusy(true);
    const res = await documents.testDriveFolder(d.slug);
    setBusy(false);
    if (res.error) { toast("critical", tr("Test did not run", "Uji tidak berjalan"), res.error.message); return; }
    setTest(res.data);
  };

  return (
    <li className="px-5 py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="w-40 shrink-0 text-[13px] font-semibold text-slate-800">{d.label}</span>
        <Badge tone={v.tone}>{tr(v.en[0], v.id[0])}</Badge>
        <span className="flex-1" />
        {d.folder_id && can("it.manage_drives") && (
          <Button variant="secondary" size="sm" icon={FlaskConical} disabled={busy} onClick={runTest}>
            {busy ? tr("Testing…", "Menguji…") : tr("Test creating a folder", "Uji buat folder")}
          </Button>
        )}
      </div>
      <p className="mt-1 text-[12px] text-slate-600">{tr(v.en[1], v.id[1])}</p>
      {d.note && <p className="mt-1 font-mono text-[11px] text-rose-700">{d.note}</p>}

      <dl className="mt-2 grid gap-x-6 gap-y-0.5 text-[11px] text-slate-500 sm:grid-cols-2">
        <div>
          {tr("Recorded folder", "Folder tercatat")}:{" "}
          {d.folder_id ? (
            <a href={`https://drive.google.com/drive/folders/${d.folder_id}`} target="_blank" rel="noreferrer"
               className="inline-flex items-center gap-1 font-mono text-brand-700 hover:underline">
              {d.folder_id} <ExternalLink className="h-3 w-3" />
            </a>
          ) : "—"}
        </div>
        {d.member && (
          <div>
            {tr("A member sees", "Anggota melihat")}:{" "}
            {d.member.ok
              ? <span className="text-slate-700">
                  “{d.member.name}”{d.member.drive_name && ` ${tr("in", "di")} ${d.member.drive_name}`}
                  {d.member.can_add === false && ` · ${tr("read-only", "hanya-baca")}`}
                </span>
              : <span className="text-rose-700">{d.member.status} {d.member.message}</span>}
          </div>
        )}
        {d.uploader && (
          <div>
            {tr("Uploads see (drive.file)", "Upload melihat (drive.file)")}:{" "}
            {d.uploader.ok
              ? <span className="text-emerald-700">{tr("yes", "ya")}</span>
              : <span className="text-rose-700">{tr("no", "tidak")} — {d.uploader.status} {d.uploader.message}</span>}
          </div>
        )}
      </dl>

      {test && <TestResult t={test} />}
    </li>
  );
}

function TestResult({ t }: { t: DriveFolderTest }) {
  const tr = useTr();
  const line = (label: string, c: DriveFolderTest["as_uploader"]) => (
    <p>
      {label}:{" "}
      {c.created
        ? <span className="font-medium text-emerald-700">
            {tr("created", "berhasil dibuat")}{c.binned ? tr(" (and binned)", " (dan dibuang ke sampah)") : tr(" — NOT binned, remove it by hand", " — BELUM dibuang, hapus manual")}
          </span>
        : <span className="font-medium text-rose-700">{tr("refused", "ditolak")} — {c.status} {c.message}</span>}
    </p>
  );

  const conclusion =
    t.as_uploader.created
      ? tr("Uploads can make their folders here as they are. Nothing to change.",
           "Upload bisa membuat foldernya sendiri di sini apa adanya. Tidak ada yang perlu diubah.")
      : t.with_full_access.created
        ? tr("The app can make its own folders here only with full Drive access. Under drive.file it cannot use a folder a person made. Either the app's permission becomes full Drive access, or the OPS folder must be one the app made.",
             "Aplikasi hanya bisa membuat folder sendiri di sini dengan akses Drive penuh. Dengan drive.file aplikasi tidak bisa memakai folder buatan orang. Pilihannya: izin aplikasi diubah menjadi akses Drive penuh, atau folder OPS harus dibuat oleh aplikasi.")
        : tr("Even full Drive access was refused, so the account is not a Content manager here. That is fixed in Drive, by sharing the drive with the account.",
             "Akses Drive penuh pun ditolak, jadi akun ini bukan Content manager di sini. Perbaikannya di Drive: bagikan shared drive ke akun tersebut.");

  return (
    <div className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-[12px] text-slate-700">
      {line(tr("As uploads work today (drive.file)", "Seperti upload sekarang (drive.file)"), t.as_uploader)}
      {line(tr("With full Drive access (drive)", "Dengan akses Drive penuh (drive)"), t.with_full_access)}
      <p className="mt-1 font-medium">{conclusion}</p>
    </div>
  );
}
