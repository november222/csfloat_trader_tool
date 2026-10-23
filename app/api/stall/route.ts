import { NextResponse } from "next/server";
import { fetchMyListings, fetchMySteamId } from "@/lib/csfloat";
import { errorResponse, resolveKey } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Lấy các món đang rao bán trong stall của chủ API key. */
export async function GET(req: Request) {
  const key = resolveKey(req);
  if (!key) {
    return NextResponse.json({ error: "Chưa có API key." }, { status: 401 });
  }
  try {
    const steamId = await fetchMySteamId(key);
    const listings = await fetchMyListings(key, steamId);
    return NextResponse.json({ listings, fetchedAt: new Date().toISOString() });
  } catch (e) {
    return errorResponse(e);
  }
}
