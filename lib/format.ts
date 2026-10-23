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
