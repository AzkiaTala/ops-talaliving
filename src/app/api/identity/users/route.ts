import { cookies } from "next/headers";
import { createClient } from "@supabase/supabase-js";
import { supabaseServer, authAdmin, authAdminConfigured } from "@/lib/supabase/server";
import { publicConfig } from "@/lib/supabase/env";
import { fromSeam, ok, noop, type Result } from "@/lib/api/_kit";
import type { UserLinkSent, UserActiveChange } from "@/services/identity/contracts";

/** `POST /api/identity/users` — the part of managing people only GoTrue can do
 *  (D325).
 *
 *  ## Why a server route
 *
 *  Everything else on `/it/pengguna` is a seam called from the browser, and
 *  so is most of this. Three acts are not, because they happen in GoTrue's
 *  half of a person rather than ours: **creating an account** (an
 *  invitation), **re-sending an invitation**, and **blocking a sign-in**. GoTrue
 *  lets only the service role key ask for those, and that key must never
 *  reach a browser.
 *
 *  ## Who decides
 *
 *  Not this route. Each action is **first put to the database as the person
 *  asking**, from their session cookie — `invite_user`, `request_user_link`,
 *  `set_user_active` — and those seams check `it.manage_users`, refuse what is
 *  not allowed, and write the trail. The route acts on GoTrue only after a
 *  yes, and only for the address or account the seam named. The key reaches
 *  GoTrue's admin API and nothing else (`authAdmin()` has no `.from()`), so it
 *  cannot read or write a table even by mistake.
 *
 *  It is the upload route's arrangement with a different outside system: the
 *  database is written as the person, the outside system as the service.
 *
 *  ## Why the links land where they do
 *
 *  Every link this route causes points at `/set-password` on the origin the
 *  request came from, so preview and production each send their own. GoTrue
 *  sends these as an **implicit** grant — the session in the `#fragment` —
 *  because the browser that asked (IT's) is not the browser that will open it
 *  (the new person's), and PKCE cannot span two browsers. `/set-password`
 *  reads that fragment itself, because the application's own client is PKCE
 *  and refuses it (F182).
 */

type Body =
  | { action: "invite"; email?: unknown; full_name?: unknown }
  | { action: "link"; user_id?: unknown }
  | { action: "set_active"; user_id?: unknown; active?: unknown; reason?: unknown };

const SERVICE = "identity" as const;

function answer<T>(res: Result<T>): Response {
  return Response.json(res, { status: res.error ? res.error.status : 200 });
}

function refuse(status: number, code: string, message: string, detail?: Record<string, unknown>): Response {
  return Response.json(
    { error: { code, message, outcome: "refused", status, detail },
      meta: { request_id: "", service: SERVICE, version: "1", outcome: "refused" } },
    { status },
  );
}

const NOT_CONFIGURED =
  "Deployment ini belum bisa membuat akun atau memblokir masuk: SUPABASE_SERVICE_ROLE_KEY "
  + "belum diset di Worker. IT menyetelnya sebagai Secret di Cloudflare → Workers → "
  + "ops-talaliving → Settings → Variables and Secrets.";

/** GoTrue's refusal, said so IT can act on it. Its own message goes in
 *  `detail` — it is the one that names the rule — and the sentence on top
 *  says what to do. */
function fromGoTrue(e: { status?: number; code?: string; message: string }): Response {
  const detail = { gotrue: { status: e.status ?? null, code: e.code ?? null, message: e.message } };
  if (e.status === 429 || e.code === "over_email_send_rate_limit") {
    return refuse(429, "mail_rate_limited",
      "Batas kirim email Supabase tercapai. Tunggu sebentar, atau pasang SMTP sendiri "
      + "(Authentication → Emails → SMTP) supaya undangan tidak dibatasi.", detail);
  }
  if (e.code === "email_exists" || e.code === "user_already_exists") {
    return refuse(409, "already_registered",
      "Alamat ini sudah terdaftar dan sudah dikonfirmasi — kirim tautan atur kata sandi saja.", detail);
  }
  return refuse(502, "gotrue_refused",
    `Supabase Auth menolak permintaan ini: ${e.message}`, detail);
}

function asId(v: unknown): string | null {
  return typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v) ? v : null;
}

