import { NextResponse } from "next/server";
import { CsfloatError } from "./csfloat";

/** Lấy API key từ header của trình duyệt, hoặc biến môi trường CSFLOAT_API_KEY nếu có. */
export function resolveKey(req: Request): string | null {
  const fromHeader = req.headers.get("x-csfloat-key")?.trim();
  if (fromHeader) return fromHeader;
  const fromEnv = process.env.CSFLOAT_API_KEY?.trim();
  return fromEnv || null;
}

export function errorResponse(e: unknown) {
  if (e instanceof CsfloatError) {
    return NextResponse.json({ error: e.message }, { status: e.status === 429 ? 429 : e.status >= 400 ? e.status : 502 });
  }
  return NextResponse.json({ error: "Lỗi không xác định ở server." }, { status: 500 });
}
