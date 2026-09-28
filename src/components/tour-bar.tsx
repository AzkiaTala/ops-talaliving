"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight, X, Footprints } from "lucide-react";
import { Button } from "@/components/ui/primitives";
import { TOURS, tourHref } from "@/lib/tour";
import { useTr } from "@/lib/i18n";

/** The walk, as a bar along the bottom.
 *
 *  Deliberately not a spotlight over a highlighted button. Half of what this
 *  demo is for is people clicking things nobody planned for them to click, and
 *  a tour that dims the rest of the screen turns that into a locked door.
 *  Everything underneath stays live; the bar only says what is worth looking
 *  at here (D117).
 */
export function TourBar() {
  const router = useRouter();
  const tr = useTr();
  const params = useSearchParams();
  /* On a phone the full paragraph eats half the screen, and the screen is the
     thing being demonstrated. Two lines, tap for the rest. */
  const [expanded, setExpanded] = useState(false);
  const tour = TOURS[params.get("tour") ?? ""];

  /* The bar floats over the page, so the page needs room under its last row —
     but only while the tour is running. A permanent gap for a bar that is
     usually absent is a worse trade. */
  useEffect(() => { setExpanded(false); }, [params]);

  useEffect(() => {
    const root = document.documentElement;
    if (tour) root.dataset.tour = "on";
    else delete root.dataset.tour;
    return () => { delete root.dataset.tour; };
  }, [tour]);

  if (!tour) return null;

  const raw = Number(params.get("step") ?? "1");
  const index = Number.isFinite(raw) ? Math.min(Math.max(raw, 1), tour.steps.length) - 1 : 0;
  const step = tour.steps[index];
  const first = index === 0;
  const last = index === tour.steps.length - 1;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center px-3 pb-3">
      <div className="pointer-events-auto w-full max-w-3xl rounded-xl border border-slate-700 bg-slate-900/95 px-4 py-3 text-white shadow-drawer backdrop-blur">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white/10">
            <Footprints className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] uppercase tracking-wide text-slate-400">
              {tr(tour.name.en, tour.name.id)} · {tr(`step ${index + 1} of ${tour.steps.length}`, `langkah ${index + 1} dari ${tour.steps.length}`)}
            </p>
            <p className="text-[14px] font-semibold">{tr(step.title.en, step.title.id)}</p>
            <button
              onClick={() => setExpanded((v) => !v)}
              className="mt-0.5 block w-full text-left text-[13px] leading-snug text-slate-300 sm:cursor-default"
              aria-expanded={expanded}
            >
              <span className={expanded ? "" : "line-clamp-2 sm:line-clamp-none"}>{tr(step.body.en, step.body.id)}</span>
              {!expanded && <span className="text-slate-500 sm:hidden">{tr(" — tap for the rest", " — ketuk untuk selengkapnya")}</span>}
            </button>
          </div>
          <button
            onClick={() => router.push(step.href)}
            className="shrink-0 rounded-lg p-1 text-slate-400 hover:bg-white/10 hover:text-white"
            aria-label={tr("Leave the tour", "Keluar dari tur")}
            title={tr("Leave the tour", "Keluar dari tur")}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-2.5 flex items-center gap-2">
          {/* Where you are, and how much is left. */}
          <div className="mr-auto hidden gap-1 sm:flex" aria-hidden>
            {tour.steps.map((s, i) => (
              <span
                key={s.href + i}
                className={`h-1 w-4 rounded-full ${i <= index ? "bg-brand-400" : "bg-white/20"}`}
              />
            ))}
          </div>
          <Button
            variant="ghost" size="sm" icon={ChevronLeft}
            className="mr-auto whitespace-nowrap text-slate-300 hover:bg-white/10 hover:text-white sm:mr-0"
            disabled={first}
            onClick={() => router.push(tourHref(tour, index - 1))}
          >
            {tr("Previous step", "Langkah sebelumnya")}
          </Button>
          {last ? (
            <Button size="sm" className="whitespace-nowrap" onClick={() => router.push(step.href)}>{tr("Finish the walk", "Selesaikan tur")}</Button>
          ) : (
            <Button size="sm" icon={ChevronRight} className="whitespace-nowrap" onClick={() => router.push(tourHref(tour, index + 1))}>
              {tr("Next step", "Langkah berikutnya")}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
