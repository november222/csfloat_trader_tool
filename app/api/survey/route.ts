import { NextResponse } from "next/server";
import { runSurvey } from "@/lib/csfloat";
import { errorResponse, resolveKey } from "@/lib/auth";

export const dynamic = "force-dynamic";

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
  try {
    return NextResponse.json(await runSurvey(key, name, float, tol));
  } catch (e) {
    return errorResponse(e);
  }
}
