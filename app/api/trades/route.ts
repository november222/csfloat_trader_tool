import { NextResponse } from "next/server";
import { fetchTrades } from "@/lib/csfloat";
import { errorResponse, resolveKey } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Lấy lịch sử giao dịch của MỘT vai trò mỗi lần gọi (?role=buyer hoặc ?role=seller), để trình duyệt tải từng phần. */
export async function GET(req: Request) {
  const key = resolveKey(req);
  if (!key) {
    return NextResponse.json({ error: "Chưa có API key." }, { status: 401 });
  }
  const role = new URL(req.url).searchParams.get("role");
  if (role !== "buyer" && role !== "seller") {
    return NextResponse.json({ error: "Tham số role phải là buyer hoặc seller." }, { status: 400 });
  }
  try {
    const trades = await fetchTrades(key, role);
    return NextResponse.json({ trades, fetchedAt: new Date().toISOString() });
  } catch (e) {
    return errorResponse(e);
  }
}
