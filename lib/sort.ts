import type { PnlRow } from "./types";

export type SortKey = "default" | "buyPrice" | "sellPrice" | "profit" | "buyDate" | "sellDate";
export type SortDir = "asc" | "desc";

export const SORT_LABELS: Record<SortKey, string> = {
  default: "Mới nhất (mặc định)",
  buyPrice: "Giá mua",
  sellPrice: "Giá bán / giá đang rao",
  profit: "Lãi/lỗ",
  buyDate: "Ngày mua",
  sellDate: "Ngày bán",
};

function time(iso: string | undefined | null): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
}

/** Giá trị dùng để sắp xếp; null nếu dòng đó không có dữ liệu cho tiêu chí này. */
export function sortValue(r: PnlRow, key: SortKey): number | null {
  switch (key) {
    case "buyPrice":
      return r.buy?.priceCents ?? null;
    case "sellPrice":
      return r.sell?.priceCents ?? r.listing?.priceCents ?? null;
    case "profit":
      return r.profitCents ?? r.estProfitCents ?? null;
    case "buyDate":
      return time(r.buy?.at);
    case "sellDate":
      return time(r.sell?.at);
    default:
      return null;
  }
}

/** Sắp xếp theo tiêu chí; dòng không có dữ liệu (vd. giá nhập tay không có ngày) luôn nằm cuối. */
export function sortRows(rows: PnlRow[], key: SortKey, dir: SortDir): PnlRow[] {
  if (key === "default") return rows;
  const withValue: { r: PnlRow; v: number }[] = [];
  const without: PnlRow[] = [];
  for (const r of rows) {
    const v = sortValue(r, key);
    if (v == null) without.push(r);
    else withValue.push({ r, v });
  }
  withValue.sort((a, b) => (dir === "asc" ? a.v - b.v : b.v - a.v));
  return [...withValue.map((x) => x.r), ...without];
}
