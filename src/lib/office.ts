/** The office day — ONE place.
 *
 *  The workshop's day is not UTC's. A scan at 23:10 WIB belongs to that
 *  evening's shift, and a UTC-based `toISOString().slice(0, 10)` files it under
 *  tomorrow — which is how a Friday's overtime lands on Saturday's payslip
 *  (F17, F39).
 *
 *  This constant existed **nine times**, copied into every file that needed a
 *  date (F63). Nine copies of a number is nine chances to disagree, and the
 *  disagreement would not be a crash: it would be one module thinking a scan
 *  happened on a different day from another module, which is the exact class
 *  of bug that takes a week to find. It is one file now, and the settings
 *  screen can point at it honestly.
 *
 *  It is **not editable from the settings screen** and the screen says why:
 *  changing it does not change what happens next, it changes which day every
 *  scan, every payslip and every daily recap already in the system belongs to.
 *  A business that genuinely moves time zone needs a migration, not a dropdown.
 *  And it did, once: WITA → WIB on 2026-09-29 (D334), because the fingerprint
 *  machine had always written WIB and every import had read it as WITA. That
 *  took this file, `ops_core.office_tz()` and migration `0190`, which moved the
 *  stored machine taps by the hour they had been misread (F191).
 */
export const OFFICE_TZ = {
  /** WIB, UTC+7 (D334). No daylight saving in Indonesia, so a fixed offset is
   *  the zone, not an approximation of it. */
  offset_hours: 7,
  /** The offset as an ISO-8601 suffix, for a wall-clock time typed or printed
   *  on the office clock. Use `officeStamp()`, not this, to build one. */
  iso: "+07:00",
  /** What a time on screen is suffixed with, e.g. *Pukul 07:25 WIB*. */
  short: "WIB",
  label: "WIB (UTC+7)",
  /** The same zone as the database names it: `ops_core.office_tz()`. */
  iana: "Asia/Jakarta",
} as const;

const OFFSET_MS = OFFICE_TZ.offset_hours * 3_600_000;

/** The office day a moment belongs to, as `YYYY-MM-DD`. */
export function officeDay(at: Date | number = Date.now()): string {
  const ms = typeof at === "number" ? at : at.getTime();
  return new Date(ms + OFFSET_MS).toISOString().slice(0, 10);
}

/** Today, in the office's own reckoning. */
export function officeToday(): string {
  return officeDay(Date.now());
}

/** A moment as `HH:MM` on the office clock.
 *
 *  Not the browser's clock, deliberately. Every date on every screen here is
 *  reckoned in the office zone, so a time rendered in the reader's own zone would disagree
 *  with the row above it the moment anybody opens the app from anywhere else —
 *  and the disagreement would be a quiet hour or two, which is exactly the kind
 *  nobody notices until a cut-off is missed.
 */
export function officeClock(at: Date | number = Date.now()): string {
  const ms = typeof at === "number" ? at : at.getTime();
  return new Date(ms + OFFSET_MS).toISOString().slice(11, 16);
}

/** A wall-clock time on the office clock as an ISO stamp:
 *  `officeStamp("2026-09-29", "07:25")` → `2026-09-29T07:25:00+07:00`.
 *
 *  A day and a clock time somebody typed, or a machine printed, name a moment
 *  only once a zone is attached, and the zone is this file's to decide — never
 *  a `+08` written into the string at the call site, which is how the office
 *  clock came to live in fourteen places (F63, F191). */
export function officeStamp(day: string, time = "00:00"): string {
  const t = time.length === 5 ? `${time}:00` : time;
  return `${day}T${t}${OFFICE_TZ.iso}`;
}

/** A `YYYY-MM-DD` key moved by whole days. UTC arithmetic on the string,
 *  because the office day is not the browser's day (F17). */
export function shiftDay(key: string, days: number): string {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) + days * 86_400_000).toISOString().slice(0, 10);
}

/** Monday of the week a `YYYY-MM-DD` key falls in. */
export function mondayOf(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  const js = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return shiftDay(key, -((js === 0 ? 7 : js) - 1));
}
