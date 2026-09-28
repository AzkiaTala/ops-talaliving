"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Package, Printer, QrCode as QrIcon, AlertTriangle, Plus, Truck } from "lucide-react";
import { Badge, Button, Card, CardHeader, EmptyState, PageHeader, StatCard } from "@/components/ui/primitives";
import { Loaded, SourceBadge, useLoad } from "@/components/ui/loaded";
import { Drawer } from "@/components/ui/drawer";
import { NumberInput } from "@/components/ui/number-input";
import { QrCode } from "@/components/ui/qr";
import { cn } from "@/lib/cn";
import { delivery } from "@/demo/api";
import { BOX_STATUS_LABEL, type BoxStatus, type BoxView } from "@/services/delivery/contracts";
import { useToast } from "@/store/toast";
import { useSession } from "@/store/session";
import { useTr } from "@/lib/i18n";

const TONE: Record<BoxStatus, "slate" | "amber" | "green" | "red" | "violet"> = {
  PACKED: "slate", IN_TRANSIT: "amber", ON_SITE: "violet", INSTALLED: "green", PROBLEM: "red",
};

/** Peti, not lines (D262).
 *
 *  A delivery note says *2 set meja makan*; a lorry arrives with nine crates.
 *  Nobody on site can hold those two sentences together, so today the crew
 *  opens crates until it finds the one it needs, and a missing handle is
 *  discovered on the fitting day with a client standing there.
 *
 *  What this screen adds is one fact per crate that the delivery note cannot
 *  carry: **which room it is for**. Everything else — the code, the QR, the
 *  contents — exists to get that fact onto the outside of the box and back
 *  into the record when somebody scans it.
 */
export default function BoxesPage() {
  const tr = useTr();
  const { can } = useSession();
  const [rows, reload] = useLoad(() => delivery.listBoxes(), []);
  const [packing, setPacking] = useState(false);
  const mayEdit = can("delivery.create");

  return (
    <div>
      <PageHeader
        breadcrumb={tr("Projects", "Proyek")}
        title={tr("Boxes & labels", "Peti & label")}
        description={tr("One box, one code, one destination room. Labels are printed from here, and the QR opens that box directly — the people scanning on site are our own team, who already have a login.", "Satu peti, satu kode, satu ruangan tujuan. Label dicetak dari sini, dan QR-nya langsung membuka peti itu — yang scan di lokasi adalah tim kita sendiri yang sudah punya login.")}
        actions={mayEdit ? (
          <Button icon={Plus} onClick={() => setPacking(true)}>{tr("Pack a box", "Kemas peti")}</Button>
        ) : undefined}
      />

      <Loaded state={rows} onRetry={reload}>
        {(boxes) => {
          const problem = boxes.filter((b) => b.status === "PROBLEM");
          const waiting = boxes.filter((b) => b.delivery_id === null);
          const onDelivery = boxes.filter((b) => b.delivery_id !== null);
          const groups = new Map<string, BoxView[]>();
          for (const b of onDelivery) {
            const key = b.delivery_no ?? "—";
            groups.set(key, [...(groups.get(key) ?? []), b]);
          }

          return (
            <>
              <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
                <StatCard label={tr("Boxes recorded", "Peti tercatat")} value={String(boxes.length)} icon={Package} />
                <StatCard label={tr("Not on a truck yet", "Belum naik truk")} value={String(waiting.length)} icon={Truck} />
                <StatCard
                  label={tr("Not scanned yet", "Belum di-scan")}
                  value={String(boxes.filter((b) => b.scanned_at == null).length)}
                  icon={QrIcon}
                />
                <StatCard
                  label={tr("With problems", "Bermasalah")}
                  value={String(problem.length)}
                  icon={AlertTriangle}
                  tone={problem.length > 0 ? "red" : "slate"}
                />
              </div>

              {problem.length > 0 && (
                <Card className="mb-4 border-rose-200">
                  <CardHeader
                    title={tr("Boxes with problems", "Peti bermasalah")}
                    subtitle={tr("Flagged by whoever is handling the box on site. This is usually why an installation day gets lost.", "Ditandai oleh orang yang memegang petinya di lokasi. Ini biasanya alasan satu hari pemasangan hilang.")}
                    icon={AlertTriangle}
                  />
                  <ul className="divide-y divide-slate-100">
                    {problem.map((b) => (
                      <li key={b.id} className="px-5 py-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <Link href={`/box/${encodeURIComponent(b.box_no)}`} className="font-mono text-[13px] font-medium text-brand-700 hover:underline">
                            {b.box_no}
                          </Link>
                          <span className="text-[12px] text-slate-500">{b.project_name} · {b.destination}</span>
                        </div>
                        <p className="mt-0.5 text-[13px] text-rose-700">{b.problem_note}</p>
                      </li>
                    ))}
                  </ul>
                </Card>
              )}

              {waiting.length > 0 && (
                <BoxGroup
                  title={tr("Packed, no truck yet", "Dikemas, belum ada truknya")}
                  subtitle={tr("Labelled and ready to load. These are the ones that usually get left in a corner of the workshop.", "Sudah berlabel dan tinggal diangkat. Ini yang biasanya ketinggalan di sudut workshop.")}
                  boxes={waiting}
                  state={rows}
                  printHref={`/proyek/peti/label?kode=${waiting.map((b) => b.box_no).join(",")}`}
                />
              )}

              {[...groups.entries()].map(([deliveryNo, list]) => (
                <BoxGroup
                  key={deliveryNo}
                  title={tr(`Delivery ${deliveryNo}`, `Pengiriman ${deliveryNo}`)}
                  subtitle={tr(`${list.length} boxes · ${list[0].project_name}`, `${list.length} peti · ${list[0].project_name}`)}
                  boxes={list}
                  state={rows}
                  printHref={`/proyek/peti/label?krm=${encodeURIComponent(deliveryNo)}`}
                />
              ))}

              {boxes.length === 0 && (
                <EmptyState
                  icon={Package}
                  title={tr("No boxes recorded yet", "Belum ada peti tercatat")}
                  description={tr("Older deliveries have no boxes — labels did not exist then. That is a gap in the records, not an empty truck.", "Pengiriman lama tidak punya peti — labelnya belum ada waktu itu. Itu celah di catatan, bukan truk kosong.")}
                />
              )}
            </>
          );
        }}
      </Loaded>

      {packing && <PackDrawer onClose={() => setPacking(false)} onDone={() => { setPacking(false); reload(); }} />}
    </div>
  );
}

