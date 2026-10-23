import type { SurveyResult } from "./types";

export interface SurveyInput {
  id: string;
  priceCents: number;
  floatValue: number | null;
  iconUrl: string | null;
}

function median(sorted: number[]): number | null {
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

/** Khoảng float tìm kiếm quanh float của món đang khảo giá. */
export function floatRange(float: number, tol: number): { floatMin: number; floatMax: number } {
  return { floatMin: Math.max(0, float - tol), floatMax: Math.min(1, float + tol) };
}

/** Tổng hợp khoảng giá từ danh sách listing tương tự (dùng chung cho server và trình duyệt). */
export function buildSurvey(listings: SurveyInput[], float: number, tol: number): SurveyResult {
  const { floatMin, floatMax } = floatRange(float, tol);
  const prices = listings.map((l) => l.priceCents).sort((a, b) => a - b);
  const closest = listings
    .map((l) => ({
      id: l.id,
      priceCents: l.priceCents,
      floatValue: l.floatValue,
      floatDiff: l.floatValue == null ? null : Math.abs(l.floatValue - float),
      iconUrl: l.iconUrl,
    }))
    .sort((a, b) => (a.floatDiff ?? 9) - (b.floatDiff ?? 9))
    .slice(0, 5);

  return {
    count: listings.length,
    minCents: prices[0] ?? null,
    medianCents: median(prices),
    maxCents: prices.length ? prices[prices.length - 1] : null,
    floatMin,
    floatMax,
    closest,
    fetchedAt: new Date().toISOString(),
  };
}
