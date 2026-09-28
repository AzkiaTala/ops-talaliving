/** Two languages, and an honest boundary between what is translated and what
 *  is not.
 *
 *  ## What was actually wrong
 *
 *  The app was not English. It was not Indonesian either. The menu said
 *  *Payroll* and *Delivery*, the page beside it said *Serah terima* and
 *  *Berkas 201*, and the helper text under both was Indonesian prose. That is
 *  the worst of the three states: a reader of either language hits the other
 *  one every few lines, and neither can tell whether a word is a translation
 *  or a term of art (F66).
 *
 *  ## What is translated, and what is not
 *
 *  **Translated**: the shell — every menu label, the topbar, the shared words
 *  the whole app is navigated by — and **all of John Lau**, including his
 *  guidance, his refusals and the reasons behind them.
 *
 *  **Translated since D317**: the bodies of the screens too — every heading,
 *  label, button, help line, empty state and toast, through `useTr()`.
 *  Content that comes out of the database (names, remarks, a vendor's own
 *  words, setting labels) is shown as stored.
 *
 *  **Never translated**: the business's own vocabulary. `MSG SENT`, `SP NORTH`,
 *  `PKWT`, `kubikasi`, account codes, status strings. Those are not English or
 *  Indonesian words, they are the names of things, and translating a name is
 *  how two systems stop agreeing (D224).
 *
 *  The settings row says all of this in place of implying full coverage,
 *  because a language switch that changes a third of the screen and claims to
 *  change the language is the same shape of lie as a figure that looks
 *  computed and was typed.
 */
import { useSyncExternalStore } from "react";

export type Lang = "en" | "id";

export const LANGS: { code: Lang; label: string }[] = [
  { code: "en", label: "English" },
  { code: "id", label: "Bahasa Indonesia" },
];

export const DEFAULT_LANG: Lang = "en";

/** Two strings, always both. A message with only one language is a message
 *  that silently falls back, and a silent fallback is how half a screen stays
 *  in the wrong language for a year without anybody filing it. */
export type Message = { en: string; id: string };

export function pick(m: Message, lang: Lang): string {
  return m[lang];
}

/** The language is a **viewer's** choice, not the company's (D317).
 *
 *  It used to be one row in `app_settings`, which made the language of every
 *  screen a company-wide setting: one person switching to Indonesian switched
 *  it for everybody. What language somebody reads in is about the reader, so
 *  it lives in this browser — the toggle in the topbar — and the setting row is
 *  only the default for a browser that has never chosen.
 *
 *  The server render always sees the default; the client swaps in the stored
 *  choice after hydration (`useSyncExternalStore` with a server snapshot), so
 *  the markup never mismatches.
 */
const STORAGE_KEY = "ops.lang";
let settingLang: Lang = DEFAULT_LANG;
let chosenLang: Lang | null = null;
let loaded = false;
const listeners = new Set<() => void>();

function readChoice(): Lang | null {
  if (!loaded && typeof window !== "undefined") {
    loaded = true;
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      chosenLang = raw === "id" || raw === "en" ? raw : null;
    } catch {
      chosenLang = null;
    }
  }
  return chosenLang;
}

/** The language in force, for code that is not a component.
 *
 *  The service clients answer into a panel — a refusal, a guide, a sentence
 *  about what was understood — and D224 puts that resolution at the service
 *  edge rather than in the screen, so they need the answer without a render.
 */
export function getActiveLang(): Lang {
  return readChoice() ?? settingLang;
}

/** The setting's default, pushed in by the store (D216). A viewer's own choice
 *  wins over it. */
export function setActiveLang(lang: string | undefined) {
  const next: Lang = lang === "id" ? "id" : "en";
  if (next === settingLang) return;
  settingLang = next;
  for (const l of listeners) l();
}

/** The topbar toggle. Remembered in this browser only. */
export function setLang(lang: Lang) {
  chosenLang = lang;
  loaded = true;
  try {
    window.localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    /* private window: the choice holds until the tab closes */
  }
  for (const l of listeners) l();
}

function subscribeLang(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The language in force, for a component. Re-renders when it changes. */
export function useLang(): Lang {
  return useSyncExternalStore(subscribeLang, getActiveLang, () => DEFAULT_LANG);
}

/** `t(MESSAGES.nav.dashboard)` — a lookup that cannot miss, because the
 *  catalogue is typed and every entry carries both languages. */
export function useT(): (m: Message) => string {
  const lang = useLang();
  return (m: Message) => m[lang];
}

/** `tr("Saved", "Tersimpan")` — both languages at the place the words are
 *  used. This is what the screen bodies use: a screen's copy belongs to that
 *  screen, and a shared catalogue of four thousand one-off sentences would be
 *  a file nobody can read. Always both — English first, Indonesian second. */
export type Tr = (en: string, id: string) => string;

export function useTr(): Tr {
  const lang = useLang();
  return lang === "id" ? (_en, id) => id : (en) => en;
}

/** `tr` for code outside a render — a toast raised in a callback that was
 *  built before the language changed, a label map at module level. Prefer
 *  `useTr` inside components so the screen re-renders on a switch. */
export const trNow: Tr = (en, id) => (getActiveLang() === "id" ? id : en);

/** A label map that answers in the language in force.
 *
 *  The service contracts hold the display names of stored codes
 *  (`MOVE_LABEL.issue`, `LEAVE_KIND_LABEL.sick`, …) and every screen reads them
 *  as a plain `Record<K, string>`. This keeps that shape — each value is a
 *  getter that reads the active language — so no screen has to change how it
 *  looks a label up, and a screen re-renders on a switch because it already
 *  calls `useTr()`. The **key** is the stored code and never changes; only
 *  the word shown for it does.
 *
 *  Not for anything that is written anywhere: a label read here is a display
 *  string, and saving one would store whichever language the writer had on.
 */
export function bilingual<K extends string>(map: Record<K, Message>): Record<K, string> {
  const out = {} as Record<K, string>;
  for (const k of Object.keys(map) as K[]) {
    Object.defineProperty(out, k, {
      enumerable: true,
      get: () => map[k][getActiveLang()],
    });
  }
  return out;
}
