import { NextResponse } from "next/server";
import { fetchMySteamId, fetchPendingTrades } from "@/lib/csfloat";
import { errorResponse, resolveKey } from "@/lib/auth";
import { parseSteamId } from "@/lib/inventory";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Lấy các giao dịch đang chờ xác nhận (pending). ?steamid= (tuỳ chọn) giúp bỏ qua một request /me. */
export async function GET(req: Request) {
  const key = resolveKey(req);
  if (!key) {
    return NextResponse.json({ error: "Chưa có API key." }, { status: 401 });
  }
  try {
    const given = parseSteamId(new URL(req.url).searchParams.get("steamid") ?? "");
    const steamId = given ?? (await fetchMySteamId(key));
    const trades = await fetchPendingTrades(key, steamId);
    return NextResponse.json({ trades, steamId, fetchedAt: new Date().toISOString() });
  } catch (e) {
    return errorResponse(e);
  }
}
