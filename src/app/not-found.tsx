import type { Metadata } from "next";
import { Factory } from "lucide-react";
import { BRAND } from "@/lib/brand";
import { NotFoundCard } from "./not-found-card";

export const metadata: Metadata = {
  title: `Page not found — ${BRAND.documentTitle}`,
};

/** 404 — the route that does not exist.
 *
 *  Next renders this for any URL that matches nothing. It sits at the app root
 *  rather than inside `(app)`, so it comes up without the sidebar: a URL that
 *  matched no route also matched no module, and drawing the menu around it
 *  would claim a placement the address never earned. That puts it with
 *  `signin` and `no-access` — the three screens with no chrome — and it is
 *  written in their language for the same reason.
 *
 *  A server component on purpose. Every other screen here is a client
 *  component reading browser-held fixtures, but a 404 has nothing to read —
 *  no session, no demo state, no settings. So it uses the `BRAND` constant
 *  instead of the `useBrand` hook: the hook reaches into `DemoProvider` for a
 *  name the owner can change on the settings screen, and waking that provider
 *  to render a dead end would make the cheapest page in the application one of
 *  the few that needs JavaScript to say anything at all.
 *
 *  What it deliberately does not do is guess. There is no "did you mean…"
 *  here, because the menu is built per person from their module grants — a
 *  suggestion would either name a screen the visitor cannot open, or send them
 *  to one and let the layout refuse them on arrival. Two honest doors instead:
 *  the dashboard, and the account switch for the usual cause, which is being
 *  signed in as somebody who does not have that screen.
 */
export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-700 text-white shadow-sm">
            <Factory className="h-5 w-5" strokeWidth={2.5} />
          </div>
          <div>
            <p className="text-sm font-bold tracking-tight text-slate-800">{BRAND.name}</p>
            <p className="text-[11px] uppercase tracking-wider text-slate-400">{BRAND.tagline}</p>
          </div>
        </div>

        <NotFoundCard />
      </div>
    </div>
  );
}
