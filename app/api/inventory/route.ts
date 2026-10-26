import { NextResponse } from "next/server";
import { fetchInventory } from "@/lib/csfloat";
import { errorResponse, resolveKey } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Lấy kho đồ CS2 của chủ API key qua CSFloat (GET /me/inventory), gồm float và listing_id. */
export async function GET(req: Request) {
  const key = resolveKey(req);
  if (!key) {
    return NextResponse.json({ error: "Chưa có API key." }, { status: 401 });
  }
  try {
    const items = await fetchInventory(key);
    return NextResponse.json({ items, fetchedAt: new Date().toISOString() });
  } catch (e) {
    return errorResponse(e);
  }
}
