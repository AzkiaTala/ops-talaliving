/* The service worker (D328).
 *
 * It exists for two things only: an installed app that opens at all, and a
 * page that says so plainly when there is no connection. It is not an offline
 * mode. Attendance, a payslip and every record in this app live on the server,
 * and a copy of any of them held here would be a copy that goes stale without
 * knowing it (F24). So:
 *
 *   /_next/static/*, /icons/*   cache first. Content-hashed or versioned by
 *                               hand, so a cached copy can never be wrong.
 *   navigations                 network first. Nothing is stored; with no
 *                               network the answer is /offline.html.
 *   everything else             not touched: no respondWith, the browser does
 *                               what it would without a worker. That covers
 *                               Supabase (another origin), /api/*, and every
 *                               request that is not a GET.
 *
 * The cache is named after the build (`sw-version.js`, written by
 * next.config.mjs). A new build changes that file, the browser installs a new
 * worker, and it WAITS: the page shows "a new version is available" and the
 * person reloads when they are ready (src/components/pwa/service-worker.tsx).
 * Switching under somebody half way through a form is worse than being a
 * version behind for a minute. On activation every cache from another build is
 * deleted.
 *
 * Served with `Cache-Control: no-cache` (public/_headers), and registered with
 * `updateViaCache: "none"`, so an update check always reaches the server.
 */

importScripts("/sw-version.js");

const BUILD = self.OPS_BUILD_ID || "dev";
const PREFIX = "ops-";
const STATIC_CACHE = `${PREFIX}static-${BUILD}`;
const OFFLINE_URL = "/offline.html";

/* Stored as a fresh Response rather than with `cache.add`: Cloudflare's asset
   server answers `/offline.html` with a redirect to `/offline`, and a browser
   refuses to hand a navigation a response that was redirected. Re-wrapping the
   body drops that flag, and works the same on a host that does not redirect. */
async function precache() {
  const cache = await caches.open(STATIC_CACHE);
  const offline = await fetch(OFFLINE_URL, { cache: "no-cache" });
  if (!offline.ok) throw new Error(`offline page: ${offline.status}`);
  await cache.put(
    OFFLINE_URL,
    new Response(await offline.blob(), { headers: { "Content-Type": "text/html; charset=utf-8" } }),
  );
  await cache.add("/icons/icon-192.png");
}

self.addEventListener("install", (event) => {
  event.waitUntil(precache());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names.filter((n) => n.startsWith(PREFIX) && n !== STATIC_CACHE).map((n) => caches.delete(n)),
      );
      await self.clients.claim();
    })(),
  );
});

/* Only on the person's say-so, from the "new version" toast. */
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(async () => {
        const cache = await caches.open(STATIC_CACHE);
        return (await cache.match(OFFLINE_URL)) || Response.error();
      }),
    );
    return;
  }

  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/")) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(STATIC_CACHE);
        const hit = await cache.match(request);
        if (hit) return hit;
        const response = await fetch(request);
        if (response.ok) cache.put(request, response.clone());
        return response;
      })(),
    );
  }
});
