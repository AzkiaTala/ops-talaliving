"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Factory, KeyRound, AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import { Card, Badge, Button } from "@/components/ui/primitives";
import { useBrand } from "@/lib/brand";
import { identity } from "@/demo/api";
import { isLiveMode } from "@/lib/live";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useTr } from "@/lib/i18n";
import { useSession } from "@/store/session";

/** Set a password.
 *
 *  ## Why this route had to exist before anybody could sign in
 *
 *  A Supabase recovery mail is a link to GoTrue, which verifies the token and
 *  then redirects to **Site URL** with a session in the URL. On a project set
 *  up for local development that is `http://localhost:3000`, so the link opened
 *  a machine the reader was not sitting at — and even pointed at production it
 *  would have landed on a page that did nothing with what it carried. The first
 *  administrator account was created in August and still had no password anybody
 *  knew in September, because there was no page to arrive at.
 *
 *  This is that page. It is outside `(app)` on purpose: the shell redirects
 *  anybody without a profile to `/signin`, and somebody halfway through a
 *  recovery is exactly that person.
 *
 *  ## Two kinds of link, and the SDK reads only one
 *
 *  A link somebody asked for themselves — *lupa kata sandi* on the sign-in page
 *  — is PKCE: it comes back as `?code=…`, and `supabase-js` exchanges it on its
 *  own, in the browser that asked. This page just waits for that, which is
 *  what `onAuthStateChange` is for.
 *
 *  A link somebody else caused — IT inviting a person, or sending them a link
 *  from `/it/pengguna` (D325) — cannot be PKCE: the verifier lives in the
 *  browser that asked, which is IT's, not the person's. GoTrue sends those as
 *  an implicit grant, the session in `#access_token=…`. **The application's
 *  client is PKCE and refuses that URL** (*Not a valid PKCE flow url*), so the
 *  invitation would have opened on *this link cannot be used* every time
 *  (F182). So this page reads that fragment itself — only that shape, only
 *  here — hands the two tokens to `setSession`, and strips them from the
 *  address bar so they do not sit in history or in a screenshot.
 *
 *  ## Two ways in, one form
 *
 *  Arriving from a mail and choosing *ganti kata sandi* while already signed in
 *  are the same request to GoTrue, so they are the same form here. The only
 *  difference is what happens when there is no session at all: a bookmark or an
 *  expired link, which needs to be said as *ask for a new one*, not as *Auth
 *  session missing*.
 */
export default function SetPasswordPage() {
  const brand = useBrand();
  const live = isLiveMode();

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4 py-10">
      <div className="w-full max-w-lg">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-700 text-white shadow-sm">
            <Factory className="h-5 w-5" strokeWidth={2.5} />
          </div>
          <div>
            <p className="text-sm font-bold tracking-tight text-slate-800">{brand.name}</p>
            <p className="text-[11px] uppercase tracking-wider text-slate-400">{brand.tagline}</p>
          </div>
          {live
            ? <Badge tone="green" className="ml-auto">Live</Badge>
            : <Badge tone="amber" className="ml-auto">Demo</Badge>}
        </div>

        {live ? <Form /> : <NotInDemo />}
      </div>
    </div>
  );
}

function NotInDemo() {
  const tr = useTr();
  return (
    <Card className="px-5 py-5">
      <h1 className="text-base font-semibold text-slate-800">{tr("No password here", "Tidak ada kata sandi di sini")}</h1>
      <p className="mt-2 text-sm text-slate-500">
        {tr(
          "Demo mode does not check passwords — choosing a person on the sign-in page is the sign-in. This page only means something on a deployment connected to the database.",
          "Mode demo tidak memeriksa kata sandi — memilih orang di halaman masuk adalah masuknya. Halaman ini hanya berarti pada deployment yang tersambung ke database.",
        )}
      </p>
    </Card>
  );
}

/* ── live ─────────────────────────────────────────────────────────────── */

type Phase = "checking" | "ready" | "no-session" | "done";

