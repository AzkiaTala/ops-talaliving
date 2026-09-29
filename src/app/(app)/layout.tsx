"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { Sidebar } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";
import { useSession } from "@/store/session";
import { TourBar } from "@/components/tour-bar";
import { JohnLauDock } from "@/components/john-lau/dock";
import { NotLive } from "@/components/not-live";
import { isRouteLive } from "@/lib/live";
import { ActivityRecorder } from "@/components/activity-recorder";
import { EmployeeShell } from "@/components/layout/employee-shell";
import { setAudienceLang } from "@/lib/i18n";

/** What an employee-only account may open (D331). `/set-password` lives
 *  outside this layout and is never bounced. Everything else goes to `/saya`. */
const EMPLOYEE_ROUTES = ["/saya", "/profil"];
function employeeMayOpen(pathname: string): boolean {
  return EMPLOYEE_ROUTES.some((r) => pathname === r || pathname.startsWith(`${r}/`));
}

/** The application shell.
 *
 *  The sidebar and topbar do not scroll; only `<main>` does. That is what makes
 *  this feel like desktop software rather than a long web page — the menu is
 *  always where you left it.
 *
 *  The shell WAITS for the session before rendering anything. Drawing a menu
 *  and then taking half of it away is worse than a moment of nothing, and it is
 *  the specific failure the original skeleton left a note about.
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const { ready, needsSignIn, door, session } = useSession();
  const router = useRouter();
  const pathname = usePathname();

  /* Hiding the menu item is courtesy; this is the answer. A URL survives being
   * bookmarked from the demo and pasted into a chat, and a screen whose service
   * does not exist renders an empty table that reads as *there is nothing here*
   * rather than *this is not connected yet*. Note it swaps the page and keeps
   * the shell: the menu stays, so the modules that ARE live are one click away
   * instead of a back button. */
  const live = isRouteLive(pathname);

  useEffect(() => {
    if (!ready) return;

    /* **Two different nothings, and they are not the same door.** Nobody signed
     * in goes to the sign-in screen; somebody signed in with no grants goes to
     * the page that says who to ask. Sending the first to `/no-access` tells
     * them to contact IT about an account they have not used yet, and sending
     * the second to `/signin` asks them to authenticate again when they already
     * have — both are dead ends, and both look like the application is broken.
     *
     * The order matters: `hasAnyModule` is false for a visitor with no session
     * at all, so the sign-in check has to come first or it never runs. */
    /* The page asked for comes along, so signing in lands back on it. A
       label's QR opens an item's page (D321); without this, a scan by
       somebody not yet signed in ended on the dashboard (F175). */
    if (needsSignIn) {
      const here = window.location.pathname + window.location.search;
      router.replace(here && here !== "/" ? `/signin?next=${encodeURIComponent(here)}` : "/signin");
      return;
    }
    /* **A third door (D331).** No module used to mean `/no-access`. But a
       production worker needs no module: their self-service is scoped by the
       account-to-employee link, not by a grant (D305) — so the one audience
       `/profil` was written for was the one turned away (F183). Now: no
       module and a link lands on `/saya`, and may open only that and
       `/profil`; no module and no link is still `/no-access`. */
    if (door === "none") router.replace("/no-access");
    if (door === "employee" && !employeeMayOpen(pathname)) router.replace("/saya");
  }, [ready, needsSignIn, door, pathname, router]);

  /* Indonesian for the floor unless they have chosen (D331); everybody else
     keeps the default (D318). Cleared on the way out, so a staff account in
     the same browser afterwards is not left reading the floor's language. */
  useEffect(() => {
    setAudienceLang(door === "employee" ? "id" : null);
  }, [door]);

  if (!ready || door === null || door === "none" || (door === "employee" && !employeeMayOpen(pathname))) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-100">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-slate-300 border-t-brand-600" />
      </div>
    );
  }

  if (door === "employee") {
    return (
      <Suspense fallback={null}>
        <EmployeeShell name={session?.user.full_name ?? ""}>
          {live ? children : <NotLive module={pathname.split("/")[1]} />}
        </EmployeeShell>
        <ActivityRecorder />
      </Suspense>
    );
  }

  return (
    /* Printing is for the document on the page, never for the furniture around
       it: a purchase order going to a supplier must not carry our menu (D133). */
    <div className="flex h-screen overflow-hidden bg-slate-100 print:block print:h-auto print:overflow-visible print:bg-white">
      <div className="contents print:hidden">
        <Sidebar mobileOpen={mobileOpen} onClose={() => setMobileOpen(false)} />
      </div>
      <div className="flex flex-1 flex-col overflow-hidden print:block print:overflow-visible">
        <div className="print:hidden">
          <Topbar onMenuClick={() => setMobileOpen(true)} />
        </div>
        <main className="flex-1 overflow-y-auto print:overflow-visible">
          {/* Extra room at the bottom: the John Lau launcher floats over the
              corner, and without this it sits permanently on top of the last row
              of every list (F65). On wide screens too — the HR walk found it
              covering the only "Pasang" button on /hrd/jadwal (F154). */}
          <div className="mx-auto max-w-[1400px] px-4 pb-24 pt-6 md:px-6 lg:px-8 print:max-w-none print:p-0">
            {live ? children : <NotLive module={pathname.split("/")[1]} />}
          </div>
        </main>
      </div>
      {/* useSearchParams needs a boundary; the bar is absent until it resolves,
          which is the right absence — nothing on the page depends on it. */}
      <Suspense fallback={null}>
        <TourBar />
      </Suspense>
      {/* In the shell, not on a page: the point of it is to keep reading the
          steps while you move to the screen they describe (D223). */}
      <JohnLauDock />
      {/* Below `ready`, so nothing is recorded before there is somebody to
          record it against. Renders nothing and blocks nothing — if the trail
          is unavailable the screen still opens, because an observability
          feature that can take a page down is an outage with a nice name. */}
      <ActivityRecorder />
    </div>
  );
}
