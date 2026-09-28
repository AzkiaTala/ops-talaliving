import type { Metadata, Viewport } from "next";
import "./globals.css";
import { SessionProvider } from "@/store/session";
import { ToastProvider } from "@/store/toast";
import { Toaster } from "@/components/ui/toaster";
import { BRAND } from "@/lib/brand";
import { DemoProvider } from "@/demo/provider";
import { LangHydrated } from "@/components/lang-hydrated";

export const metadata: Metadata = {
  title: BRAND.documentTitle,
  description: "PT Talahome — internal operations.",
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
            </ToastProvider>
          </SessionProvider>
        </DemoProvider>
      </body>
    </html>
  );
}
