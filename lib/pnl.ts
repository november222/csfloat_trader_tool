import type { NormTrade, PnlRow, PnlSummary } from "./types";

/** Khoá để ghép lệnh mua và lệnh bán của cùng một món (asset_id đổi sau mỗi lần trade nên dùng float + pattern). */
export function itemKey(t: NormTrade): string {
  const f = t.item.floatValue == null ? "nofloat" : t.item.floatValue.toFixed(12);
  return `${t.item.marketHashName}|${f}|${t.item.paintSeed ?? ""}`;
}

/** Số tiền nhận được sau khi người bán chịu phí (mặc định 2%). */
export function netAfterFee(priceCents: number, feePct: number): number {
  return Math.round(priceCents * (1 - feePct / 100));
}

export function buildPnl(trades: NormTrade[], feePct = 2): PnlRow[] {
  const sorted = [...trades].sort((a, b) => a.at.localeCompare(b.at));
  const buys = new Map<string, NormTrade[]>();
  const sells = new Map<string, NormTrade[]>();

  for (const t of sorted) {
    const map = t.role === "buyer" ? buys : sells;
    const k = itemKey(t);
    const list = map.get(k);
    if (list) list.push(t);
    else map.set(k, [t]);
  }

  const rows: PnlRow[] = [];
  const keys = new Set<string>([...buys.keys(), ...sells.keys()]);

  for (const k of keys) {
    const b = [...(buys.get(k) ?? [])];
    const s = [...(sells.get(k) ?? [])];
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
        rows.push({
          key: `${k}|${sell.tradeId}`,
          status: "sold",
          item: sell.item.iconUrl ? sell.item : buy.item,
          buy,
          sell,
          netCents: net,
          profitCents: profit,
          profitPct: buy.priceCents > 0 ? (profit / buy.priceCents) * 100 : null,
        });
      } else {
        rows.push({
          key: `${k}|${sell.tradeId}`,
          status: "sold_unknown_buy",
          item: sell.item,
          buy: null,
          sell,
          netCents: netAfterFee(sell.priceCents, feePct),
          profitCents: null,
          profitPct: null,
        });
      }
    }

    b.forEach((buy, i) => {
      if (used.has(i)) return;
      rows.push({
        key: `${k}|${buy.tradeId}`,
        status: "holding",
        item: buy.item,
        buy,
        sell: null,
        netCents: null,
        profitCents: null,
        profitPct: null,
      });
    });
  }

  // Mới nhất lên đầu (theo lần giao dịch gần nhất của dòng đó)
  rows.sort((a, b) => lastAt(b).localeCompare(lastAt(a)));
  return rows;
}

function lastAt(r: PnlRow): string {
  return r.sell?.at ?? r.buy?.at ?? "";
}

export function summarize(rows: PnlRow[]): PnlSummary {
  const s: PnlSummary = {
    soldCount: 0,
    holdingCount: 0,
    unknownBuyCount: 0,
    realizedProfitCents: 0,
    investedSoldCents: 0,
    holdingCostCents: 0,
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
    } else if (r.status === "sold_unknown_buy") {
      s.unknownBuyCount++;
    }
  }
  return s;
}
