import type { NormTrade, Role, TradeItem } from "./types";

export const CSFLOAT_BASE = "https://csfloat.com/api/v1";

export class CsfloatError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function csfloatGet(path: string, apiKey: string): Promise<unknown> {
  const res = await fetch(`${CSFLOAT_BASE}${path}`, {
    headers: { Authorization: apiKey, Accept: "application/json" },
    cache: "no-store",
  });
  if (res.status === 429) {
    throw new CsfloatError(429, "CSFloat đang giới hạn tốc độ (429). Hãy đợi một lúc rồi thử lại.");
  }
  if (res.status === 401 || res.status === 403) {
    throw new CsfloatError(res.status, "API key không hợp lệ hoặc không đủ quyền.");
  }
  if (!res.ok) {
    throw new CsfloatError(res.status, `CSFloat trả về lỗi ${res.status}.`);
  }
  return res.json();
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

function normItem(raw: Any): TradeItem {
  return {
    marketHashName: String(raw?.market_hash_name ?? raw?.item_name ?? "Unknown item"),
    floatValue: typeof raw?.float_value === "number" ? raw.float_value : null,
    paintSeed: typeof raw?.paint_seed === "number" ? raw.paint_seed : null,
    defIndex: typeof raw?.def_index === "number" ? raw.def_index : null,
    paintIndex: typeof raw?.paint_index === "number" ? raw.paint_index : null,
    assetId: raw?.asset_id != null ? String(raw.asset_id) : null,
    iconUrl: typeof raw?.icon_url === "string" ? raw.icon_url : null,
  };
}

function normTrade(raw: Any, role: Role): NormTrade | null {
  const contract = raw?.contract;
  if (!contract || typeof contract.price !== "number") return null;
  return {
    tradeId: String(raw.id),
    listingId: contract.id != null ? String(contract.id) : null,
    role,
    priceCents: contract.price,
    at: String(raw.verified_at ?? raw.accepted_at ?? raw.created_at ?? ""),
    item: normItem(contract.item),
  };
}

/** Lấy toàn bộ giao dịch đã verified của một vai trò (mua/bán), có phân trang và nghỉ giữa các request. */
export async function fetchTrades(apiKey: string, role: Role, maxPages = 20): Promise<NormTrade[]> {
  const limit = 100;
  const out: NormTrade[] = [];
  for (let page = 0; page < maxPages; page++) {
    const data = (await csfloatGet(
      `/me/trades?role=${role}&state=verified&limit=${limit}&page=${page}`,
      apiKey,
    )) as Any;
    const list: Any[] = Array.isArray(data) ? data : Array.isArray(data?.trades) ? data.trades : [];
    for (const raw of list) {
      const t = normTrade(raw, role);
      if (t) out.push(t);
    }
    if (list.length < limit) break;
    await sleep(400);
  }
  return out;
}

export interface RawListing {
  id: string;
  priceCents: number;
  floatValue: number | null;
  iconUrl: string | null;
}

export async function fetchSimilarListings(
  apiKey: string,
  opts: { marketHashName: string; minFloat: number; maxFloat: number },
): Promise<RawListing[]> {
  const q = new URLSearchParams({
    market_hash_name: opts.marketHashName,
    min_float: String(opts.minFloat),
    max_float: String(opts.maxFloat),
    sort_by: "lowest_price",
    type: "buy_now",
    limit: "50",
  });
  const data = (await csfloatGet(`/listings?${q.toString()}`, apiKey)) as Any;
  const list: Any[] = Array.isArray(data) ? data : Array.isArray(data?.data) ? data.data : [];
  return list
    .filter((l) => typeof l?.price === "number")
    .map((l) => ({
      id: String(l.id),
      priceCents: l.price,
      floatValue: typeof l?.item?.float_value === "number" ? l.item.float_value : null,
      iconUrl: typeof l?.item?.icon_url === "string" ? l.item.icon_url : null,
    }));
}
