/** A password IT reads out or writes on a slip of paper (D329).
 *
 *  Two groups of five around a hyphen — `Kx7mP-q4rTz` — so it can be read
 *  back in two breaths. No character that looks like another: no `0`/`O`,
 *  no `1`/`l`/`I`. Always an upper-case letter, a lower-case letter, a digit
 *  and the hyphen, so it passes GoTrue's strictest *password requirements*
 *  setting whichever one the project has.
 *
 *  Web Crypto, so the same function runs in the Worker and in the demo. The
 *  random pick is by rejection, not `% length`, so no character is likelier
 *  than another. */
const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const LOWER = "abcdefghijkmnpqrstuvwxyz";
const DIGIT = "23456789";
const ALL = UPPER + LOWER + DIGIT;

function pick(from: string): string {
  const limit = 256 - (256 % from.length);
  const buf = new Uint8Array(1);
  for (;;) {
    crypto.getRandomValues(buf);
    if (buf[0] < limit) return from[buf[0] % from.length];
  }
}

export function generatePassword(): string {
  for (;;) {
    const chars = Array.from({ length: 10 }, () => pick(ALL));
    const s = chars.join("");
    if (/[A-Z]/.test(s) && /[a-z]/.test(s) && /[2-9]/.test(s)) {
      return `${s.slice(0, 5)}-${s.slice(5)}`;
    }
  }
}
