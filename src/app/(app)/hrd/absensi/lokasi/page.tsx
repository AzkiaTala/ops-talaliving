"use client";

import { useState } from "react";
import { Camera, ChevronLeft, Crosshair, MapPin, MapPinned, Save, Warehouse } from "lucide-react";
import Link from "next/link";
import { Badge, Button, Card, CardHeader, PageHeader } from "@/components/ui/primitives";
import { Loaded, useLoad } from "@/components/ui/loaded";
import { mapLink, metres, useWhereLine } from "@/components/attendance/located-tap";
import { hr } from "@/demo/api";
import {
  DEFAULT_SITE_RADIUS_M, type LocatedTapView, type LocationJudgement, type LocationVerdict, type WorkSite,
} from "@/services/hr/contracts";
import { OFFICE_TZ, officeClock, officeToday, shiftDay } from "@/lib/office";
import { useSession } from "@/store/session";
import { useToast } from "@/store/toast";
import { useLang, useTr } from "@/lib/i18n";
import { cn } from "@/lib/cn";

/** Presensi berlokasi (D332) — where the warehouse is, and the phone taps
 *  that were not made inside it.
 *
 *  Two halves on one page because they answer one question. The **site** is
 *  what "inside" is measured against: set by HRD or IT standing in the
 *  warehouse, since nobody knows its coordinates from a desk. The **review**
 *  is every phone tap that was outside, had no location, or was too loose to
 *  judge — each already written and carrying the person's note, never refused
 *  (D326, answer 1). Nothing here changes what a day is worth: taps stay facts,
 *  and HRD's day marks on `/hrd/absensi` decide the day (D142).
 */
const ZONE = OFFICE_TZ.label.split(" ")[0];

const VERDICT_TONE: Record<LocationVerdict, "green" | "amber" | "red" | "slate"> = {
  inside: "green", outside: "red", uncertain: "amber", no_location: "amber", no_site: "slate",
};

export default function LocatedTapsPage() {
  const tr = useTr();
  const { can } = useSession();
  const today = officeToday();
  const [from, setFrom] = useState(() => shiftDay(today, -13));
  const [to, setTo] = useState(today);
  const [flaggedOnly, setFlaggedOnly] = useState(true);
  const [sites, reloadSites] = useLoad(() => hr.listWorkSites(), []);
  const [taps] = useLoad(() => hr.listLocatedTaps({ from, to, flagged_only: flaggedOnly }), [from, to, flaggedOnly]);
  const [unjudged] = useLoad(() => hr.listLocatedTaps({ from, to }), [from, to]);
  const mayEdit = can("hrd.update") || can("it.update");
  const siteSet = sites.status === "ready" && sites.data.some((w) => w.active && w.lat !== null);

  return (
    <div>
      <PageHeader
        breadcrumb="HRD"
        title={tr("Attendance by location", "Presensi berlokasi")}
        description={tr(
          "A phone tap reads the location once, at the tap, and is judged against the warehouse. Taps outside it are recorded with a note and flagged here — never refused.",
          "Tap dari HP membaca lokasi sekali, saat tap, dan dinilai terhadap gudang. Tap di luar area tetap tercatat beserta keterangan dan ditandai di sini — tidak pernah ditolak.",
        )}
        actions={<Link href="/hrd/absensi"><Button variant="outline" icon={ChevronLeft}>{tr("Timesheet", "Absensi")}</Button></Link>}
      />

      <Loaded state={sites} onRetry={reloadSites}>
        {(list) => <SiteCard sites={list} mayEdit={mayEdit} onSaved={reloadSites} />}
      </Loaded>

      {sites.status === "ready" && !siteSet && unjudged.status === "ready" && (
        <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-900" data-testid="no-site-banner">
          {tr(
            `The warehouse point is not set, so phone taps are recorded but not judged (${unjudged.data.filter((t) => t.verdict === "no_site").length} in this period).`,
            `Titik gudang belum diatur, jadi tap dari HP tercatat tetapi tidak dinilai (${unjudged.data.filter((t) => t.verdict === "no_site").length} pada periode ini).`,
          )}
        </p>
      )}

      <Card className="mt-4">
        <CardHeader
          title={tr("Taps to look at", "Tap yang perlu dilihat")}
          subtitle={tr(
            "Outside the area, no location, or a location too loose to tell. Times in WITA.",
            "Di luar area, tanpa lokasi, atau lokasi kurang tepat. Jam dalam WITA.",
          )}
          icon={MapPinned}
        />
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-5 py-3 text-[13px]">
          <label className="flex items-center gap-1.5">
            {tr("From", "Dari")}
            <input type="date" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)}
              className="rounded-md border border-slate-300 px-2 py-1" />
          </label>
          <label className="flex items-center gap-1.5">
            {tr("to", "s.d.")}
            <input type="date" value={to} min={from} onChange={(e) => e.target.value && setTo(e.target.value)}
              className="rounded-md border border-slate-300 px-2 py-1" />
          </label>
          <label className="ml-auto flex items-center gap-1.5">
            <input type="checkbox" checked={flaggedOnly} onChange={(e) => setFlaggedOnly(e.target.checked)} />
            {tr("Flagged only", "Hanya yang ditandai")}
          </label>
        </div>
        <Loaded state={taps}>
          {(rows) => rows.length === 0 ? (
            <p className="px-5 py-8 text-center text-[13px] text-slate-500">
              {flaggedOnly
                ? tr("No flagged phone taps in this period.", "Tidak ada tap HP yang ditandai pada periode ini.")
                : tr("No phone taps in this period.", "Tidak ada tap dari HP pada periode ini.")}
            </p>
          ) : (
            <ul className="divide-y divide-slate-100" data-testid="located-taps">
              {rows.map((r) => <TapRow key={r.tap_no} r={r} />)}
            </ul>
          )}
        </Loaded>
      </Card>
    </div>
  );
}

