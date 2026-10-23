import { NextResponse } from "next/server";
import { fetchTrades } from "@/lib/csfloat";
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
    return NextResponse.json({
      trades: [...bought, ...sold],
      fetchedAt: new Date().toISOString(),
    });
  } catch (e) {
    return errorResponse(e);
  }
}
