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

export type RowStatus = "sold" | "holding" | "sold_unknown_buy";

export interface PnlRow {
  key: string;
  status: RowStatus;
  item: TradeItem;
  buy: NormTrade | null;
  sell: NormTrade | null;
  /** Số tiền nhận được sau khi trừ phí, null nếu chưa bán */
  netCents: number | null;
  /** Lãi/lỗ (cent), null nếu chưa bán hoặc không có giá mua */
  profitCents: number | null;
  profitPct: number | null;
}

export interface PnlSummary {
  soldCount: number;
  holdingCount: number;
  unknownBuyCount: number;
  realizedProfitCents: number;
  investedSoldCents: number;
  holdingCostCents: number;
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
