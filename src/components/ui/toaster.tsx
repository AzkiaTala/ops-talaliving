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
    /* A 16px gutter on phones (D328); above the bottom tab bar in the
       employee shell (D331). */
    <div className="pointer-events-none fixed bottom-4 left-4 right-4 z-[60] flex flex-col gap-3 sm:bottom-6 sm:left-auto sm:right-6 sm:w-full sm:max-w-sm [[data-shell=employee]_&]:bottom-[calc(88px+env(safe-area-inset-bottom))]">
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
              {t.action && (
                <button
                  type="button"
                  onClick={() => {
                    dismissToast(t.id);
                    t.action?.onClick();
                  }}
                  className="mt-2 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-700"
                >
                  {t.action.label}
                </button>
              )}
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
