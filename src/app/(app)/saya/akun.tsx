"use client";

import Link from "next/link";
import { KeyRound, LogOut, UserRound } from "lucide-react";
import { InstallApp } from "@/components/pwa/install-app";
import { Button, Card } from "@/components/ui/primitives";
import { useSession } from "@/store/session";
import { isLiveMode } from "@/lib/live";
import { LANGS, setLang, useLang, useTr } from "@/lib/i18n";
import { cn } from "@/lib/cn";

/** Who is signed in, which language, the way out — and nothing that sends
 *  mail to an address nobody reads.
 *
 *  An employee-only account's email is text IT typed, and nothing is ever
 *  delivered to it (D329). A *send me a reset link* button there would report
 *  success and change nothing. So the floor is told the truth: IT makes a new
 *  password. A staff account has a real mailbox and keeps `/profil`'s link. */
export function AkunTab({ employeeOnly }: { employeeOnly: boolean }) {
  const tr = useTr();
  const lang = useLang();
  const { session, signOut } = useSession();
  const live = isLiveMode();

  return (
    <div className="space-y-4">
      <Card className="flex items-center gap-4 px-5 py-4">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-brand-100 text-brand-700">
          <UserRound className="h-6 w-6" />
        </span>
        <div className="min-w-0">
          <p className="truncate text-[17px] font-semibold text-slate-900">{session?.user.full_name}</p>
          <p className="truncate text-[14px] text-slate-500">{session?.user.email}</p>
        </div>
      </Card>

      <Card className="px-5 py-4">
        <p className="text-[14px] font-semibold text-slate-800">{tr("Language", "Bahasa")}</p>
        <div className="mt-3 grid grid-cols-2 gap-2">
          {LANGS.map((l) => (
            <button
              key={l.code} type="button" onClick={() => setLang(l.code)} aria-pressed={lang === l.code}
              className={cn(
                "h-12 rounded-xl text-[15px] font-medium ring-1 ring-inset",
                lang === l.code ? "bg-brand-600 text-white ring-brand-600" : "bg-white text-slate-700 ring-slate-300",
              )}
            >
              {l.label}
            </button>
          ))}
        </div>
      </Card>

      {/* D328's install action. It draws nothing where the browser cannot
          install or the app is already running installed. */}
      <div data-slot="install" className="flex justify-center">
        <InstallApp label className="[&_button]:h-12 [&_button]:text-base" />
      </div>

      <Card className="px-5 py-4">
        <p className="flex items-center gap-2 text-[14px] font-semibold text-slate-800">
          <KeyRound className="h-4 w-4" /> {tr("Password", "Kata sandi")}
        </p>
        {employeeOnly ? (
          <p className="mt-2 text-[14px] text-slate-600" data-testid="password-help">
            {tr("Forgot your password? Ask IT to make a new one.", "Lupa kata sandi? Minta IT membuat yang baru.")}
          </p>
        ) : (
          <p className="mt-2 text-[14px] text-slate-600">
            {tr("A change link is sent to your email from ", "Tautan ganti dikirim ke email Anda dari ")}
            <Link href="/profil" className="font-medium text-brand-700 underline">{tr("My profile", "Profil saya")}</Link>.
          </p>
        )}
      </Card>

      {live ? (
        <Button variant="outline" icon={LogOut} className="h-12 w-full text-base" onClick={() => void signOut()}>
          {tr("Sign out", "Keluar")}
        </Button>
      ) : (
        <p className="px-1 text-center text-[12px] text-slate-400">
          {tr("Demo: there is no session to sign out of.", "Demo: tidak ada sesi untuk keluar.")}
        </p>
      )}
    </div>
  );
}
