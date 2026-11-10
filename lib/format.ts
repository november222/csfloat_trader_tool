export function usd(cents: number | null | undefined): string {
  if (cents == null) return "—";
  const sign = cents < 0 ? "-" : "";
  return `${sign}$${(Math.abs(cents) / 100).toFixed(2)}`;
}

export function signedUsd(cents: number | null | undefined): string {
  if (cents == null) return "—";
  return `${cents > 0 ? "+" : ""}${usd(cents)}`;
}

export function pct(v: number | null | undefined): string {
  if (v == null) return "—";
  return `${v > 0 ? "+" : ""}${v.toFixed(1)}%`;
}

export function floatStr(v: number | null | undefined, digits = 8): string {
  return v == null ? "—" : v.toFixed(digits);
}

export function imageUrl(iconUrl: string | null | undefined): string | null {
  if (!iconUrl) return null;
  if (iconUrl.startsWith("http")) return iconUrl;
  return `https://community.cloudflare.steamstatic.com/economy/image/${iconUrl}/256fx256f`;
}

export function listingLink(id: string | null | undefined): string | null {
  return id ? `https://csfloat.com/item/${id}` : null;
}

export function dateStr(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("vi-VN", { year: "numeric", month: "2-digit", day: "2-digit" });
}

export function signClass(v: number | null | undefined): string {
  if (v == null || v === 0) return "neu";
  return v > 0 ? "pos" : "neg";
}

/** Trang tìm kiếm CSFloat đã lọc sẵn theo tên + khoảng float (mở bằng trình duyệt của bạn, không qua server). */
export function searchLink(name: string, float: number, tol: number): string {
  const q = new URLSearchParams({
    market_hash_name: name,
    min_float: String(Math.max(0, float - tol)),
    max_float: String(Math.min(1, float + tol)),
    sort_by: "lowest_price",
    type: "buy_now",
  });
  return `https://csfloat.com/search?${q.toString()}`;
}

/** Danh sách URL ảnh để thử lần lượt (CDN Steam đôi khi thiếu ảnh ở một máy chủ hoặc một kích thước). */
export function imageCandidates(iconUrl: string | null | undefined): string[] {
  if (!iconUrl) return [];
  if (iconUrl.startsWith("http")) return [iconUrl];
  const hosts = [
    "community.cloudflare.steamstatic.com",
    "community.fastly.steamstatic.com",
    "community.akamai.steamstatic.com",
  ];
  const out = hosts.map((h) => `https://${h}/economy/image/${iconUrl}/256fx256f`);
  out.push(`https://${hosts[0]}/economy/image/${iconUrl}/360fx360f`, `https://${hosts[0]}/economy/image/${iconUrl}`);
  return out;
}
