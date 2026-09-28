"use client";

import { useState } from "react";
import { FolderOpen, FileText, AlertTriangle, Link2 } from "lucide-react";
import { Badge, Card, CardHeader, PageHeader } from "@/components/ui/primitives";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Loaded, SourceBadge, useLoad } from "@/components/ui/loaded";
import { cn } from "@/lib/cn";
import { documents } from "@/demo/api";
import { DOC_KINDS, type AttachmentView, type DocKind } from "@/services/documents/contracts";
import { useTr } from "@/lib/i18n";

/** Every document, and what each one is attached to.
 *
 *  Browsing by file is the *second* way to find a document, and deliberately
 *  so: the first is to open the record and look at it, because that is where
 *  the question is usually asked ("what proves this payment?"). This screen
 *  answers the other question — "where did this photo end up?" — and the one
 *  that matters most for keeping the system honest: **which files are attached
 *  to nothing at all.**
 *
 *  A file covering several records is shown once, with what it covers listed.
 *  Three uploads of the same photograph would be three files nobody can tell
 *  apart later; one file pointed at three records is a fact.
 */
export default function DocumentsPage() {
  const tr = useTr();
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<DocKind | "">("");
  const [month, setMonth] = useState("");
  const [rows, reload] = useLoad(() => documents.listAttachments(), []);

  const columns: Column<AttachmentView>[] = [
    {
      key: "file",
      header: tr("Document", "Dokumen"),
      className: "whitespace-normal",
      render: (a) => (
        <div className="max-w-[360px] whitespace-normal break-words">
          <p className="flex items-center gap-2 font-medium leading-snug text-slate-800">
            <FileText className="h-3.5 w-3.5 shrink-0 text-slate-400" />
            {a.filename}
          </p>
          <p className="font-mono text-[10px] text-slate-400">
            {a.uploaded_at.slice(0, 10)} · {a.source} · {(a.bytes / 1024).toFixed(0)} KB
          </p>
        </div>
      ),
    },
    {
      key: "kind",
      header: tr("Type", "Jenis"),
      render: (a) => (
        <div className="flex flex-wrap gap-1">
          {[...new Set(a.links.map((l) => l.kind))].map((k) => (
            <Badge key={k} tone="slate">{k}</Badge>
          ))}
          {a.links.length === 0 && <span className="text-slate-300">—</span>}
        </div>
      ),
    },
    {
      key: "covers",
      header: tr("Attached to", "Dilampirkan ke"),
      className: "whitespace-normal",
      render: (a) => a.links.length === 0
        ? (
          /* The row this screen exists for: a file nobody pointed at anything.
             It is not deleted and not hidden — it is asked about. */
          <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-amber-700">
            <AlertTriangle className="h-3.5 w-3.5" /> {tr("nothing yet", "belum ada")}
          </span>
        )
        : (
          <ul className="max-w-[320px] space-y-0.5">
            {a.links.map((l) => (
              <li key={l.id} className="flex items-start gap-1.5 text-[12px] text-slate-600">
                <Link2 className="mt-0.5 h-3 w-3 shrink-0 text-slate-400" />
                <span className="min-w-0 break-words font-mono">{l.entity_no}</span>
              </li>
            ))}
          </ul>
        ),
    },
    {
      key: "count",
      header: tr("Covers", "Mencakup"),
      align: "right",
      render: (a) => (
        <span className={cn(
          "tabular-nums text-[13px]",
          a.covers_count > 1 ? "font-semibold text-brand-700" : "text-slate-500",
        )}>
          {a.covers_count}
        </span>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        breadcrumb={tr("Accounting", "Akuntansi")}
        title={tr("Documents", "Dokumen")}
        description={tr("Every file, and what it is attached to. Opening the record is still the quickest way to see its proof — this is for the other question: where did this photo end up, and which files are attached to nothing.", "Setiap berkas, dan apa yang dilampirinya. Membuka catatannya tetap cara tercepat melihat buktinya — halaman ini untuk pertanyaan lain: ke mana foto ini berakhir, dan berkas mana yang tidak dilampirkan ke apa pun.")}
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <select
          id="d-kind"
          value={kind}
          onChange={(e) => setKind(e.target.value as DocKind | "")}
          className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-sm text-slate-700 focus:border-brand-400 focus:outline-none"
        >
          <option value="">{tr("All types", "Semua jenis")}</option>
          {DOC_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
        </select>
        <input
          id="d-month"
          type="month"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-sm text-slate-700 focus:border-brand-400 focus:outline-none"
        />
        <input
          id="d-q"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={tr("Filename or record…", "Nama berkas atau catatan…")}
          className="ml-auto h-9 w-56 rounded-lg border border-slate-200 px-3 text-sm text-slate-700 placeholder:text-slate-400 focus:border-brand-400 focus:outline-none"
        />
      </div>

      <Loaded state={rows} onRetry={reload}>
        {(all) => {
          const visible = all.filter((a) => {
            if (kind && !a.links.some((l) => l.kind === kind)) return false;
            if (month && !a.uploaded_at.startsWith(month)) return false;
            if (!q) return true;
            const n = q.toLowerCase();
            return a.filename.toLowerCase().includes(n)
              || a.links.some((l) => l.entity_no.toLowerCase().includes(n));
          });
          const orphans = visible.filter((a) => a.links.length === 0);
          const shared = visible.filter((a) => a.covers_count > 1);

          return (
            <Card>
              <CardHeader
                title={tr(`${visible.length} document(s)`, `${visible.length} dokumen`)}
                subtitle={tr(`${shared.length} cover more than one record${orphans.length ? ` · ${orphans.length} attached to nothing` : ""}`, `${shared.length} mencakup lebih dari satu catatan${orphans.length ? ` · ${orphans.length} tidak dilampirkan ke apa pun` : ""}`)}
                icon={FolderOpen}
                action={
                  <div className="flex items-center gap-2">
                    {orphans.length > 0 && <Badge tone="amber">{tr(`${orphans.length} unattached`, `${orphans.length} belum dilampirkan`)}</Badge>}
                    <SourceBadge state={rows} />
                  </div>
                }
              />
              <DataTable
                dense
                columns={columns}
                rows={visible}
                rowKey={(a) => a.id}
                empty={q || kind || month ? tr("Nothing matches those filters.", "Tidak ada yang cocok dengan filter itu.") : tr("No documents yet.", "Belum ada dokumen.")}
              />
            </Card>
          );
        }}
      </Loaded>
    </div>
  );
}
