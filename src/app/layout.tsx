import type { Metadata, Viewport } from "next";
import "./globals.css";
import { SessionProvider } from "@/store/session";
import { ToastProvider } from "@/store/toast";
import { Toaster } from "@/components/ui/toaster";
import { BRAND } from "@/lib/brand";
import { DemoProvider } from "@/demo/provider";
import { LangHydrated } from "@/components/lang-hydrated";
import { ServiceWorker } from "@/components/pwa/service-worker";

export const metadata: Metadata = {
  title: BRAND.documentTitle,
  description: "PT Talahome — internal operations.",
  applicationName: BRAND.documentTitle,
  /* Installable on a phone (D328). The manifest itself is
     `src/app/manifest.ts`; Next links it. iOS reads none of it and wants these. */
  appleWebApp: {
    capable: true,
    title: "Talaliving",
    statusBarStyle: "default",
  },
  icons: {
    icon: [{ url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
};

export const viewport: Viewport = {
  themeColor: "#2f6b52",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <LangHydrated />
        <DemoProvider>
          <SessionProvider>
            <ToastProvider>
              {children}
              <Toaster />
              <ServiceWorker />
            </ToastProvider>
          </SessionProvider>
        </DemoProvider>
      </body>
    </html>
  );
}
