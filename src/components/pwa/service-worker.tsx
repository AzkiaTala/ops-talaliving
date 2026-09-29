"use client";

import { useEffect } from "react";
import { useToast } from "@/store/toast";
import { trNow as tr } from "@/lib/i18n";
import { listenForInstallPrompt } from "@/lib/pwa";

/** Registers `public/sw.js` and says when a newer build is waiting (D328).
 *
 *  Mounted once, in the root layout, so it runs on every page including
 *  sign-in. Production builds only: under `next dev` a worker holding cached
 *  chunks is how an edit stops showing up and an afternoon disappears.
 *
 *  The worker never switches by itself. A new build installs, waits, and this
 *  offers a reload; the reload tells the worker to take over, and every open
 *  tab reloads once it has, so no tab is left running code whose chunks the
 *  new cache no longer holds. Any client-held copy must know when it is stale
 *  (F24) — this is that, for the app itself.
 */
export function ServiceWorker() {
  const { toast } = useToast();

  useEffect(() => {
    listenForInstallPrompt();
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;

    const sw = navigator.serviceWorker;
    /* Only a worker REPLACING another is news. The very first install takes
       control of a page that had none, and reloading for that would be a
       reload for nothing. */
    const hadController = Boolean(sw.controller);
    let reloading = false;
    let offered = false;

    const onControllerChange = () => {
      if (!hadController || reloading) return;
      reloading = true;
      window.location.reload();
    };
    sw.addEventListener("controllerchange", onControllerChange);

    const offer = (waiting: ServiceWorker) => {
      if (offered || !sw.controller) return;
      offered = true;
      toast(
        "info",
        tr("A new version is available", "Versi baru tersedia"),
        tr("Reload to use it. Nothing you have saved is lost.", "Muat ulang untuk memakainya. Yang sudah tersimpan tidak hilang."),
        {
          label: tr("Reload", "Muat ulang"),
          onClick: () => waiting.postMessage({ type: "SKIP_WAITING" }),
        },
      );
    };

    let registration: ServiceWorkerRegistration | undefined;
    const check = () => {
      if (document.visibilityState === "visible") void registration?.update().catch(() => {});
    };

    sw.register("/sw.js", { scope: "/", updateViaCache: "none" })
      .then((reg) => {
        registration = reg;
        if (reg.waiting) offer(reg.waiting);
        reg.addEventListener("updatefound", () => {
          const next = reg.installing;
          next?.addEventListener("statechange", () => {
            if (next.state === "installed") offer(next);
          });
        });
      })
      .catch(() => {
        /* No worker is a browser without the offline page, not a broken app. */
      });

    /* A phone keeps an installed app in memory for days. Coming back to it is
       when a new build matters, so that is when to ask; hourly covers a
       screen left open on a desk. */
    document.addEventListener("visibilitychange", check);
    const hourly = window.setInterval(check, 60 * 60 * 1000);
    return () => {
      sw.removeEventListener("controllerchange", onControllerChange);
      document.removeEventListener("visibilitychange", check);
      window.clearInterval(hourly);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