function BoxGroup({
  title, subtitle, boxes, state, printHref,
}: {
  title: string; subtitle: string; boxes: BoxView[];
  state: Parameters<typeof SourceBadge>[0]["state"];
  printHref: string;
}) {
  const tr = useTr();
  return (
    <Card className="mb-4">
      <CardHeader
        title={title}
        subtitle={subtitle}
        icon={Package}
        action={
          <span className="flex items-center gap-2">
            <SourceBadge state={state} />
            <Link href={printHref}>
              <Button size="sm" variant="outline" icon={Printer}>{tr("Print labels", "Cetak label")}</Button>
            </Link>
          </span>
        }
      />
      <ul className="divide-y divide-slate-100">
        {boxes.map((b) => (
          <li key={b.id} className="flex flex-wrap items-start gap-x-4 gap-y-2 px-5 py-3">
            <QrCode path={`/box/${encodeURIComponent(b.box_no)}`} title={b.box_no} size={44} className="shrink-0 rounded ring-1 ring-slate-200" />
            <span className="min-w-[200px] flex-1">
              <Link href={`/box/${encodeURIComponent(b.box_no)}`} className="font-mono text-[13px] font-medium text-brand-700 hover:underline">
                {b.box_no}
              </Link>
              <span className="ml-2 text-[12px] text-slate-500">{b.position ?? tr("not on a truck yet", "belum naik truk")}</span>
              <span className="block text-[13px] text-slate-800">{b.destination}</span>
              <span className="block text-[11px] text-slate-400">
                {b.lines.map((l) => `${l.qty} ${l.uom} ${l.description}`).join(" · ")}
              </span>
              {b.warnings.map((w) => (
                <span key={w} className="mt-0.5 block text-[11px] text-amber-700">{w}</span>
              ))}
            </span>
            <Badge tone={TONE[b.status]} dot>{BOX_STATUS_LABEL[b.status]}</Badge>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/* ── Packing one box ──────────────────────────────────────────────────── */

function PackDrawer({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const tr = useTr();
  const { toast } = useToast();
  const [ful] = useLoad(() => delivery.listFulfilment(), []);
  const [projectCode, setProjectCode] = useState("");
  const [destination, setDestination] = useState("");
  const [note, setNote] = useState("");
  const [qty, setQty] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const key = useMemo(() => `pack-${Date.now()}`, []);

  const project = ful.status === "ready" ? ful.data.find((f) => f.project_code === projectCode) : undefined;

  async function submit() {
    const lines = (project?.lines ?? [])
      .filter((l) => (qty[l.project_line_id] ?? 0) > 0)
      .map((l) => ({
        project_line_id: l.project_line_id,
        description: l.description,
        qty: qty[l.project_line_id],
        uom: l.uom,
      }));
    setBusy(true);
    const res = await delivery.packBox({
      project_code: projectCode, destination, lines,
      note: note || null, idempotency_key: key,
    });
    setBusy(false);
    if (res.error) {
      toast(res.error.status === 409 ? "critical" : "warning", tr("Not packed", "Belum dikemas"), res.error.message);
      return;
    }
    toast("success", tr(`Box ${res.data.box_no}`, `Peti ${res.data.box_no}`), tr(`${res.data.piece_count} items · ${res.data.destination}`, `${res.data.piece_count} barang · ${res.data.destination}`));
    onDone();
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title={tr("Pack one box", "Kemas satu peti")}
      subtitle={tr("The destination inside the building, not the project address — the one thing a delivery note cannot tell you.", "Tujuannya di dalam gedung, bukan alamat proyek — itulah satu-satunya hal yang tidak bisa dibaca dari surat jalan.")}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>{tr("Cancel", "Batal")}</Button>
          <Button onClick={submit} disabled={busy}>{busy ? tr("Saving…", "Menyimpan…") : tr("Pack & label", "Kemas & beri label")}</Button>
        </div>
      }
    >
      <div className="space-y-4 text-sm">
        <label className="block">
          <span className="mb-1 block text-[12px] font-medium text-slate-600">{tr("Project", "Proyek")}</span>
          <select
            value={projectCode}
            onChange={(e) => { setProjectCode(e.target.value); setQty({}); }}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="">{tr("— choose a project —", "— pilih proyek —")}</option>
            {ful.status === "ready" && ful.data.map((f) => (
              <option key={f.project_code} value={f.project_code}>{f.project_code} · {f.project_name}</option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-1 block text-[12px] font-medium text-slate-600">{tr("Destination inside the building", "Tujuan di dalam gedung")}</span>
          <input
            value={destination}
            onChange={(e) => setDestination(e.target.value)}
            placeholder={tr("Floor 2 — master bedroom", "Lantai 2 — kamar tidur utama")}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </label>

        {project && (
          <div>
            <p className="mb-1 text-[12px] font-medium text-slate-600">{tr("Box contents", "Isi peti")}</p>
            <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
              {project.lines.map((l) => (
                <li key={l.project_line_id} className="flex items-center gap-3 px-3 py-2">
                  <span className="flex-1 text-[13px] text-slate-700">{l.description}</span>
                  <NumberInput
                    value={qty[l.project_line_id] ?? 0}
                    onChange={(n) => setQty((q) => ({ ...q, [l.project_line_id]: n }))}
                    className="w-20"
                  />
                  <span className="w-10 text-[11px] text-slate-400">{l.uom}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <label className="block">
          <span className="mb-1 block text-[12px] font-medium text-slate-600">{tr("Note on the label (optional)", "Catatan di label (opsional)")}</span>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={tr("Do not stack.", "Jangan ditumpuk.")}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </label>

        <p className={cn("rounded-lg bg-slate-50 px-3 py-2 text-[12px] text-slate-500")}>
          {tr("The box code is generated automatically", "Kode peti dibuat otomatis")} (<span className="font-mono">kol-…</span>).{" "}
          {tr(
            "The QR on the label opens this box's page straight from a phone camera, and the code is still printed large beneath it — if the system's address changes, the label can still be typed in, it does not die.",
            "QR di label membuka halaman peti ini langsung dari kamera HP, dan kodenya tetap dicetak besar di bawahnya — kalau alamat sistem berubah, labelnya masih bisa diketik, tidak mati.",
          )}
        </p>
      </div>
    </Drawer>
  );
}
