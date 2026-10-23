import type { ManualSell, NormListing, NormTrade, PnlRow, PnlSummary, TradeItem } from "./types";

function keyOf(item: TradeItem): string {
  const f = item.floatValue == null ? "nofloat" : item.floatValue.toFixed(12);
  return `${item.marketHashName}|${f}|${item.paintSeed ?? ""}`;
}

/** Khoá để ghép lệnh mua, lệnh bán và listing của cùng một món (asset_id đổi sau mỗi lần trade nên dùng float + pattern). */
export function itemKey(t: NormTrade): string {
  return keyOf(t.item);
}

/** Số tiền nhận được sau khi người bán chịu phí (mặc định 2%). */
export function netAfterFee(priceCents: number, feePct: number): number {
  return Math.round(priceCents * (1 - feePct / 100));
}

/** Gán giá mua nhập tay (cent) cho một dòng "không rõ giá mua" rồi tính lại lãi/lỗ. */
function applyManualBuy(row: PnlRow, cents: number): PnlRow {
  const buy: NormTrade = {
    tradeId: `manual-${row.key}`,
    listingId: null,
    role: "buyer",
    priceCents: cents,
    at: "",
    item: row.item,
  };
  const net = row.netCents ?? 0;
  const profit = net - cents;
  const pct = cents > 0 ? (profit / cents) * 100 : null;
  if (row.status === "sold_unknown_buy") {
    return { ...row, status: "sold", buy, manualBuy: true, profitCents: profit, profitPct: pct };
  }
  if (row.status === "pending_sell") {
    return { ...row, buy, manualBuy: true, estProfitCents: profit, estProfitPct: pct };
  }
  return { ...row, status: "listed", buy, manualBuy: true, estProfitCents: profit, estProfitPct: pct };
}

/** Món mua trên CSFloat nhưng bán ở sàn khác: dùng giá bán và phí nhập tay để tính lãi/lỗ đã chốt. */
function applyManualSell(row: PnlRow, ms: ManualSell): PnlRow {
  const buyCents = row.buy?.priceCents ?? 0;
  const net = netAfterFee(ms.priceCents, ms.feePct);
  const profit = net - buyCents;
  const sell: NormTrade = {
    tradeId: `manual-sell-${row.key}`,
    listingId: null,
    role: "seller",
    priceCents: ms.priceCents,
    at: "",
    item: row.item,
  };
  return {
    ...row,
    status: "sold",
    sell,
    listing: null,
    netCents: net,
    profitCents: profit,
    profitPct: buyCents > 0 ? (profit / buyCents) * 100 : null,
    estProfitCents: null,
    estProfitPct: null,
    manualSell: true,
    sellPlatform: ms.platform,
    sellFeePct: ms.feePct,
  };
}

