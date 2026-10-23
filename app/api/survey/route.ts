import { NextResponse } from "next/server";
import { fetchSimilarListings } from "@/lib/csfloat";
import { errorResponse, resolveKey } from "@/lib/auth";
import type { SurveyResult } from "@/lib/types";

export const dynamic = "force-dynamic";

function median(sorted: number[]): number | null {
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

/** Khảo giá một món: chỉ chạy khi người dùng bấm nút, mỗi lần đúng 1 request tới CSFloat. */
export async function GET(req: Request) {
  const key = resolveKey(req);
  if (!key) {
    return NextResponse.json({ error: "Chưa có API key." }, { status: 401 });
  }
  const url = new URL(req.url);
  const name = url.searchParams.get("name");
  const float = Number(url.searchParams.get("float"));
  const tol = Number(url.searchParams.get("tol") ?? "0.001");
  if (!name || !Number.isFinite(float) || !Number.isFinite(tol) || tol <= 0 || tol > 0.1) {
    return NextResponse.json({ error: "Tham số không hợp lệ." }, { status: 400 });
  }

  const floatMin = Math.max(0, float - tol);
  const floatMax = Math.min(1, float + tol);

  try {
    const listings = await fetchSimilarListings(key, {
      marketHashName: name,
      minFloat: floatMin,
      maxFloat: floatMax,
    });
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

    const result: SurveyResult = {
      count: listings.length,
      minCents: prices[0] ?? null,
      medianCents: median(prices),
      maxCents: prices.length ? prices[prices.length - 1] : null,
      floatMin,
      floatMax,
      closest,
      fetchedAt: new Date().toISOString(),
    };
    return NextResponse.json(result);
  } catch (e) {
    return errorResponse(e);
  }
}