function TapRow({ r }: { r: LocatedTapView }) {
  const tr = useTr();
  const lang = useLang();
  const verdictLabel: Record<LocationVerdict, string> = {
    inside: tr("Inside", "Di area"),
    outside: tr("Outside", "Di luar area"),
    uncertain: tr("Too loose", "Kurang tepat"),
    no_location: tr("No location", "Tanpa lokasi"),
    no_site: tr("Not judged", "Tidak dinilai"),
  };
  return (
    <li className="flex gap-3 px-5 py-3 text-[13px]">
      {r.photo_id ? (
        <a
          href={r.photo_link ?? undefined} target="_blank" rel="noreferrer"
          title={r.photo_filename ?? undefined}
          className={cn(
            "flex h-14 w-14 shrink-0 flex-col items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-[10px] text-slate-500",
            r.photo_link ? "hover:border-brand-400 hover:text-brand-700" : "pointer-events-none",
          )}
        >
          <Camera className="h-5 w-5" />
          {tr("Photo", "Foto")}
        </a>
      ) : (
        <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg border border-dashed border-slate-200 text-[10px] text-slate-400">
          {tr("no photo", "tanpa foto")}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-semibold text-slate-800">{r.full_name}</span>
          <span className="font-mono text-[11px] text-slate-400">{r.employee_no}</span>
          <Badge tone={VERDICT_TONE[r.verdict]}>{verdictLabel[r.verdict]}</Badge>
        </div>
        <p className="mt-0.5 text-slate-600">
          {r.work_date} · {officeClock(new Date(r.at))} {ZONE}
          {r.distance_m !== null && <> · {tr(`${metres(r.distance_m, lang)} from ${r.site_name ?? "site"}`, `${metres(r.distance_m, lang)} dari ${r.site_name ?? "lokasi"}`)}</>}
          {r.accuracy_m !== null && <> · ±{Math.round(r.accuracy_m)} m</>}
        </p>
        {r.note && <p className="mt-1 text-slate-800">“{r.note}”</p>}
        {r.lat !== null && r.lng !== null && (
          <a href={mapLink(r.lat, r.lng)} target="_blank" rel="noreferrer"
             className="mt-1 inline-flex items-center gap-1 text-[12px] text-brand-700 underline">
            <MapPin className="h-3.5 w-3.5" /> {tr("Open in maps", "Buka di peta")}
          </a>
        )}
      </div>
    </li>
  );
}

/* ── the warehouse ──────────────────────────────────────────────────────── */

function SiteCard({ sites, mayEdit, onSaved }: { sites: WorkSite[]; mayEdit: boolean; onSaved: () => void }) {
  const tr = useTr();
  const { toast } = useToast();
  const whereLine = useWhereLine();
  const current = sites.find((w) => w.code === "GUDANG") ?? sites[0] ?? null;
  const [draft, setDraft] = useState(() => ({
    code: current?.code ?? "GUDANG",
    name: current?.name ?? "Gudang",
    lat: current?.lat?.toString() ?? "",
    lng: current?.lng?.toString() ?? "",
    radius_m: String(current?.radius_m ?? DEFAULT_SITE_RADIUS_M),
    active: current?.active ?? true,
  }));
  const [fix, setFix] = useState<{ accuracy_m: number } | null>(null);
  const [reading, setReading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [check, setCheck] = useState<LocationJudgement | null>(null);

  function readHere(then: (lat: number, lng: number, acc: number) => void) {
    if (!navigator.geolocation) {
      toast("warning", tr("No location on this device", "Perangkat ini tidak punya lokasi"), "");
      return;
    }
    setReading(true);
    navigator.geolocation.getCurrentPosition(
      (p) => { setReading(false); then(p.coords.latitude, p.coords.longitude, p.coords.accuracy); },
      (e) => {
        setReading(false);
        toast("warning", tr("Location not read", "Lokasi tidak terbaca"),
          e.code === 1 ? tr("Location is not allowed for this site in the browser.", "Izin lokasi untuk situs ini ditolak di browser.") : e.message);
      },
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 },
    );
  }

  function fillFromHere() {
    readHere((lat, lng, acc) => {
      setDraft((d) => ({ ...d, lat: lat.toFixed(6), lng: lng.toFixed(6) }));
      setFix({ accuracy_m: acc });
    });
  }

  function checkHere() {
    readHere(async (lat, lng, acc) => {
      const res = await hr.judgeLocation({ lat, lng, accuracy_m: acc });
      if (res.error) { toast("warning", tr("Not checked", "Tidak dicek"), res.error.message); return; }
      setCheck(res.data);
    });
  }

  async function save() {
    setBusy(true);
    const res = await hr.saveWorkSite({
      code: draft.code, name: draft.name,
      lat: draft.lat.trim() === "" ? null : Number(draft.lat),
      lng: draft.lng.trim() === "" ? null : Number(draft.lng),
      radius_m: Number(draft.radius_m), active: draft.active,
    });
    setBusy(false);
    if (res.error) { toast("warning", tr("Not saved", "Tidak tersimpan"), res.error.message); return; }
    toast("success", tr("Warehouse point saved", "Titik gudang tersimpan"), `${res.data.name} · ${res.data.radius_m} m`);
    setCheck(null);
    onSaved();
  }

  const field = "mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-2 text-[14px] disabled:bg-slate-50";

  return (
    <Card>
      <CardHeader
        title={tr("The warehouse", "Gudang")}
        subtitle={current?.lat != null
          ? tr(`Centre ${current.lat.toFixed(5)}, ${current.lng!.toFixed(5)} · radius ${current.radius_m} m${current.active ? "" : " · inactive"}`,
               `Titik ${current.lat.toFixed(5)}, ${current.lng!.toFixed(5)} · radius ${current.radius_m} m${current.active ? "" : " · nonaktif"}`)
          : tr("Not set yet. Stand in the warehouse and use your current location.",
               "Belum diatur. Berdiri di gudang lalu pakai lokasi Anda sekarang.")}
        icon={Warehouse}
      />
      <div className="grid gap-3 px-5 py-4 sm:grid-cols-2">
        <label className="text-[13px] font-medium text-slate-700">
          {tr("Name", "Nama")}
          <input className={field} value={draft.name} disabled={!mayEdit}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
        </label>
        <label className="text-[13px] font-medium text-slate-700">
          {tr("Radius (metres)", "Radius (meter)")}
          <input className={field} inputMode="numeric" value={draft.radius_m} disabled={!mayEdit}
            onChange={(e) => setDraft({ ...draft, radius_m: e.target.value.replace(/[^0-9]/g, "") })} />
          <span className="mt-1 block text-[11px] font-normal text-slate-500">
            {tr(`${DEFAULT_SITE_RADIUS_M} m by default: the compound plus a phone's usual 10–50 m of doubt.`,
                `Bawaan ${DEFAULT_SITE_RADIUS_M} m: area gudang ditambah meleset HP yang biasa 10–50 m.`)}
          </span>
        </label>
        <label className="text-[13px] font-medium text-slate-700">
          {tr("Latitude", "Lintang")}
          <input className={field} inputMode="decimal" value={draft.lat} disabled={!mayEdit} placeholder="-8.65"
            onChange={(e) => setDraft({ ...draft, lat: e.target.value })} />
        </label>
        <label className="text-[13px] font-medium text-slate-700">
          {tr("Longitude", "Bujur")}
          <input className={field} inputMode="decimal" value={draft.lng} disabled={!mayEdit} placeholder="115.21"
            onChange={(e) => setDraft({ ...draft, lng: e.target.value })} />
        </label>
        <label className="flex items-center gap-2 text-[13px] text-slate-700">
          <input type="checkbox" checked={draft.active} disabled={!mayEdit}
            onChange={(e) => setDraft({ ...draft, active: e.target.checked })} />
          {tr("Active — phone taps are judged against it", "Aktif — tap HP dinilai terhadapnya")}
        </label>
        {draft.lat && draft.lng && Number.isFinite(Number(draft.lat)) && Number.isFinite(Number(draft.lng)) && (
          <a href={mapLink(Number(draft.lat), Number(draft.lng))} target="_blank" rel="noreferrer"
             className="self-center text-[13px] text-brand-700 underline">
            {tr("Check the point on the map", "Cek titiknya di peta")}
          </a>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 px-5 py-3">
        {mayEdit && (
          <>
            <Button variant="outline" icon={Crosshair} disabled={reading} onClick={fillFromHere}>
              {reading ? tr("Reading…", "Membaca…") : tr("Use my current location", "Pakai lokasi saya sekarang")}
            </Button>
            <Button icon={Save} disabled={busy} onClick={save}>{tr("Save", "Simpan")}</Button>
          </>
        )}
        <Button variant="ghost" icon={MapPin} disabled={reading} onClick={checkHere}>
          {tr("Where am I against it?", "Posisi saya terhadapnya?")}
        </Button>
        {fix && (
          <span className={cn("text-[12px]", fix.accuracy_m > 30 ? "text-amber-700" : "text-slate-500")}>
            {tr(`Read to ±${Math.round(fix.accuracy_m)} m.`, `Terbaca ±${Math.round(fix.accuracy_m)} m.`)}
            {fix.accuracy_m > 30 && tr(" Step outside or wait a moment and read again.", " Keluar ke area terbuka atau tunggu sebentar lalu baca lagi.")}
          </span>
        )}
        {check && (() => {
          const line = whereLine(check);
          return (
            <span data-testid="site-check" className={cn("text-[13px] font-medium",
              line.tone === "green" ? "text-emerald-700" : line.tone === "amber" ? "text-amber-700" : "text-slate-500")}>
              {line.text}
            </span>
          );
        })()}
        {!mayEdit && (
          <span className="text-[12px] text-slate-500">{tr("Set by HRD or IT.", "Diatur oleh HRD atau IT.")}</span>
        )}
      </div>
    </Card>
  );
}
