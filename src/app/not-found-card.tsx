"use client";

import Link from "next/link";
import { Compass } from "lucide-react";
import { Button, Card } from "@/components/ui/primitives";
import { useTr } from "@/lib/i18n";

/** The body of the 404, on the client so it can follow the viewer's language
 *  while `not-found.tsx` stays a server component with its `metadata`. */
export function NotFoundCard() {
  const tr = useTr();
  return (
    <Card className="p-8 text-center">
      <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-500">
        <Compass className="h-6 w-6" />
      </span>

      {/* The number, once and plainly. `aria-hidden` because the heading
          below already says it in words, and a screen reader announcing
          "four zero four" ahead of the sentence helps nobody. */}
      <p aria-hidden className="mt-5 text-4xl font-bold tracking-tight text-slate-300">404</p>

      <h1 className="mt-2 text-lg font-semibold text-slate-800">{tr("Page not found", "Halaman tidak ditemukan")}</h1>
      <p className="mt-2 text-sm text-slate-500">
        {tr(
          "This address matches no screen. Either it was mistyped, or the link was made before the screen behind it moved.",
          "Alamat ini tidak cocok dengan layar mana pun. Mungkin salah ketik, atau tautannya dibuat sebelum layar di baliknya dipindahkan.",
        )}
      </p>

      <div className="mt-6 flex flex-col gap-2">
        <Link href="/dashboard">
          <Button className="w-full">{tr("Back to the dashboard", "Kembali ke dasbor")}</Button>
        </Link>
        <Link href="/signin">
          <Button variant="outline" className="w-full">{tr("Sign in as someone else", "Masuk sebagai orang lain")}</Button>
        </Link>
      </div>
    </Card>
  );
}
