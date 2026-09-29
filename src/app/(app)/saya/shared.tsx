"use client";

import { useRef } from "react";
import { Camera, ShieldAlert } from "lucide-react";
import { EmptyState } from "@/components/ui/primitives";
import { documents } from "@/demo/api";
import type { DocKind, LinkEntity } from "@/services/documents/contracts";
import type { ApiError } from "@/services/_shared/envelope";
import { useLang, useTr, type Lang } from "@/lib/i18n";
import { cn } from "@/lib/cn";

/** A `YYYY-MM-DD` office-day key as words: *Sen, 28 Sep*.
 *
 *  Formatted from the key itself in UTC, never from `new Date()` in the
 *  browser's zone — the key already *is* the office day (`src/lib/office.ts`),
 *  and re-reckoning it in the phone's zone is how F183's 23:25 happened. */
export function dayLabel(key: string, lang: Lang, long = false): string {
  return new Date(`${key}T00:00:00Z`).toLocaleDateString(lang === "id" ? "id-ID" : "en-GB", {
    weekday: long ? "long" : "short", day: "numeric", month: long ? "long" : "short",
    timeZone: "UTC",
  });
}

export function useDayLabel() {
  const lang = useLang();
  return (key: string, long = false) => dayLabel(key, lang, long);
}

/** Upload a photo to its task folder and file it against a record — the two
 *  steps every evidence button in this app takes (ADR-010). `entity` goes to
 *  the upload so the file lands in the record's own folder under
 *  `ops-talaliving` (D313, D320); the kind alone decides the drive (0035). */
export async function attachPhoto(
  file: File, kind: DocKind, entity: LinkEntity, entityNo: string,
): Promise<ApiError | null> {
  const up = await documents.upload({ file, kind, entity });
  if (up.error) return up.error;
  const linked = await documents.link({ attachment_id: up.data.id, entity, entity_no: entityNo, kind });
  return linked.error ?? null;
}

/** A camera button that is a real `<input type=file>` underneath: on a phone
 *  `capture="environment"` opens the back camera straight away, and on a desk
 *  it is an ordinary file picker. */
export function CameraButton({
  label, onFile, disabled, file, className,
}: {
  label: string;
  onFile: (f: File | null) => void;
  disabled?: boolean;
  file?: File | null;
  className?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const tr = useTr();
  return (
    <label
      className={cn(
        "flex min-h-[52px] cursor-pointer items-center gap-3 rounded-xl border-2 border-dashed px-4 text-[15px]",
        file ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "border-slate-300 bg-white text-slate-700",
        disabled && "pointer-events-none opacity-50",
        className,
      )}
    >
      <Camera className="h-6 w-6 shrink-0" />
      <span className="min-w-0 flex-1 truncate">{file ? file.name : label}</span>
      {file && <span className="text-[12px] font-medium">{tr("Change", "Ganti")}</span>}
      <input
        ref={ref}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        disabled={disabled}
        onChange={(e) => onFile(e.target.files?.[0] ?? null)}
      />
    </label>
  );
}

export function NotLinked() {
  const tr = useTr();
  return (
    <EmptyState
      icon={ShieldAlert}
      title={tr("This account is not linked to an employee record", "Akun ini belum tertaut ke data karyawan")}
      description={tr(
        "Attendance, requests and pay belong to a person on the payroll. Ask HRD to link this account if it should have them.",
        "Presensi, pengajuan dan gaji milik orang yang ada di daftar gaji. Minta HRD menautkan akun ini kalau seharusnya ada.",
      )}
    />
  );
}

/** Inputs sized for a thumb: 48px, 16px text (below 16px iOS zooms the page
 *  on focus). */
export const FIELD = "h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-base focus:border-brand-500 focus:outline-none";
