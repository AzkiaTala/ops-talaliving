/** The sandbox's stand-ins for the `rpc` seams John Lau's declared tools name.
 *
 *  An `api` seam needs nothing here: it is a function `src/demo/api/*` already
 *  exports with the live signature. An `rpc` seam is a function in Postgres
 *  that no screen wraps yet — that is what makes it D317's case — so the demo
 *  has no function to call, and this file is it. Each one answers what the
 *  real function answers, refusals first, in the same envelope, so a walk of
 *  the demo meets the same *kode pasar harus diawali AU-* as the real thing.
 *
 *  `scripts/check-john-lau.mjs` refuses an `rpc` seam in the catalogue with no
 *  entry here: a demo that answers *not in the sandbox* for an action the real
 *  application has is the two layers disagreeing, quietly.
 */
import { conflict, invalid, ok, refused, type Result } from "@/services/_shared/envelope";
import { apply, getState, newId, writeAudit } from "../store";
import { replayed, remember, requireLevel } from "../api/_kit";
import { marketViews } from "../derive";

type RpcSeam = (params: Record<string, unknown>, key: string) => Promise<Result<unknown>>;

const str = (v: unknown) => String(v ?? "").trim();

/** `ops_mkt.create_market` (0084), check for check. */
async function createMarket(p: Record<string, unknown>, key: string): Promise<Result<unknown>> {
  const S = "marketing" as const;
  const cached = replayed<unknown>(S, "create_market", key);
  if (cached) return cached;

  if (requireLevel(S, "marketing", "write")) {
    return refused(S, "not_permitted", "Defining a market needs marketing access.");
  }
  const code = str(p.p_code).toUpperCase();
  const country = str(p.p_country_code).toUpperCase();
  if (!/^[A-Z]{2}$/.test(country)) {
    return invalid(S, "bad_country_code", "Kode negara dua huruf, ISO-3166: AU, ID, AE.", { field: "country_code" });
  }
  if (!/^[A-Z]{3}$/.test(str(p.p_currency).toUpperCase())) {
    return invalid(S, "bad_currency", "Kode mata uang tiga huruf, ISO-4217: AUD, IDR, AED.", { field: "currency" });
  }
  if (!code.startsWith(`${country}-`)) {
    return invalid(S, "code_must_start_with_country",
      `Kode pasar harus diawali ${country}-, karena setiap filter negara, kota dan distrik adalah awalan dari kode ini. ${code} tidak akan pernah muncul di laporan negaranya.`,
      { field: "code" });
  }
  if (code.split("-").length < 3) {
    return invalid(S, "code_too_short",
      "Kode pasar: NEGARA[-WILAYAH]-KOTA-AREA. Tanpa kota dan area, tidak ada yang bisa difilter di bawah negara.",
      { field: "code" });
  }
  try {
    new Intl.DateTimeFormat("en", { timeZone: str(p.p_timezone) || "-" });
  } catch {
    return invalid(S, "bad_timezone",
      `${str(p.p_timezone)} bukan zona waktu yang dikenal. "Jam berapa di sana" adalah satu-satunya pertanyaan yang tidak bisa dijawab oleh daftar nama.`,
      { field: "timezone" });
  }
  if (getState().markets.some((m) => m.code === code)) {
    return conflict(S, "market_exists", `Pasar ${code} sudah ada.`);
  }

  apply((d) => {
    d.markets.push({
      id: newId("mkt"), code, country_code: country, country_name: str(p.p_country_name),
      region: str(p.p_region) || null, city: str(p.p_city), area_label: str(p.p_area_label),
      currency: str(p.p_currency).toUpperCase(), timezone: str(p.p_timezone),
      language: str(p.p_language) || "en", active: true,
    });
    writeAudit(d, { service: S, entity: "market", entity_no: code, action: "create", outcome: "ok", reason: null });
  });
  const view = marketViews(getState()).find((m) => m.code === code)!;
  remember(S, "create_market", key, view);
  return ok(S, view);
}

export const DEMO_RPC: Record<string, RpcSeam> = {
  "ops_mkt.create_market": createMarket,
};