export function buildPnl(
  trades: NormTrade[],
  feePct = 2,
  listings: NormListing[] = [],
  manualBuys: Record<string, number> = {},
  manualSells: Record<string, ManualSell> = {},
): PnlRow[] {
  const sorted = [...trades].sort((a, b) => a.at.localeCompare(b.at));
  const buys = new Map<string, NormTrade[]>();
  const sells = new Map<string, NormTrade[]>();
  const stall = new Map<string, NormListing[]>();

  for (const t of sorted) {
    const map = t.role === "buyer" ? buys : sells;
    const k = itemKey(t);
    const list = map.get(k);
    if (list) list.push(t);
    else map.set(k, [t]);
  }
  for (const l of [...listings].sort((a, b) => a.at.localeCompare(b.at))) {
    const k = keyOf(l.item);
    const list = stall.get(k);
    if (list) list.push(l);
    else stall.set(k, [l]);
  }

  const rows: PnlRow[] = [];
  const keys = new Set<string>([...buys.keys(), ...sells.keys(), ...stall.keys()]);

  for (const k of keys) {
    const b = [...(buys.get(k) ?? [])];
    const s = [...(sells.get(k) ?? [])];
    const l = [...(stall.get(k) ?? [])];
    const used = new Set<number>();

    // Với mỗi lệnh bán (theo thời gian), ghép với lệnh mua chưa dùng gần nhất trước đó.
    for (const sell of s) {
      let pick = -1;
      for (let i = 0; i < b.length; i++) {
        if (used.has(i)) continue;
        if (b[i].at <= sell.at) pick = i; // lấy lệnh mua gần nhất trước lệnh bán
      }
      if (pick >= 0) {
        used.add(pick);
        const buy = b[pick];
        const net = netAfterFee(sell.priceCents, feePct);
        const profit = net - buy.priceCents;
        const pctVal = buy.priceCents > 0 ? (profit / buy.priceCents) * 100 : null;
        // Bán đang chờ xác nhận: chưa nhận tiền nên chỉ là lãi/lỗ ước tính, chưa tính vào lãi/lỗ đã chốt
        const isPending = sell.pending === true;
        rows.push({
          key: `${k}|${sell.tradeId}`,
          status: isPending ? "pending_sell" : "sold",
          item: sell.item.iconUrl ? sell.item : buy.item,
          buy,
          sell,
          listing: null,
          netCents: net,
          profitCents: isPending ? null : profit,
          profitPct: isPending ? null : pctVal,
          estProfitCents: isPending ? profit : null,
          estProfitPct: isPending ? pctVal : null,
        });
      } else {
        rows.push({
          key: `${k}|${sell.tradeId}`,
          status: sell.pending ? "pending_sell" : "sold_unknown_buy",
          item: sell.item,
          buy: null,
          sell,
          listing: null,
          netCents: netAfterFee(sell.priceCents, feePct),
          profitCents: null,
          profitPct: null,
          estProfitCents: null,
          estProfitPct: null,
        });
      }
    }

    // Các lệnh mua chưa bán: nếu đang rao trong stall thì là "Đang bán", không thì "Đang giữ".
    // Ưu tiên gán listing cho lệnh mua mới nhất (món đang rao thường là lần mua gần nhất).
    const remaining: number[] = [];
    b.forEach((_, i) => {
      if (!used.has(i)) remaining.push(i);
    });
    remaining.reverse();
    const pool = [...l];
    for (const i of remaining) {
      const buy = b[i];
      // Món mới mua còn đang chờ xác nhận: chưa thể đang rao, không lấy listing của món khác
      if (buy.pending) {
        rows.push({
          key: `${k}|${buy.tradeId}`,
          status: "pending_buy",
          item: buy.item,
          buy,
          sell: null,
          listing: null,
          netCents: null,
          profitCents: null,
          profitPct: null,
          estProfitCents: null,
          estProfitPct: null,
        });
        continue;
      }
      const listing = pool.pop() ?? null;
      if (listing) {
        const net = netAfterFee(listing.priceCents, feePct);
        const est = net - buy.priceCents;
        rows.push({
          key: `${k}|${buy.tradeId}`,
          status: "listed",
          item: listing.item.iconUrl ? listing.item : buy.item,
          buy,
          sell: null,
          listing,
          netCents: net,
          profitCents: null,
          profitPct: null,
          estProfitCents: est,
          estProfitPct: buy.priceCents > 0 ? (est / buy.priceCents) * 100 : null,
        });
      } else {
        rows.push({
          key: `${k}|${buy.tradeId}`,
          status: "holding",
          item: buy.item,
          buy,
          sell: null,
          listing: null,
          netCents: null,
          profitCents: null,
          profitPct: null,
          estProfitCents: null,
          estProfitPct: null,
        });
      }
    }

    // Listing còn thừa: đang rao nhưng không tìm thấy lệnh mua tương ứng.
    for (const listing of pool) {
      rows.push({
        key: `${k}|L${listing.listingId}`,
        status: "listed_unknown_buy",
        item: listing.item,
        buy: null,
        sell: null,
        listing,
        netCents: netAfterFee(listing.priceCents, feePct),
        profitCents: null,
        profitPct: null,
        estProfitCents: null,
        estProfitPct: null,
      });
    }
  }

  // Áp dụng giá mua nhập tay cho các dòng không rõ giá mua
  const finalRows = rows.map((r) => {
    const manual = manualBuys[r.key];
    let row = r;
    const unknownBuy =
      row.status === "sold_unknown_buy" ||
      row.status === "listed_unknown_buy" ||
      (row.status === "pending_sell" && row.buy == null);
    if (unknownBuy && manual != null) {
      row = applyManualBuy(row, manual);
    }
    // Giá bán nhập tay chỉ áp dụng cho món đã biết giá mua và chưa bán trên CSFloat (đang giữ hoặc đang rao).
    const ms = manualSells[row.key];
    if (ms && row.buy && (row.status === "holding" || row.status === "listed")) {
      row = applyManualSell(row, ms);
    }
    return row;
  });

  // Mới nhất lên đầu (theo lần giao dịch gần nhất của dòng đó)
  finalRows.sort((a, b) => lastAt(b).localeCompare(lastAt(a)));
  return finalRows;
}

function lastAt(r: PnlRow): string {
  return r.sell?.at ?? r.listing?.at ?? r.buy?.at ?? "";
}

export function summarize(rows: PnlRow[]): PnlSummary {
  const s: PnlSummary = {
    soldCount: 0,
    holdingCount: 0,
    listedCount: 0,
    unknownBuyCount: 0,
    realizedProfitCents: 0,
    investedSoldCents: 0,
    holdingCostCents: 0,
    pendingBuyCount: 0,
    pendingBuyCostCents: 0,
    pendingSellCount: 0,
    pendingSellNetCents: 0,
    pendingSellEstProfitCents: 0,
    listedCostCents: 0,
    listedAskCents: 0,
    listedEstProfitCents: 0,
    winCount: 0,
    lossCount: 0,
  };
  for (const r of rows) {
    if (r.status === "sold" && r.profitCents != null && r.buy) {
      s.soldCount++;
      s.realizedProfitCents += r.profitCents;
      s.investedSoldCents += r.buy.priceCents;
      if (r.profitCents > 0) s.winCount++;
      else if (r.profitCents < 0) s.lossCount++;
    } else if (r.status === "holding" && r.buy) {
      s.holdingCount++;
      s.holdingCostCents += r.buy.priceCents;
    } else if (r.status === "listed" && r.buy && r.listing) {
      s.listedCount++;
      s.listedCostCents += r.buy.priceCents;
      s.listedAskCents += r.listing.priceCents;
      s.listedEstProfitCents += r.estProfitCents ?? 0;
    } else if (r.status === "pending_buy" && r.buy) {
      s.pendingBuyCount++;
      s.pendingBuyCostCents += r.buy.priceCents;
    } else if (r.status === "pending_sell") {
      s.pendingSellCount++;
      s.pendingSellNetCents += r.netCents ?? 0;
      if (r.buy) s.pendingSellEstProfitCents += r.estProfitCents ?? 0;
      else s.unknownBuyCount++;
    } else if (r.status === "sold_unknown_buy" || r.status === "listed_unknown_buy") {
      s.unknownBuyCount++;
    }
  }
  return s;
}
