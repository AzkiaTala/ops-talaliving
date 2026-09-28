"use client";

import Link from "next/link";
import { Construction } from "lucide-react";
import { useTr } from "@/lib/i18n";

/** What a screen without a backend says for itself.
 *
 *  Hiding the menu item is courtesy; it is not the answer, because a URL can be
 *  typed, bookmarked from the demo, or pasted into a chat by somebody who saw
 *  the screen last week. Landing on a blank page — or worse, on a working-looking
 *  table with no rows in it — is how a person concludes the business has no
 *  employees rather than that the module has no database yet.
 *
 *  So it says which module, and it says the one true thing about it: the screen
 *  exists and works, on demo data, at the address where the demo lives. That is
 *  a better answer than "404", and it is the honest one.
 */
export function NotLive({ module }: { module?: string }) {
  const tr = useTr();
  return (
    <div className="mx-auto max-w-lg py-16 text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-amber-50 text-amber-600">
        <Construction className="h-6 w-6" />
      </div>
      <h1 className="mt-4 text-lg font-semibold text-slate-900">{tr("Not live yet", "Belum live")}</h1>
      <p className="mt-2 text-sm leading-relaxed text-slate-600">
        {module
          ? <>{tr("The ", "Modul ")}<strong>{module}</strong>{tr(" module is not", " belum")}</>
          : <>{tr("This screen is not", "Layar ini belum")}</>}{" "}
        {tr("connected to the database yet.", "tersambung ke basis data.")}{" "}
        {tr("The first to go live are ", "Yang live lebih dulu adalah ")}<strong>procurement</strong>{tr(" and ", " dan ")}<strong>accounting</strong>
        {tr(", because those already run every day.", ", karena itu yang sudah berjalan setiap hari.")}
      </p>
      <p className="mt-3 text-sm leading-relaxed text-slate-600">
        {tr(
          "The screen itself is finished and can be walked end to end on the demo deployment — complete with sample data, without touching the real figures.",
          "Layarnya sendiri sudah jadi dan bisa dijalani utuh di deployment demo — lengkap dengan data contoh, tanpa menyentuh angka yang sebenarnya.",
        )}
      </p>
      <Link
        href="/dashboard"
        className="mt-6 inline-flex items-center rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
      >
        {tr("Back to dashboard", "Kembali ke dashboard")}
      </Link>
    </div>
  );
}
