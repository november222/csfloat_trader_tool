/** Kho đồ CS2 lấy từ CSFloat (GET /me/inventory). Phần thuần, không gọi mạng. */

export interface InvItem {
  assetId: string;
  name: string; // market_hash_name
  iconUrl: string | null;
  floatValue: number | null;
  paintSeed: number | null;
  /** ID listing nếu món này đang được rao trong stall CSFloat của bạn */
  listingId: string | null;
}

export type InvSource = "csfloat" | "other";
export interface ClassifiedItem extends InvItem {
  source: InvSource;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

/** Chuyển JSON của /me/inventory thành danh sách món. Chấp nhận mảng trần hoặc đối tượng có `data`. */
export function normalizeCsfloatInventory(data: Any): InvItem[] | null {
  const list: Any[] | null = Array.isArray(data)
    ? data
    : Array.isArray(data?.data)
      ? data.data
      : Array.isArray(data?.inventory)
        ? data.inventory
        : null;
  if (!list) return null;
  const out: InvItem[] = [];
  for (const raw of list) {
    // Một số phản hồi bọc món đồ trong `item`
    const it = raw?.item && typeof raw.item === "object" ? { ...raw.item, listing_id: raw.listing_id ?? raw.item.listing_id } : raw;
    if (!it || it.asset_id == null) continue;
    out.push({
      assetId: String(it.asset_id),
      name: String(it.market_hash_name ?? it.item_name ?? "Unknown item"),
      iconUrl: typeof it.icon_url === "string" ? it.icon_url : null,
      floatValue: typeof it.float_value === "number" ? it.float_value : null,
      paintSeed: typeof it.paint_seed === "number" ? it.paint_seed : null,
      listingId: it.listing_id != null && it.listing_id !== "" ? String(it.listing_id) : null,
    });
  }
  return out;
}

/** Nhận SteamID64 (17 chữ số) hoặc link trang cá nhân dạng /profiles/<id>. Link dạng /id/<tên> thì trả về null. */
export function parseSteamId(input: string): string | null {
  const s = input.trim();
  if (/^\d{17}$/.test(s)) return s;
  const m = s.match(/steamcommunity\.com\/profiles\/(\d{17})/i);
  return m ? m[1] : null;
}

export interface HoldingInfo {
  name: string;
  floatValue: number | null;
  count: number;
}

/**
 * Đối chiếu kho đồ với các món CSFloat ghi là đang giữ / đang rao / đang chờ xác nhận (khoá = tên + float + pattern).
 * - `csfloat`: món trong kho khớp một món trong lịch sử CSFloat (mỗi món lịch sử chỉ khớp một bản).
 * - `other`: món trong kho không có lệnh mua tương ứng trên CSFloat.
 * - `missing`: món CSFloat ghi là đang giữ nhưng không thấy trong kho (đã bán ở nơi khác, hoặc còn trong thời gian chờ xác nhận).
 */
export function classifyInventory(
  items: InvItem[],
  holding: Record<string, HoldingInfo>,
  keyOf: (it: InvItem) => string,
): { items: ClassifiedItem[]; missing: HoldingInfo[] } {
  const remaining: Record<string, number> = {};
  for (const [k, h] of Object.entries(holding)) remaining[k] = h.count;
  const out: ClassifiedItem[] = items.map((it) => {
    const k = keyOf(it);
    if ((remaining[k] ?? 0) > 0) {
      remaining[k]--;
      return { ...it, source: "csfloat" as const };
    }
    return { ...it, source: "other" as const };
  });
  const missing = Object.entries(remaining)
    .filter(([, n]) => n > 0)
    .map(([k, n]) => ({ name: holding[k].name, floatValue: holding[k].floatValue, count: n }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { items: out, missing };
}
