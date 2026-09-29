import "server-only";

/** The server client — a new one per request, never a module-level singleton.
 *
 *  A cached server client would carry one user's session into the next user's
 *  request, and on a server that renders for everybody that is not a subtle bug:
 *  it is the payroll screen showing somebody else's figures. So this is a
 *  function, it is called per request, and the cookie store is passed in rather
 *  than reached for.
 */
import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient, type GoTrueAdminApi } from "@supabase/supabase-js";
import { publicConfig, serviceRoleKey } from "./env";

/** Minimal shape of Next's cookie store — enough to avoid importing
 *  `next/headers` here, which would tie this file to one rendering context and
 *  make it unusable from a route handler and from middleware alike. */
export interface CookieStore {
  get(name: string): { value: string } | undefined;
  set?(options: { name: string; value: string; [k: string]: unknown }): void;
}

/** Acts as the signed-in user: every policy applies. This is what answers a
 *  request somebody made. */
export function supabaseServer(cookies: CookieStore): SupabaseClient {
  const { url, anonKey } = publicConfig();
  return createServerClient(url, anonKey, {
    cookies: {
      getAll: () => [],
      setAll: () => {},
      get: (name: string) => cookies.get(name)?.value,
      set: (name: string, value: string, options: Record<string, unknown>) => {
        /* A Server Component cannot write cookies; Next throws if it tries.
           Refreshing the token there is a best-effort convenience, and failing
           to persist it is not an error — the next route handler will do it. */
        try { cookies.set?.({ name, value, ...options }); } catch { /* read-only context */ }
      },
      remove: (name: string, options: Record<string, unknown>) => {
        try { cookies.set?.({ name, value: "", ...options }); } catch { /* read-only context */ }
      },
    } as never,
  });
}

/** Bypasses every row-level policy. **System work only** — the outbox delivery
 *  loop, a scheduled import — and never inside a request a user triggered
 *  (ADR-002). Using it to answer a user is how the database stops being the
 *  thing that decides who may see what, while every screen still looks right.
 */
export function supabaseAdmin(): SupabaseClient {
  const { url } = publicConfig();
  return createClient(url, serviceRoleKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** GoTrue's admin API, and **only** that — the one use of the service role
 *  key inside a request somebody made (D325).
 *
 *  Creating an account, re-sending an invitation and blocking a sign-in are
 *  things only GoTrue can do, and GoTrue only lets the service role ask. So
 *  `/api/identity/users` needs the key — but it must never become the thing
 *  that decides, or ADR-002 is a comment. Two rules make that structural
 *  rather than a matter of care:
 *
 *  - the route asks the database first, **as the person**, through a seam
 *    that checks `it.manage_users` and writes the trail; it calls this only
 *    on that seam's yes, and only for the account the seam named;
 *  - this returns `auth.admin`, not a client. There is no `.from()` on it, so
 *    the key cannot read or write a table even by mistake — which is the
 *    mistake `supabaseAdmin()` above would allow.
 */
export function authAdmin(): GoTrueAdminApi {
  const { url } = publicConfig();
  return createClient(url, serviceRoleKey(), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  }).auth.admin;
}

/** Whether `authAdmin()` can work on this deployment. Asked before anything
 *  is decided, so an unconfigured Worker says so in a sentence instead of
 *  after the database has recorded an invitation nobody could send. */
export function authAdminConfigured(): boolean {
  return Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);
}
