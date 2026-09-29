"use client";

import { useEffect, useRef, useState } from "react";
import { Download, Share, SquarePlus, X } from "lucide-react";
import { Button } from "@/components/ui/primitives";
import { useTr } from "@/lib/i18n";
import { promptInstall, useInstallState } from "@/lib/pwa";
import { cn } from "@/lib/cn";

/** "Pasang aplikasi / Install app" (D328).
 *
 *  Quiet by design: a ghost button, never a banner, never a popup that opens
 *  by itself, and gone once the app runs from the home screen. Somebody who
 *  does not want it installed is never asked twice — they are never asked at
 *  all, they are shown a button.
 *
 *  Reusable: the topbar mounts it, and so can the employee home (`/saya`,
 *  D331). `label` shows the words beside the icon at every width, for a page
 *  with room; by default they appear from `md` up, as the topbar's other
 *  buttons do.
 */
export function InstallApp({ label = false, className }: { label?: boolean; className?: string }) {
  const state = useInstallState();
  const tr = useTr();
  const [iosOpen, setIosOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!iosOpen) return;
    const close = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setIosOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [iosOpen]);

  if (state === "none") return null;

  const text = tr("Install app", "Pasang aplikasi");

  return (
    <div ref={box} className={cn("relative", className)}>
      <Button
        variant="ghost"
        size="sm"
        icon={Download}
        onClick={() => (state === "prompt" ? void promptInstall() : setIosOpen((o) => !o))}
        title={text}
        aria-label={text}
        aria-expanded={state === "ios" ? iosOpen : undefined}
      >
        <span className={label ? "" : "hidden md:inline"}>{text}</span>
      </Button>

      {/* Absolute, not fixed: the topbar blurs its backdrop, which makes it the
          containing block for anything fixed inside it (see topbar.tsx). */}
      {state === "ios" && iosOpen && (
        <div
          role="dialog"
          aria-label={text}
          className="absolute right-0 top-full z-40 mt-2 w-72 max-w-[calc(100vw-2rem)] rounded-xl border border-slate-200 bg-white p-4 text-left shadow-lg"
        >
          <div className="flex items-start gap-2">
            <p className="flex-1 text-sm font-semibold text-slate-800">
              {tr("Add to your Home Screen", "Tambahkan ke Layar Utama")}
            </p>
            <button
              type="button"
              onClick={() => setIosOpen(false)}
              className="text-slate-400 hover:text-slate-600"
              aria-label={tr("Close", "Tutup")}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <ol className="mt-3 space-y-2 text-sm text-slate-600">
            <li className="flex items-start gap-2">
              <span className="font-semibold text-slate-400">1.</span>
              <span>
                {tr("In Safari, tap Share", "Di Safari, ketuk Bagikan")}{" "}
                <Share className="inline h-4 w-4 -translate-y-0.5 text-brand-600" aria-hidden />
              </span>
            </li>
            <li className="flex items-start gap-2">
              <span className="font-semibold text-slate-400">2.</span>
              <span>
                {tr("Choose Add to Home Screen", "Pilih Tambah ke Layar Utama")}{" "}
                <SquarePlus className="inline h-4 w-4 -translate-y-0.5 text-brand-600" aria-hidden />
              </span>
            </li>
            <li className="flex items-start gap-2">
              <span className="font-semibold text-slate-400">3.</span>
              <span>{tr("Tap Add, then open it from the Home Screen.", "Ketuk Tambah, lalu buka dari Layar Utama.")}</span>
            </li>
          </ol>
        </div>
      )}
    </div>
  );
}
