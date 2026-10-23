import { NextResponse } from "next/server";
import { CsfloatError, fetchMyListings, fetchMySteamId, fetchTrades } from "@/lib/csfloat";
import { errorResponse, resolveKey } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  const key = resolveKey(req);
  if (!key) {
    return NextResponse.json({ error: "Chưa có API key." }, { status: 401 });
  }
  try {
    // Chạy tuần tự (không song song) để tránh bị CSFloat chặn vì quá nhiều request.
    const bought = await fetchTrades(key, "buyer");
    const sold = await fetchTrades(key, "seller");

    // Stall (món đang bán): nếu lỗi thì vẫn trả về giao dịch, kèm thông báo lỗi riêng.
    let listings: Awaited<ReturnType<typeof fetchMyListings>> = [];
    let stallError: string | null = null;
    try {
      const steamId = await fetchMySteamId(key);
      listings = await fetchMyListings(key, steamId);
    } catch (e) {
      if (e instanceof CsfloatError && e.status === 429) throw e;
      stallError = e instanceof CsfloatError ? e.message : "Không tải được stall (món đang bán).";
    }

    return NextResponse.json({
      trades: [...bought, ...sold],
      listings,
      stallError,
      fetchedAt: new Date().toISOString(),
    });
  } catch (e) {
    return errorResponse(e);
  }
}
