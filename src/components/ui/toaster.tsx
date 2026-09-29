"use client";

import { CheckCircle2, Info, AlertTriangle, XCircle, X } from "lucide-react";
import { useToast, type ToastLevel } from "@/store/toast";
import { cn } from "@/lib/cn";
import { useTr } from "@/lib/i18n";

const config: Record<ToastLevel, { icon: typeof Info; ring: string; iconColor: string }> = {
  info: { icon: Info, ring: "border-brand-200", iconColor: "text-brand-600" },
  success: { icon: CheckCircle2, ring: "border-emerald-200", iconColor: "text-emerald-600" },
  warning: { icon: AlertTriangle, ring: "border-amber-200", iconColor: "text-amber-600" },
  critical: { icon: XCircle, ring: "border-rose-200", iconColor: "text-rose-600" },
};

export function Toaster() {
  const { toasts, dismissToast } = useToast();
  const tr = useTr();
  return (
    /* Never wider than the phone (it used to start 24px off the left edge at
       390px), and above the bottom tab bar in the employee shell (D331). */
    <div className="pointer-events-none fixed bottom-6 right-6 z-[60] flex w-[calc(100vw-3rem)] max-w-sm flex-col gap-3 [[data-shell=employee]_&]:bottom-[calc(88px+env(safe-area-inset-bottom))]">
      {toasts.map((t) => {
        const c = config[t.level];
        const Icon = c.icon;
        return (
          <div
            key={t.id}
            className={cn(
              "pointer-events-auto flex items-start gap-3 rounded-xl border bg-white px-4 py-3 shadow-lg animate-fade-in",
              c.ring,
            )}
          >
            <Icon className={cn("mt-0.5 h-5 w-5 shrink-0", c.iconColor)} />
            <div className="flex-1">
              <p className="text-sm font-semibold text-slate-800">{t.title}</p>
              {t.message && <p className="mt-0.5 text-xs text-slate-500">{t.message}</p>}
            </div>
            <button
              onClick={() => dismissToast(t.id)}
              className="text-slate-400 hover:text-slate-600"
              aria-label={tr("Dismiss notification", "Tutup notifikasi")}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
