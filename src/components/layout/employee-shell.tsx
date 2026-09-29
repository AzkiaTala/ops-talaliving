"use client";

import { createContext, useContext, useEffect } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Fingerprint, FileText, Wallet, UserRound } from "lucide-react";
import { LANGS, setLang, useLang, useTr } from "@/lib/i18n";
import { cn } from "@/lib/cn";

/** The four places an employee goes, in the order a day uses them (D331). */
export const SAYA_TABS = ["presensi", "pengajuan", "gaji", "akun"] as const;
export type SayaTab = (typeof SAYA_TABS)[number];

export function sayaTab(raw: string | null | undefined): SayaTab {
  return SAYA_TABS.includes(raw as SayaTab) ? (raw as SayaTab) : "presensi";
}

/** True inside the phone shell — `/saya` then leaves its own tab strip out,
 *  because the bottom bar already is one. A staff account opens `/saya` inside
 *  the full shell and gets the strip instead. */
const InEmployeeShell = createContext(false);
export function useInEmployeeShell(): boolean {
  return useContext(InEmployeeShell);
}

export function useSayaTabLabels() {
  const tr = useTr();
  return {
    presensi: { label: tr("Attendance", "Presensi"), icon: Fingerprint },
    pengajuan: { label: tr("Requests", "Pengajuan"), icon: FileText },
    gaji: { label: tr("Pay", "Gaji"), icon: Wallet },
    akun: { label: tr("Account", "Akun"), icon: UserRound },
  } as const;
}

/** The shell for an account that holds no module but is somebody on the
 *  payroll: the workshop floor and the guards, on their own phones (D326).
 *
 *  No sidebar — there is nothing to navigate between but four tabs, and a
 *  hamburger with four items in it is a menu hidden for no reason. The tabs sit
 *  at the bottom where a thumb is, each a full quarter of the width and 64px
 *  tall, because the phone is a low-end Android held in a hand that has just
 *  put a tool down.
 */
export function EmployeeShell({ name, children }: { name: string; children: React.ReactNode }) {
  const tr = useTr();
  const lang = useLang();
  const pathname = usePathname();
  const params = useSearchParams();
  const tabs = useSayaTabLabels();
  const current = pathname === "/saya" ? sayaTab(params.get("tab")) : pathname === "/profil" ? "akun" : null;

  /* Lets things mounted outside this tree (the toaster) keep clear of the
     bottom bar. */
  useEffect(() => {
    document.body.dataset.shell = "employee";
    return () => { delete document.body.dataset.shell; };
  }, []);

  return (
    <InEmployeeShell.Provider value={true}>
      <div className="flex min-h-[100dvh] flex-col bg-slate-100">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-slate-200 bg-white px-4">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-100 text-sm font-semibold text-brand-700">
            {name.charAt(0)}
          </span>
          <span className="min-w-0 flex-1 truncate text-[15px] font-semibold text-slate-800">{name}</span>
          <div role="group" aria-label={tr("Language", "Bahasa")} className="flex shrink-0 overflow-hidden rounded-lg ring-1 ring-inset ring-slate-200">
            {LANGS.map((l) => (
              <button
                key={l.code}
                type="button"
                onClick={() => setLang(l.code)}
                aria-pressed={lang === l.code}
                title={l.label}
                className={cn(
                  "min-h-[36px] px-3 text-[12px] font-semibold uppercase",
                  lang === l.code ? "bg-brand-600 text-white" : "text-slate-500",
                )}
              >
                {l.code}
              </button>
            ))}
          </div>
        </header>

        {/* Room at the bottom for the bar, and for the phone's own gesture strip. */}
        <main className="mx-auto w-full max-w-xl flex-1 px-4 pb-[calc(88px+env(safe-area-inset-bottom))] pt-4">
          {children}
        </main>

        <nav
          aria-label={tr("Main", "Utama")}
          className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)]"
        >
          <ul className="mx-auto grid max-w-xl grid-cols-4">
            {SAYA_TABS.map((t) => {
              const Icon = tabs[t].icon;
              const on = current === t;
              return (
                <li key={t}>
                  <Link
                    href={`/saya?tab=${t}`}
                    aria-current={on ? "page" : undefined}
                    className={cn(
                      "flex h-16 flex-col items-center justify-center gap-1 text-[12px] font-medium",
                      on ? "text-brand-700" : "text-slate-500",
                    )}
                  >
                    <Icon className={cn("h-6 w-6", on && "stroke-[2.25]")} />
                    {tabs[t].label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </div>
    </InEmployeeShell.Provider>
  );
}
