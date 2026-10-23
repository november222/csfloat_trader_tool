import { normalizeInventory, type InvItem } from "./inventory";

export class SteamError extends Error {
  status: number;
  retryAfter?: number;
  detail?: { endpoint: string; status: number; body: string };
  constructor(status: number, message: string, retryAfter?: number, detail?: SteamError["detail"]) {
    super(message);
    this.status = status;
    this.retryAfter = retryAfter;
    this.detail = detail;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const PAGE_GAP_MS = 3000; // Steam giới hạn rất chặt theo IP, nghỉ lâu giữa các trang

/** Lấy kho đồ CS2 công khai của một SteamID64. Chỉ hoạt động khi kho đồ để chế độ công khai. */
export async function fetchInventory(steamId: string, maxPages = 5): Promise<{ items: InvItem[]; total: number | null }> {
  const items: InvItem[] = [];
  let total: number | null = null;
  let start: string | null = null;

  for (let page = 0; page < maxPages; page++) {
    const url =
      `https://steamcommunity.com/inventory/${steamId}/730/2?l=english&count=2000` +
      (start ? `&start_assetid=${start}` : "");
    const res = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0 (compatible; csfloat-trader-tool/1.0)" },
      cache: "no-store",
    });

    if (!res.ok) {
      let body = "";
      try {
        body = (await res.text()).replace(/\s+/g, " ").slice(0, 200);
      } catch {
        /* bỏ qua */
      }
      const detail = { endpoint: "steamcommunity.com/inventory/…/730/2", status: res.status, body };
      if (res.status === 429) {
        throw new SteamError(429, "Steam đang giới hạn tốc độ (429) với server này. Hãy đợi vài phút rồi thử lại.", 300, detail);
      }
      if (res.status === 403) {
        throw new SteamError(
          403,
          "Steam từ chối (403): kho đồ đang riêng tư, hoặc Steam chặn server này. Kiểm tra kho đồ để chế độ công khai.",
          undefined,
          detail,
        );
      }
      throw new SteamError(res.status, `Steam trả về lỗi ${res.status}.`, undefined, detail);
    }

    const data = await res.json().catch(() => null);
    const norm = normalizeInventory(data);
    if (!norm) {
      if (page === 0) {
        throw new SteamError(
          404,
          "Steam không trả về món nào: kho đồ trống, đang riêng tư, hoặc Steam ID sai.",
          undefined,
          { endpoint: "steamcommunity.com/inventory/…/730/2", status: res.status, body: "" },
        );
      }
      break;
    }
    items.push(...norm.items);
    total = norm.total ?? total;
    if (!norm.more || !norm.lastAssetId) break;
    start = norm.lastAssetId;
    await sleep(PAGE_GAP_MS);
  }
  return { items, total };
}
