"use client";

import { useEffect } from "react";
import { markLangHydrated, useLang } from "@/lib/i18n";

/** Switches the app from the server's default language to the viewer's own
 *  choice once hydration is done (D318), and keeps `<html lang>` honest for
 *  screen readers and the browser's own translate prompt. */
export function LangHydrated() {
  const lang = useLang();
  useEffect(() => {
    markLangHydrated();
  }, []);
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);
  return null;
}
