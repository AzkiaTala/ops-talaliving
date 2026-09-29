import type { MetadataRoute } from "next";
import { BRAND } from "@/lib/brand";

/** What a phone needs to put this app on its home screen (D328).
 *
 *  Served by Next at `/manifest.webmanifest` and linked from every page by the
 *  root layout. `start_url` is the root, which redirects to wherever the
 *  account belongs; the root decides that, not the manifest, so an employee
 *  account can land somewhere else without a second installed app.
 *
 *  The colours are the brand green the viewport already uses (`themeColor` in
 *  `src/app/layout.tsx`, `brand-700`). The icons are rendered by
 *  `scripts/make-pwa-icons.mjs`. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: BRAND.documentTitle,
    short_name: "Talaliving",
    description: "PT Talahome — internal operations.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    theme_color: "#2f6b52",
    background_color: "#2f6b52",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
