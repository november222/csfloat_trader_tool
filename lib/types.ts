export type Role = "buyer" | "seller";

export interface TradeItem {
  marketHashName: string;
  floatValue: number | null;
  paintSeed: number | null;
  defIndex: number | null;
  paintIndex: number | null;
  assetId: string | null;
  iconUrl: string | null;
}

/** Một giao dịch đã hoàn tất (verified) của người dùng, giá tính bằng cent USD. */
export interface NormTrade {
  tradeId: string;
  listingId: string | null;
  role: Role;
  priceCents: number;
  at: string; // ISO time
  item: TradeItem;
}

/** Một listing đang rao bán trong stall của người dùng, giá rao bằng cent USD. */
export interface NormListing {
  listingId: string;
  priceCents: number;
  at: string; // ISO time tạo listing
  type: string | null; // buy_now | auction
  item: TradeItem;
}

export type RowStatus = "sold" | "holding" | "listed" | "sold_unknown_buy" | "listed_unknown_buy";

export interface PnlRow {
  key: string;
  status: RowStatus;
  item: TradeItem;
  buy: NormTrade | null;
  sell: NormTrade | null;
  /** Listing đang rao trong stall (nếu có) */
  listing: NormListing | null;
  /** Số tiền nhận được sau khi trừ phí (từ giá bán thực tế, hoặc từ giá đang rao nếu đang bán), null nếu không có */
  netCents: number | null;
  /** Lãi/lỗ đã chốt (cent), null nếu chưa bán hoặc không có giá mua */
  profitCents: number | null;
  profitPct: number | null;
  /** Lãi/lỗ ước tính nếu bán đúng giá đang rao (chỉ cho món đang bán có giá mua) */
  estProfitCents: number | null;
  estProfitPct: number | null;
}

export interface PnlSummary {
  soldCount: number;
  holdingCount: number;
  listedCount: number;
  unknownBuyCount: number;
  realizedProfitCents: number;
  investedSoldCents: number;
  holdingCostCents: number;
  listedCostCents: number;
  listedAskCents: number;
  listedEstProfitCents: number;
  winCount: number;
  lossCount: number;
}

export interface SurveyListing {
  id: string;
  priceCents: number;
  floatValue: number | null;
  floatDiff: number | null;
  iconUrl: string | null;
}

export interface SurveyResult {
  count: number;
  minCents: number | null;
  medianCents: number | null;
  maxCents: number | null;
  floatMin: number;
  floatMax: number;
  closest: SurveyListing[];
  fetchedAt: string;
}
