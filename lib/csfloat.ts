import type { NormListing, NormTrade, Role, TradeItem } from "./types";

export const CSFLOAT_BASE = "https://csfloat.com/api/v1";

/** Thông tin kỹ thuật kèm theo lỗi để dễ chẩn đoán (không chứa API key). */
export interface ErrorDetail {
  endpoint: string;
  attempts: number;
  headers: Record<string, string>;
  body: string;
}

export class CsfloatError extends Error {
  status: number;
  /** Số giây nên đợi trước khi thử lại (chỉ có với lỗi 429) */
  retryAfter?: number;
  detail?: ErrorDetail;
  constructor(status: number, message: string, retryAfter?: number, detail?: ErrorDetail) {
    super(message);
    this.status = status;
    this.retryAfter = retryAfter;
    this.detail = detail;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Khoảng nghỉ giữa các request liên tiếp tới CSFloat khi phân trang. */
const PAGE_GAP_MS = 1500;
const MAX_RETRIES_429 = 2;
const MAX_INLINE_WAIT_S = 8; // chỉ tự đợi tại server nếu CSFloat bảo đợi ngắn

async function buildDetail(res: Response, path: string, attempts: number): Promise<ErrorDetail> {
  let body = "";
  try {
    body = (await res.text()).replace(/\s+/g, " ").slice(0, 300);
  } catch {
    /* bỏ qua */
  }
  const headers: Record<string, string> = {};
  res.headers.forEach((v, k) => {
    if (/ratelimit|retry-after|cf-ray|cf-mitigated|^server$/i.test(k)) headers[k] = v;
  });
  return { endpoint: path.split("?")[0], attempts, headers, body };
}

export async function csfloatGet(path: string, apiKey: string): Promise<unknown> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${CSFLOAT_BASE}${path}`, {
      headers: {
        Authorization: apiKey,
        Accept: "application/json",
        "User-Agent": "csfloat-trader-tool/1.0",
      },
      cache: "no-store",
    });
    if (res.status === 429) {
      const ra = Number(res.headers.get("retry-after"));
      const retryAfter = Number.isFinite(ra) && ra > 0 ? Math.ceil(ra) : null;
      const waitS = retryAfter ?? 2 * (attempt + 1);
      const detail = await buildDetail(res, path, attempt + 1);
      // Tự đợi rồi thử lại vài lần nếu thời gian đợi ngắn; nếu không thì báo về trình duyệt kèm số giây cần đợi.
      if (attempt < MAX_RETRIES_429 && waitS <= MAX_INLINE_WAIT_S) {
        await sleep(waitS * 1000);
        continue;
      }
      throw new CsfloatError(
        429,
        `CSFloat trả về lỗi 429 (từ chối tạm thời) ở ${detail.endpoint}. Hãy đợi một lúc rồi thử lại.`,
        retryAfter ?? 60,
        detail,
      );
    }
    if (res.status === 401 || res.status === 403) {
      const detail = await buildDetail(res, path, attempt + 1);
      throw new CsfloatError(
        res.status,
        `CSFloat từ chối yêu cầu (${res.status}) ở ${detail.endpoint}: API key không hợp lệ, không đủ quyền hoặc bị chặn.`,
        undefined,
        detail,
      );
    }
    if (!res.ok) {
      const detail = await buildDetail(res, path, attempt + 1);
      throw new CsfloatError(res.status, `CSFloat trả về lỗi ${res.status} ở ${detail.endpoint}.`, undefined, detail);
    }
    return res.json();
  }
}

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

/**
 * Lấy toàn bộ giao dịch đã verified của một vai trò (mua/bán), có phân trang và nghỉ giữa các request.
 * Dừng ngay nếu một trang không có giao dịch mới (phòng trường hợp API bỏ qua tham số page).
 */
export async function fetchTrades(apiKey: string, role: Role, maxPages = 20): Promise<NormTrade[]> {
  const limit = 100;
  const out: NormTrade[] = [];
  const seen = new Set<string>();
  for (let page = 0; page < maxPages; page++) {
    const data = (await csfloatGet(
      `/me/trades?role=${role}&state=verified&limit=${limit}&page=${page}`,
      apiKey,
    )) as Any;
    const list: Any[] = Array.isArray(data) ? data : Array.isArray(data?.trades) ? data.trades : [];
    let added = 0;
    for (const raw of list) {
      const t = normTrade(raw, role);
      if (t && !seen.has(t.tradeId)) {
        seen.add(t.tradeId);
        out.push(t);
        added++;
      }
    }
    if (list.length < limit || added === 0) break;
    await sleep(PAGE_GAP_MS);
  }
  return out;
}

function normListing(raw: Any): NormListing | null {
  if (!raw || typeof raw.price !== "number" || raw.id == null) return null;
  if (raw.state && raw.state !== "listed") return null; // chỉ lấy món đang rao
  return {
    listingId: String(raw.id),
    priceCents: raw.price,
    at: String(raw.created_at ?? ""),
    type: typeof raw.type === "string" ? raw.type : null,
    item: normItem(raw.item),
  };
}

/** Lấy Steam ID của chủ API key. */
export async function fetchMySteamId(apiKey: string): Promise<string> {
  const data = (await csfloatGet("/me", apiKey)) as Any;
  const id = data?.user?.steam_id ?? data?.steam_id;
  if (!id) throw new CsfloatError(502, "Không đọc được Steam ID từ /me.");
  return String(id);
}

/**
 * Lấy các món đang rao bán trong stall của bạn (listing ở trạng thái listed), có phân trang.
 * Chỉ nhận listing có người bán đúng là bạn (nếu API bỏ qua user_id thì không lẫn listing của người khác),
 * và dừng khi một trang không có listing mới.
 */
export async function fetchMyListings(apiKey: string, steamId: string, maxPages = 10): Promise<NormListing[]> {
  const limit = 50;
  const out: NormListing[] = [];
  const seen = new Set<string>();
  for (let page = 0; page < maxPages; page++) {
    const q = new URLSearchParams({
      user_id: steamId,
      sort_by: "most_recent",
      limit: String(limit),
      page: String(page),
    });
    const data = (await csfloatGet(`/listings?${q.toString()}`, apiKey)) as Any;
    const list: Any[] = Array.isArray(data) ? data : Array.isArray(data?.data) ? data.data : [];
    let added = 0;
    for (const raw of list) {
      const sellerId = raw?.seller?.steam_id;
      if (sellerId != null && String(sellerId) !== steamId) continue; // listing của người khác
      const l = normListing(raw);
      if (l && !seen.has(l.listingId)) {
        seen.add(l.listingId);
        out.push(l);
        added++;
      }
    }
    if (list.length < limit || added === 0) break;
    await sleep(PAGE_GAP_MS);
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
