"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Lock } from "lucide-react";
import { Button, Card } from "@/components/ui/primitives";
import { useSession } from "@/store/session";
import { useTr } from "@/lib/i18n";

/** No access.
 *
 *  An account with no modules lands here instead of bouncing between pages it
 *  cannot open. It says which account it is, because "you have no access" with
 *  no name attached is the least useful sentence in software — the usual cause
 *  is being signed in as somebody else.
 */
export default function NoAccessPage() {
  const { session, setModules, door } = useSession();
  const router = useRouter();
  const tr = useTr();

  /* An employee-only account has somewhere to be (D331) — a bookmark of this
     page from before its link existed should not strand it here. */
  useEffect(() => {
    if (door === "employee") router.replace("/saya");
  }, [door, router]);

  /* Switched off by IT (0183) is a different sentence and a different next
     step from *nothing granted yet*: nobody is about to grant this account
     anything, and the demo's self-grant would be the wrong button. */
  if (session && !session.user.is_active) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4 py-10">
        <Card className="w-full max-w-md p-8 text-center">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-rose-50 text-rose-600">
            <Lock className="h-6 w-6" />
          </span>
          <h1 className="mt-5 text-lg font-semibold text-slate-800">{tr("This account is switched off", "Akun ini dinonaktifkan")}</h1>
          <p className="mt-2 text-sm text-slate-500">
            {tr("The account", "Akun")} <span className="font-medium text-slate-700">{session.user.email}</span>{" "}
            {tr(
              "has been switched off by IT, so it can no longer open anything. If that is a mistake, ask IT to switch it back on.",
              "telah dinonaktifkan oleh IT, jadi tidak bisa membuka apa pun lagi. Jika ini keliru, minta IT mengaktifkannya kembali.",
            )}
          </p>
          <div className="mt-6">
            <Link href="/signin">
              <Button variant="outline" className="w-full">{tr("Sign in as someone else", "Masuk sebagai orang lain")}</Button>
            </Link>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4 py-10">
      <Card className="w-full max-w-md p-8 text-center">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-amber-50 text-amber-600">
          <Lock className="h-6 w-6" />
        </span>
        <h1 className="mt-5 text-lg font-semibold text-slate-800">{tr("No modules granted", "Belum ada modul yang diberikan")}</h1>
        <p className="mt-2 text-sm text-slate-500">
          {session
            ? <>{tr("The account", "Akun")} <span className="font-medium text-slate-700">{session.user.email}</span> {tr("has no module access, so there is nothing to show. Someone with IT access can grant it.", "belum punya akses modul, jadi tidak ada yang bisa ditampilkan. Orang dengan akses IT dapat memberikannya.")}</>
            : <>{tr("This account has no module access, so there is nothing to show.", "Akun ini belum punya akses modul, jadi tidak ada yang bisa ditampilkan.")}</>}
        </p>

        <div className="mt-6 flex flex-col gap-2">
          {/* Demo affordance: the way back in without needing a second person.
              It goes with the demo layer in Phase 2, where granting access is
              somebody else's decision and rightly not self-serve. */}
          <Button
            onClick={async () => {
              await setModules([
                { module: "dashboard", level: "read" },
                { module: "procurement", level: "read" },
              ]);
              router.push("/dashboard");
            }}
          >
            {tr("Grant myself read access (demo)", "Beri saya akses baca (demo)")}
          </Button>
          <Link href="/signin">
            <Button variant="outline" className="w-full">{tr("Sign in as someone else", "Masuk sebagai orang lain")}</Button>
          </Link>
        </div>
      </Card>
    </div>
  );
}
