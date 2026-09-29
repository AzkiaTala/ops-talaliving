"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Card } from "@/components/ui/primitives";
import { SAYA_TABS, sayaTab, useInEmployeeShell, useSayaTabLabels } from "@/components/layout/employee-shell";
import { useSession } from "@/store/session";
import { cn } from "@/lib/cn";
import { PresensiTab } from "./presensi";
import { PengajuanTab } from "./pengajuan";
import { GajiTab } from "./gaji";
import { AkunTab } from "./akun";
import { NotLinked } from "./shared";

/** `/saya` — the home every employee opens on their phone (D326, D331).
 *
 *  Presensi, pengajuan, gaji, akun: the half of `/profil` (W7) the workshop
 *  floor and the guards actually need, laid out for a thumb. Everything is
 *  scoped by the account ↔ employee link (`hr.myProfile()`, D305), never by a
 *  module grant — which is why an account with no module reaches it at all.
 *
 *  An employee-only account sees it inside the phone shell (bottom tab bar,
 *  no sidebar). A staff account opens the same page from the topbar inside the
 *  full shell, with the tabs across the top instead.
 */
export default function SayaPage() {
  return (
    <Suspense fallback={null}>
      <Saya />
    </Suspense>
  );
}

function Saya() {
  const params = useSearchParams();
  const tab = sayaTab(params.get("tab"));
  const inShell = useInEmployeeShell();
  const { employeeNo, door } = useSession();
  const labels = useSayaTabLabels();

  return (
    <div className={cn(!inShell && "mx-auto max-w-xl")}>
      {!inShell && (
        <nav className="mb-4 grid grid-cols-4 gap-1 rounded-xl bg-white p-1 ring-1 ring-inset ring-slate-200">
          {SAYA_TABS.map((t) => (
            <Link
              key={t} href={`/saya?tab=${t}`} aria-current={tab === t ? "page" : undefined}
              className={cn(
                "flex h-11 items-center justify-center rounded-lg text-[14px] font-medium",
                tab === t ? "bg-brand-600 text-white" : "text-slate-600 hover:bg-slate-50",
              )}
            >
              {labels[t].label}
            </Link>
          ))}
        </nav>
      )}

      {tab === "akun" ? (
        <AkunTab employeeOnly={door === "employee"} />
      ) : !employeeNo ? (
        <Card><NotLinked /></Card>
      ) : tab === "presensi" ? (
        <PresensiTab employeeNo={employeeNo} />
      ) : tab === "pengajuan" ? (
        <PengajuanTab />
      ) : (
        <GajiTab />
      )}
    </div>
  );
}