function Form() {
  const router = useRouter();
  const { refresh } = useSession();
  const [phase, setPhase] = useState<Phase>("checking");
  const [linkError, setLinkError] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /* Arrived from an invitation rather than a recovery link: the first
     password, not a replacement for one. */
  const [invited, setInvited] = useState(false);
  const tr = useTr();

  useEffect(() => {
    /* Read before touching the client: GoTrue reports a dead link in the
       fragment (`error_code=otp_expired`), and the client clears the fragment
       as part of handling it. Whatever is there now is the only chance. */
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const failed = hash.get("error_description") ?? hash.get("error");
    if (failed) setLinkError(failed.replace(/\+/g, " "));
    if (hash.get("type") === "invite") setInvited(true);

    const sb = supabaseBrowser();
    let alive = true;

    /* The implicit grant the PKCE client will not read (F182). Out of the
       address bar first, whatever happens next: a live token in history is
       worse than a failed link. */
    const accessToken = hash.get("access_token");
    const refreshToken = hash.get("refresh_token");
    if (accessToken && refreshToken) {
      window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search);
      void sb.auth.setSession({ access_token: accessToken, refresh_token: refreshToken }).then(({ error: e }) => {
        if (!alive) return;
        if (e) { setLinkError(e.message); setPhase("no-session"); }
      });
    }

    /* The session may already be there — somebody changing a password they
       know — or it may be a moment away, still being read out of the URL. Both
       are covered: ask once, and listen. */
    sb.auth.getSession().then(({ data }) => {
      if (!alive) return;
      if (data.session) setPhase("ready");
      /* No session and no event within a beat means there was nothing in the
         URL to read. Long enough for the SDK to finish, short enough that
         nobody sits looking at a spinner. */
      else setTimeout(() => { if (alive) setPhase((p) => (p === "checking" ? "no-session" : p)); }, 1200);
    });

    const { data: sub } = sb.auth.onAuthStateChange((_event, session) => {
      if (alive && session) setPhase("ready");
    });
    return () => { alive = false; sub.subscription.unsubscribe(); };
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== again) { setError(tr("The two entries do not match.", "Dua isian itu tidak sama.")); return; }
    setBusy(true);
    setError(null);

    const res = await identity.setPassword(password);
    setBusy(false);
    if (res.error) { setError(res.error.message); return; }

    setPhase("done");
    /* The shell asked who is signed in when this page first loaded — before
       an invitation's session existed, since that one is set from the
       fragment afterwards (F182). Asked again, or the push below lands on the
       sign-in form with a session in hand. */
    await refresh();
    /* Signed in already — the recovery session is a session. Straight to work
       rather than back to a form that would ask for the password just set. */
    setTimeout(() => router.push("/dashboard"), 1400);
  }

  if (phase === "checking") {
    return (
      <Card className="flex items-center gap-3 px-5 py-6 text-sm text-slate-500">
        <Loader2 className="h-4 w-4 animate-spin" />
        {tr("Checking the link…", "Memeriksa tautan…")}
      </Card>
    );
  }

  if (phase === "no-session") {
    return (
      <Card className="px-5 py-5">
        <div className="flex items-start gap-2 text-[13px] text-rose-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="font-medium">{tr("This link cannot be used.", "Tautan ini tidak bisa dipakai.")}</p>
            <p className="mt-1 text-slate-600">
              {tr(
                "A recovery link works once and expires after one hour. Ask for a new one from the sign-in page, then open it from the same email on this device.",
                "Tautan pemulihan hanya sekali pakai dan kedaluwarsa setelah satu jam. Minta yang baru dari halaman masuk, lalu buka dari email yang sama di perangkat ini.",
              )}
            </p>
            {linkError && (
              <p className="mt-2 font-mono text-[11px] text-slate-400">{linkError}</p>
            )}
          </div>
        </div>
        <Button className="mt-4 w-full" onClick={() => router.push("/signin")}>
          {tr("Back to sign in", "Kembali ke halaman masuk")}
        </Button>
      </Card>
    );
  }

  if (phase === "done") {
    return (
      <Card className="flex items-center gap-3 px-5 py-6 text-sm text-slate-700">
        <CheckCircle2 className="h-5 w-5 text-emerald-600" />
        {tr("Password saved. Redirecting…", "Kata sandi tersimpan. Mengalihkan…")}
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden">
      <div className="border-b border-slate-100 px-5 py-4">
        <h1 className="text-base font-semibold text-slate-800">
          {invited ? tr("Welcome — create your password", "Selamat datang — buat kata sandi Anda") : tr("Create a password", "Buat kata sandi")}
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          {invited
            ? tr("You were invited by IT. Once saved, you are signed in straight away; IT decides which modules you can open.", "Anda diundang oleh IT. Setelah tersimpan, Anda langsung masuk; IT yang menentukan modul apa yang bisa Anda buka.")
            : tr("Once saved, you are signed in straight away. The recovery link is used up.", "Setelah tersimpan, Anda langsung masuk. Tautan pemulihannya hangus.")}
        </p>
      </div>

      <form onSubmit={submit} className="space-y-4 px-5 py-5">
        <div>
          <label htmlFor="pw" className="block text-[13px] font-medium text-slate-700">
            {tr("New password", "Kata sandi baru")}
          </label>
          <input
            id="pw" type="password" value={password} required autoFocus minLength={8}
            autoComplete="new-password"
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800 outline-none transition-colors focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
          />
          <p className="mt-1 text-[11px] text-slate-400">{tr("At least 8 characters.", "Minimal 8 karakter.")}</p>
        </div>

        <div>
          <label htmlFor="pw2" className="block text-[13px] font-medium text-slate-700">
            {tr("Repeat", "Ulangi")}
          </label>
          <input
            id="pw2" type="password" value={again} required minLength={8}
            autoComplete="new-password"
            onChange={(e) => setAgain(e.target.value)}
            className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800 outline-none transition-colors focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
          />
        </div>

        {error && (
          <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50/70 px-3 py-2.5 text-[13px] text-rose-900">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <Button
          type="submit" icon={KeyRound} className="w-full"
          disabled={busy || password.length < 8 || again.length < 8}
        >
          {busy ? tr("Saving…", "Menyimpan…") : tr("Save password", "Simpan kata sandi")}
        </Button>
      </form>
    </Card>
  );
}
