/** Xử lý dữ liệu kho đồ Steam (CS2: appid 730, contextid 2). Phần thuần, không gọi mạng. */

export interface InvItem {
  assetId: string;
  name: string; // market_hash_name
  iconUrl: string | null;
  tradable: boolean;
  marketable: boolean;
  type: string | null;
  /** Thời điểm hết khoá giao dịch (ISO), nếu Steam báo */
  tradableAfter: string | null;
}

export type InvSource = "csfloat" | "other";
export interface ClassifiedItem extends InvItem {
  source: InvSource;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

export interface InventoryPage {
  items: InvItem[];
  more: boolean;
  lastAssetId: string | null;
  total: number | null;
}

/** Chuyển JSON của endpoint kho đồ Steam thành danh sách món. Trả về null nếu không phải dữ liệu kho đồ hợp lệ. */
export function normalizeInventory(data: Any): InventoryPage | null {
  if (!data || typeof data !== "object" || !Array.isArray(data.assets)) return null;
  const descs = new Map<string, Any>();
  for (const d of Array.isArray(data.descriptions) ? data.descriptions : []) {
    descs.set(`${d.classid}_${d.instanceid}`, d);
  }
  const items: InvItem[] = [];
  for (const a of data.assets) {
    if (a?.appid != null && Number(a.appid) !== 730) continue;
    const d = descs.get(`${a.classid}_${a.instanceid}`);
    if (!d) continue;
    const exp = typeof d.cache_expiration === "string" ? d.cache_expiration : null;
    items.push({
      assetId: String(a.assetid),
      name: String(d.market_hash_name ?? d.name ?? "Unknown item"),
      iconUrl: typeof d.icon_url === "string" ? d.icon_url : null,
      tradable: Number(d.tradable) === 1,
      marketable: Number(d.marketable) === 1,
      type: typeof d.type === "string" ? d.type : null,
      tradableAfter: exp && !Number.isNaN(Date.parse(exp)) && Date.parse(exp) > Date.now() ? exp : null,
    });
  }
  return {
    items,
    more: Number(data.more_items) === 1,
    lastAssetId: data.last_assetid != null ? String(data.last_assetid) : null,
    total: typeof data.total_inventory_count === "number" ? data.total_inventory_count : null,
  };
}

/** Nhận SteamID64 (17 chữ số) hoặc link trang cá nhân dạng /profiles/<id>. Link dạng /id/<tên> thì trả về null. */
export function parseSteamId(input: string): string | null {
  const s = input.trim();
  if (/^\d{17}$/.test(s)) return s;
  const m = s.match(/steamcommunity\.com\/profiles\/(\d{17})/i);
  return m ? m[1] : null;
}

/**
 * Đối chiếu kho đồ với các món CSFloat đang giữ/đang rao (đếm theo tên).
 * - Mỗi tên: số bản "khớp CSFloat" tối đa bằng số món đang giữ/đang rao của tên đó, phần còn lại là "ngoài CSFloat".
 * - `missing`: món CSFloat ghi là đang giữ/đang rao nhưng không thấy đủ trong kho (có thể đã bán ở nơi khác).
 */
export function classifyInventory(
  items: InvItem[],
  holdingCounts: Record<string, number>,
): { items: ClassifiedItem[]; missing: { name: string; count: number }[] } {
  const remaining: Record<string, number> = { ...holdingCounts };
  const out: ClassifiedItem[] = items.map((it) => {
    if ((remaining[it.name] ?? 0) > 0) {
      remaining[it.name]--;
      return { ...it, source: "csfloat" as const };
    }
    return { ...it, source: "other" as const };
  });
  const missing = Object.entries(remaining)
    .filter(([, n]) => n > 0)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { items: out, missing };
}
