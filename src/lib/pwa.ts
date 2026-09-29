/** Whether this browser can install the app, and how (D328).
 *
 *  Chrome on Android fires `beforeinstallprompt` once, early, whether or not
 *  anything is listening. The button that uses it is mounted much later — after
 *  sign-in, inside the topbar, or on `/saya` — so the event is caught here, by
 *  `<ServiceWorker />` in the root layout, and kept until a button asks for it.
 *
 *  Safari on iOS has no such event and no way to install from a page: the
 *  only road is Share → Add to Home Screen, so the button explains that
 *  instead. Anywhere else (desktop Firefox, an in-app browser) there is nothing
 *  to offer, and nothing is shown.
 */
import { useSyncExternalStore } from "react";

/** Not in the DOM typings. Chrome's shape, trimmed to what is used. */
interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export type InstallState =
  /** Already running as an installed app, or no road to install: show nothing. */
  | "none"
  /** Chrome/Android: one tap opens the browser's own install dialog. */
  | "prompt"
  /** iOS Safari: explain Share → Add to Home Screen. */
  | "ios";

let deferred: InstallPromptEvent | null = null;
let installed = false;
let listening = false;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

function isStandalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches
    || (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function isIos(): boolean {
  const ua = navigator.userAgent;
  /* iPadOS reports itself as a Mac; a touch screen gives it away. */
  return /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

/** Called once from the root layout. Idempotent. */
export function listenForInstallPrompt() {
  if (listening || typeof window === "undefined") return;
  listening = true;
  window.addEventListener("beforeinstallprompt", (e) => {
    /* Keep the browser's own mini-infobar from appearing: the quiet button is
       the only offer this app makes (never nag). */
    e.preventDefault();
    deferred = e as InstallPromptEvent;
    notify();
  });
  window.addEventListener("appinstalled", () => {
    installed = true;
    deferred = null;
    notify();
  });
  window.matchMedia("(display-mode: standalone)").addEventListener("change", notify);
}

function snapshot(): InstallState {
  if (installed || isStandalone()) return "none";
  if (deferred) return "prompt";
  if (isIos()) return "ios";
  return "none";
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useInstallState(): InstallState {
  return useSyncExternalStore(subscribe, snapshot, () => "none");
}

/** Opens Chrome's install dialog. The event can be used once; after either
 *  answer it is gone, and Chrome fires a fresh one later if it still applies. */
export async function promptInstall(): Promise<boolean> {
  const e = deferred;
  if (!e) return false;
  deferred = null;
  notify();
  await e.prompt();
  const { outcome } = await e.userChoice;
  return outcome === "accepted";
}

/* As soon as this module is on the page — before hydration, which can be
   later than Chrome's event. */
if (typeof window !== "undefined") listenForInstallPrompt();
