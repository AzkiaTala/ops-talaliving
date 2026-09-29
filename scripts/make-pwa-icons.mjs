#!/usr/bin/env node
/** Render the home-screen icons under `public/icons/` (D328).
 *
 *  The mark is the sidebar's: lucide `Factory`, white, on the brand green
 *  (`brand-700`, the same `#2f6b52` as `themeColor`). The paths are read out of
 *  the installed `lucide-react` rather than copied here, so the icon and the
 *  sidebar cannot drift apart.
 *
 *  Three shapes, because a phone uses them differently:
 *
 *    icon-192.png, icon-512.png   `any` — a rounded tile on transparent
 *                                 corners, used where the OS draws it as is.
 *    icon-maskable-512.png        `maskable` — full bleed, the glyph inside the
 *                                 central 80% safe zone, because Android crops
 *                                 it to a circle or a squircle of its choosing.
 *    apple-touch-icon.png (180)   full bleed and opaque — iOS rounds the
 *                                 corners itself and paints transparency black.
 *
 *  The PNGs are committed. This is run by hand when the brand changes, never by
 *  the build, and it adds no dependency: `playwright-core` is resolved from
 *  NODE_PATH like the e2e harness (`scripts/e2e/harness.mjs`).
 *
 *    NODE_PATH=$(npm root -g) node scripts/make-pwa-icons.mjs
 */

import { createRequire } from "node:module";
import { mkdirSync, readFileSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), "..");
const OUT = join(ROOT, "public/icons");
const require = createRequire(process.env.NODE_PATH ? process.env.NODE_PATH + "/" : import.meta.url);
let chromium;
try {
  ({ chromium } = require("playwright-core"));
} catch {
  ({ chromium } = require("playwright"));
}

const GREEN = "#2f6b52";

/* The `d` attributes of lucide's Factory, in order. */
const lucide = readFileSync(join(ROOT, "node_modules/lucide-react/dist/esm/icons/factory.js"), "utf8");
const paths = [...lucide.matchAll(/d: "([^"]+)"/g)].map((m) => m[1]);
if (paths.length === 0) throw new Error("no paths found in lucide-react's factory.js");

/** An SVG of `size` px. `glyph` is the share of the side the 24-unit glyph
 *  occupies; `radius` the tile's corner radius as a share of the side (0 =
 *  full bleed). */
function svg(size, { glyph, radius }) {
  const g = size * glyph;
  const offset = (size - g) / 2;
  const scale = g / 24;
  const r = size * radius;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${r}" ry="${r}" fill="${GREEN}"/>
  <g transform="translate(${offset} ${offset}) scale(${scale})" fill="none" stroke="#ffffff"
     stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
    ${paths.map((d) => `<path d="${d}"/>`).join("\n    ")}
  </g>
</svg>`;
}

const ICONS = [
  { file: "icon-192.png", size: 192, glyph: 0.56, radius: 0.22 },
  { file: "icon-512.png", size: 512, glyph: 0.56, radius: 0.22 },
  /* 0.5 keeps the glyph's corners inside the 80% circle Android may cut. */
  { file: "icon-maskable-512.png", size: 512, glyph: 0.5, radius: 0 },
  { file: "apple-touch-icon.png", size: 180, glyph: 0.56, radius: 0 },
];

const executablePath = existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined;
const browser = await chromium.launch(executablePath ? { executablePath } : {});
try {
  mkdirSync(OUT, { recursive: true });
  for (const icon of ICONS) {
    const page = await browser.newPage({ viewport: { width: icon.size, height: icon.size } });
    await page.setContent(
      `<!doctype html><html><body style="margin:0;background:transparent">${svg(icon.size, icon)}</body></html>`,
    );
    await page.locator("svg").screenshot({ path: join(OUT, icon.file), omitBackground: true });
    await page.close();
    console.log(`public/icons/${icon.file}  ${icon.size}×${icon.size}`);
  }
} finally {
  await browser.close();
}
