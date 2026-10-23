import { NextResponse } from "next/server";
import { fetchInventory, SteamError } from "@/lib/steam";
import { parseSteamId } from "@/lib/inventory";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Lấy kho đồ CS2 công khai: GET /api/inventory?steamid=<SteamID64 hoặc link /profiles/...>. Không cần API key. */
export async function GET(req: Request) {
  const raw = new URL(req.url).searchParams.get("steamid") ?? "";
  const steamId = parseSteamId(raw);
  if (!steamId) {
    return NextResponse.json(
      { error: "Steam ID không hợp lệ: cần số 17 chữ số hoặc link dạng steamcommunity.com/profiles/<số>." },
      { status: 400 },
    );
  }
  try {
    const { items, total } = await fetchInventory(steamId);
    return NextResponse.json({ steamId, items, total, fetchedAt: new Date().toISOString() });
  } catch (e) {
    if (e instanceof SteamError) {
      return NextResponse.json(
        { error: e.message, retryAfter: e.retryAfter ?? null, detail: e.detail ?? null },
        { status: e.status === 429 ? 429 : e.status >= 400 ? e.status : 502 },
      );
    }
    return NextResponse.json({ error: "Lỗi không xác định ở server." }, { status: 500 });
  }
}