export async function POST(request: Request): Promise<Response> {
  const sb = supabaseServer(await cookies());
  const { data: auth } = await sb.auth.getSession();
  if (!auth.session) return refuse(401, "not_signed_in", "Please sign in first.");

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return refuse(400, "bad_request", "Expected a JSON body.");
  }

  const db = sb.schema("ops_core");
  const redirectTo = `${new URL(request.url).origin}/set-password`;

  switch (body?.action) {
    /* ── a new account ─────────────────────────────────────────────────── */
    case "invite": {
      /* Asked before the database is: an invitation recorded as decided and
         then never sent is a trail that says something that did not happen. */
      if (!authAdminConfigured()) return refuse(501, "auth_admin_not_configured", NOT_CONFIGURED);

      const { data, error } = await db.rpc("invite_user", {
        p_email: typeof body.email === "string" ? body.email : "",
        p_full_name: typeof body.full_name === "string" ? body.full_name : "",
      });
      const decided = fromSeam<{ email: string; full_name: string }>(SERVICE, data, error);
      if (decided.error) return answer(decided);

      const { email, full_name } = decided.data;
      const sent = await authAdmin().inviteUserByEmail(email, { data: { full_name }, redirectTo });
      if (sent.error) return fromGoTrue(sent.error);

      return answer(ok<UserLinkSent>(SERVICE, {
        user_id: sent.data.user.id, email, kind: "invite",
      }));
    }

    /* ── a link for somebody who already has an account ────────────────── */
    case "link": {
      const userId = asId(body.user_id);
      if (!userId) return refuse(422, "user_required", "Say whose account.", { field: "user_id" });

      const { data, error } = await db.rpc("request_user_link", { p_user_id: userId });
      const decided = fromSeam<{ email: string; kind: "invite" | "recovery" }>(SERVICE, data, error);
      if (decided.error) return answer(decided);
      const { email, kind } = decided.data;

      if (kind === "invite") {
        if (!authAdminConfigured()) return refuse(501, "auth_admin_not_configured", NOT_CONFIGURED);
        const sent = await authAdmin().inviteUserByEmail(email, { redirectTo });
        if (sent.error) return fromGoTrue(sent.error);
      } else {
        /* A recovery link needs no key at all — it is what *lupa kata sandi*
           on the sign-in page asks for. It is asked here, with a client of its
           own, for one reason: that client is **implicit**. The browser's
           client is PKCE, and a PKCE link opens only in the browser that
           asked for it — IT's, not the person's. */
        const { url, anonKey } = publicConfig();
        const pub = createClient(url, anonKey, {
          auth: { flowType: "implicit", persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
        });
        const sent = await pub.auth.resetPasswordForEmail(email, { redirectTo });
        if (sent.error) return fromGoTrue(sent.error);
      }

      return answer(ok<UserLinkSent>(SERVICE, { user_id: userId, email, kind }));
    }

    /* ── switching an account off, or back on ──────────────────────────── */
    case "set_active": {
      const userId = asId(body.user_id);
      if (!userId) return refuse(422, "user_required", "Say whose account.", { field: "user_id" });
      if (typeof body.active !== "boolean") {
        return refuse(422, "active_required", "Say whether the account is to be switched on or off.",
          { field: "active" });
      }
      const active = body.active;

      /* The database first, always — even with no key. Switching an account
         off here is what takes its access away (`has_permission` reads
         `is_active`); GoTrue's ban only stops the sign-in on top of it, so a
         deployment without the key still gets the part that matters. */
      const { data, error } = await db.rpc("set_user_active", {
        p_user_id: userId, p_active: active,
        p_reason: typeof body.reason === "string" ? body.reason : null,
      });
      const decided = fromSeam<unknown>(SERVICE, data, error);
      if (decided.error) return answer(decided);

      /* On a noop too: pressing *nonaktifkan* again on an account that is off
         but still able to sign in — the key was missing the first time — is
         how the block gets applied afterwards. */
      let signIn: UserActiveChange["sign_in"] = "not_configured";
      let detail: string | null = null;
      if (authAdminConfigured()) {
        const res = await authAdmin().updateUserById(userId, {
          /* A century, which is how GoTrue spells *until somebody lifts it*. */
          ban_duration: active ? "none" : "876000h",
        });
        if (res.error) { signIn = "failed"; detail = res.error.message; }
        else signIn = active ? "allowed" : "blocked";
      }

      const change: UserActiveChange = { user_id: userId, is_active: active, sign_in: signIn, sign_in_detail: detail };
      return answer(decided.meta.outcome === "noop" ? noop(SERVICE, change) : ok(SERVICE, change));
    }

    default:
      return refuse(400, "unknown_action", "Expected action invite, link or set_active.");
  }
}
