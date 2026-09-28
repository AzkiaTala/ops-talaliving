import type { ProductStockRow } from "@/services/inventory/contracts";
import type { Tr } from "@/lib/i18n";

/** One batch = one product for one customer order line (null = made for stock). */
export function batchKey(r: Pick<ProductStockRow, "product_code" | "project_line_id">) {
  return `${r.product_code}|${r.project_line_id ?? ""}`;
}

export function batchLabel(r: ProductStockRow, tr: Tr) {
  return r.project_line_id
    ? tr(`${r.project_code ?? "?"} · line ${r.line_no ?? "?"}`, `${r.project_code ?? "?"} · baris ${r.line_no ?? "?"}`)
    : tr("Stock (no order)", "Stok (tanpa pesanan)");
}
